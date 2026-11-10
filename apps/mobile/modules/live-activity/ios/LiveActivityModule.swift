// LiveActivityModule.swift -- the app's side of its Live Activity: the tokens the service pushes to, the activity's end, the Stop button's requests, and a fixture's activity started on the phone.
//
// The service starts, updates, and ends the activity by push, so the app
// only hands it tokens: the push-to-start token, and the update token of
// each activity iOS starts. It also says when an activity ends or is
// dismissed. Each goes to JavaScript as an event (`src/live-activity/`),
// and the latest are sent again when it starts listening, since iOS hands
// them once. A Stop pressed on the activity (`StopAgentIntent`, in the
// app's target) waits in the standard defaults; each is handed on while
// JavaScript listens, and taken away once it answers. A fixture run starts
// an activity of its own (`startFixture`), since no push reaches a
// simulator, and ends it (`endAll`).

import ActivityKit
import ExpoModulesCore
import Foundation

public final class LiveActivityModule: Module {
  /// The defaults key and the ping `StopAgentIntent` names.
  private static let stopsKey = "dev.vespin.live-activity.stops"
  private static let stopAsked = Notification.Name("dev.vespin.live-activity.stop-asked")
  /// How old a Stop may be and still be handed on: one left from a launch long gone is dropped.
  private static let stopFreshness: Double = 2 * 60 * 1000

  // Note that the state below is read and written on the main actor alone.
  private var listening = false
  private var startToken: String?
  private var activityTokens: [String: String] = [:]
  /// The Stop requests handed on and not yet answered, so none is handed on twice.
  private var handedStops: Set<String> = []
  private var watchers: [Task<Void, Never>] = []
  private var stopObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Events("onStartToken", "onActivityToken", "onActivityEnded", "onStop")

    OnCreate {
      Task { @MainActor in self.watch() }
      self.stopObserver = NotificationCenter.default.addObserver(
        forName: Self.stopAsked, object: nil, queue: .main
      ) { [weak self] _ in Task { @MainActor in self?.handOnStops() } }
    }

    OnDestroy {
      self.watchers.forEach { $0.cancel() }
      if let stopObserver = self.stopObserver { NotificationCenter.default.removeObserver(stopObserver) }
    }

    OnStartObserving {
      Task { @MainActor in
        self.listening = true
        if let token = self.startToken { self.sendEvent("onStartToken", ["token": token]) }
        for (_, token) in self.activityTokens { self.sendEvent("onActivityToken", ["token": token]) }
        self.handOnStops()
      }
    }

    OnStopObserving {
      Task { @MainActor in self.listening = false }
    }

    // A Stop request answered, whether or not the stop went, taken away so the intent returns.
    Function("answerStop") { (request: String) -> Void in
      Task { @MainActor in
        self.handedStops.remove(request)
        let defaults = UserDefaults.standard
        let left = (defaults.array(forKey: Self.stopsKey) ?? []).filter {
          ($0 as? [String: Any])?["request"] as? String != request
        }
        defaults.set(left, forKey: Self.stopsKey)
      }
    }

    AsyncFunction("startFixture") { (contentState: String) throws -> Void in
      let state = try JSONDecoder().decode(
        AgentsActivityAttributes.ContentState.self, from: Data(contentState.utf8))
      _ = try Activity.request(
        attributes: AgentsActivityAttributes(), content: .init(state: state, staleDate: nil))
    }

    AsyncFunction("endAll") { () async -> Void in
      for activity in Activity<AgentsActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  /// Follows the push-to-start token and every activity's update token and end, for the module's life.
  @MainActor private func watch() {
    watchers.append(
      Task { @MainActor [weak self] in
        for await data in Activity<AgentsActivityAttributes>.pushToStartTokenUpdates {
          self?.took(startToken: Self.hex(data))
        }
      })
    watchers.append(
      Task { @MainActor [weak self] in
        for activity in Activity<AgentsActivityAttributes>.activities { self?.follow(activity) }
        for await activity in Activity<AgentsActivityAttributes>.activityUpdates { self?.follow(activity) }
      })
  }

  @MainActor private func follow(_ activity: Activity<AgentsActivityAttributes>) {
    watchers.append(
      Task { @MainActor [weak self] in
        for await data in activity.pushTokenUpdates {
          self?.took(activity: activity.id, token: Self.hex(data))
        }
      })
    watchers.append(
      Task { @MainActor [weak self] in
        for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
          self?.ended(activity: activity.id)
          return
        }
      })
  }

  @MainActor private func took(startToken token: String) {
    startToken = token
    if listening { sendEvent("onStartToken", ["token": token]) }
  }

  @MainActor private func took(activity id: String, token: String) {
    activityTokens[id] = token
    if listening { sendEvent("onActivityToken", ["token": token]) }
  }

  @MainActor private func ended(activity id: String) {
    activityTokens[id] = nil
    if listening { sendEvent("onActivityEnded") }
  }

  /// Hands each fresh Stop request on while JavaScript listens, dropping any too old to act on.
  @MainActor private func handOnStops() {
    guard listening else { return }
    let defaults = UserDefaults.standard
    let now = Date().timeIntervalSince1970 * 1000
    let requests = (defaults.array(forKey: Self.stopsKey) ?? []).compactMap { $0 as? [String: Any] }
    let fresh = requests.filter { now - ($0["askedAt"] as? Double ?? 0) < Self.stopFreshness }
    defaults.set(fresh, forKey: Self.stopsKey)
    for request in fresh {
      guard let id = request["request"] as? String, let agentId = request["agentId"] as? String,
        !handedStops.contains(id)
      else { continue }
      handedStops.insert(id)
      sendEvent("onStop", ["request": id, "agentId": agentId])
    }
  }

  private static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}
