// LiveActivityModule.swift -- the app's side of its Live Activity: the tokens the service pushes to, the activity's end, the Stop button's requests, and a fixture's activity started on the phone; and the Inbox widget drawn again once the app moves its snapshot.
//
// The service starts, updates, and ends the activity by push, so the app
// only hands it tokens: the push-to-start token, and the update token of
// each activity iOS starts. It also says when an activity ends or is
// dismissed, but for one it ended itself because a newer one started, so a
// push-to-start sent twice never stands two activities. Each goes to JavaScript as an event (`src/live-activity/`),
// and the latest token is sent again when it starts listening for it, since
// iOS hands each once. Each activity's update token is kept in the app's
// defaults too, so one iOS handed while the app ran in the background, or
// in a launch that ended before its JavaScript was up, is handed on at the
// next launch. Note that iOS wakes the app for a short while when the
// service push-to-starts an activity, often too short for the host to boot,
// so a new update token is also sent to the service from Swift at once,
// under the access token the share sheet reads (`ShareToken`), to the phone
// JavaScript kept here once the service held it (`keepPhone`); where that
// send fails, as with an access token past its 50 minutes, the next launch's
// JavaScript sends the kept token. A Stop pressed on the activity (`StopAgentIntent`, in
// the app's target) waits in the standard defaults; each is handed on while
// JavaScript listens for Stops, and taken away once it answers. A fixture run starts
// an activity of its own (`startFixture`), since no push reaches a
// simulator, and ends it (`endAll`). The Inbox widget, which the same
// extension draws, is asked to draw again (`reloadInboxWidget`) once the
// app's JavaScript has written its snapshot into the App Group
// (`src/inbox-widget/`), since only WidgetKit's Swift can ask.

import ActivityKit
import ExpoModulesCore
import Foundation
import UIKit
import VespinShareToken
import WidgetKit

/// The phone as the service names it, with where and how to reach the service, as the app's JavaScript keeps it once the service holds the phone.
private struct KeptPhone: Codable {
  let origin: String
  let deviceToken: String
  let environment: String
  let headers: [String: String]
}

public final class LiveActivityModule: Module {
  /// The defaults key and the ping `StopAgentIntent` names.
  private static let stopsKey = "dev.vespin.live-activity.stops"
  private static let stopAsked = Notification.Name("dev.vespin.live-activity.stop-asked")
  /// How old a Stop may be and still be handed on: one left from a launch long gone is dropped.
  private static let stopFreshness: Double = 2 * 60 * 1000
  /// The defaults keys of each activity's update token, by the activity's id, and of the phone a token is sent beside.
  private static let tokensKey = "dev.vespin.live-activity.tokens"
  private static let phoneKey = "dev.vespin.live-activity.phone"
  /// The service's path for an activity's update token (`HOSTED_SERVICE_PATH.ACCOUNT_LIVE_ACTIVITIES_ACTIVITY_TOKEN`).
  private static let activityTokenPath = "/api/account/live-activities/activity-token"
  /// The longest a send from Swift waits on the service, inside the few seconds iOS gives a woken app.
  private static let sendTimeout: TimeInterval = 10

  // Note that the state below is read and written on the main actor alone.
  /// Which events JavaScript listens for, each started and stopped on its own.
  private var listening: Set<String> = []
  private var startToken: String?
  private var activityTokens: [String: String] = [:]
  /// The activities ended because a newer one started, whose end the service is not told, since it would drop the newer one's token.
  private var superseded: Set<String> = []
  /// The Stop requests handed on and not yet answered, so none is handed on twice.
  private var handedStops: Set<String> = []
  private var watchers: [Task<Void, Never>] = []
  private var stopObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Events("onStartToken", "onActivityToken", "onActivityEnded", "onStop")

    OnCreate {
      Task { @MainActor in
        self.restoreTokens()
        self.watch()
      }
      self.stopObserver = NotificationCenter.default.addObserver(
        forName: Self.stopAsked, object: nil, queue: .main
      ) { [weak self] _ in Task { @MainActor in self?.handOnStops() } }
    }

    OnDestroy {
      self.watchers.forEach { $0.cancel() }
      if let stopObserver = self.stopObserver { NotificationCenter.default.removeObserver(stopObserver) }
    }

    OnStartObserving("onStartToken") {
      Task { @MainActor in
        self.listening.insert("onStartToken")
        if let token = self.startToken { self.sendEvent("onStartToken", ["token": token]) }
      }
    }

    OnStartObserving("onActivityToken") {
      Task { @MainActor in
        self.listening.insert("onActivityToken")
        for (_, token) in self.activityTokens { self.sendEvent("onActivityToken", ["token": token]) }
      }
    }

    OnStartObserving("onActivityEnded") {
      Task { @MainActor in self.listening.insert("onActivityEnded") }
    }

    OnStartObserving("onStop") {
      Task { @MainActor in
        self.listening.insert("onStop")
        self.handOnStops()
      }
    }

    OnStopObserving("onStartToken") { Task { @MainActor in self.listening.remove("onStartToken") } }
    OnStopObserving("onActivityToken") { Task { @MainActor in self.listening.remove("onActivityToken") } }
    OnStopObserving("onActivityEnded") { Task { @MainActor in self.listening.remove("onActivityEnded") } }
    OnStopObserving("onStop") { Task { @MainActor in self.listening.remove("onStop") } }

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

    // The phone the service holds, as JSON, kept so a token iOS hands in the background can be sent from here; none once the account signs out.
    Function("keepPhone") { (phone: String?) -> Void in
      let defaults = UserDefaults.standard
      guard let phone, let data = phone.data(using: .utf8),
        (try? JSONDecoder().decode(KeptPhone.self, from: data)) != nil
      else {
        defaults.removeObject(forKey: Self.phoneKey)
        return
      }
      defaults.set(data, forKey: Self.phoneKey)
    }

    // The Inbox widget's kind, as `InboxWidgetSnapshot.kind` names it in the widget extension.
    Function("reloadInboxWidget") { () -> Void in
      WidgetCenter.shared.reloadTimelines(ofKind: "InboxWidget")
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
        for await activity in Activity<AgentsActivityAttributes>.activityUpdates {
          self?.supersede(by: activity)
          self?.follow(activity)
        }
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

  /// Ends every activity older than `newest` at once, so a push-to-start the service sent twice never stands two activities on the phone.
  @MainActor private func supersede(by newest: Activity<AgentsActivityAttributes>) {
    for older in Activity<AgentsActivityAttributes>.activities where older.id != newest.id {
      superseded.insert(older.id)
      activityTokens[older.id] = nil
      Task { await older.end(nil, dismissalPolicy: .immediate) }
    }
  }

  @MainActor private func took(startToken token: String) {
    startToken = token
    if listening.contains("onStartToken") { sendEvent("onStartToken", ["token": token]) }
  }

  @MainActor private func took(activity id: String, token: String) {
    // A superseded activity's late token never reaches the service, which pushes to the newest alone.
    guard !superseded.contains(id) else { return }
    let fresh = activityTokens[id] != token
    activityTokens[id] = token
    keepTokens()
    if fresh { send(activityToken: token) }
    if listening.contains("onActivityToken") { sendEvent("onActivityToken", ["token": token]) }
  }

  @MainActor private func ended(activity id: String) {
    let token = activityTokens.removeValue(forKey: id)
    keepTokens()
    if superseded.remove(id) != nil { return }
    // The ended activity's own token, so the service clears it only while it still holds that one.
    if listening.contains("onActivityEnded") { sendEvent("onActivityEnded", ["token": token]) }
  }

  /// Hands each fresh Stop request on while JavaScript listens, dropping any too old to act on.
  @MainActor private func handOnStops() {
    guard listening.contains("onStop") else { return }
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

  /// Takes back the tokens an earlier launch kept, for the activities that still stand, so JavaScript hands on any the service may lack.
  @MainActor private func restoreTokens() {
    let kept = UserDefaults.standard.dictionary(forKey: Self.tokensKey) as? [String: String] ?? [:]
    let standing = Set(Activity<AgentsActivityAttributes>.activities.map(\.id))
    activityTokens = kept.filter { standing.contains($0.key) }
    keepTokens()
  }

  @MainActor private func keepTokens() {
    UserDefaults.standard.set(activityTokens, forKey: Self.tokensKey)
  }

  /// Sends an activity's update token to the service at once while the app is in the background, in the time iOS gives it, where JavaScript kept a phone and the share sheet's access token is still good; a send that can't go or fails is left to the next launch. In front, the host sends it.
  @MainActor private func send(activityToken token: String) {
    guard UIApplication.shared.applicationState != .active,
      let data = UserDefaults.standard.data(forKey: Self.phoneKey),
      let phone = try? JSONDecoder().decode(KeptPhone.self, from: data),
      let url = URL(string: phone.origin + Self.activityTokenPath),
      let access = ShareToken.read(),
      let body = try? JSONEncoder().encode([
        "deviceToken": phone.deviceToken, "environment": phone.environment, "token": token,
      ])
    else { return }
    var request = URLRequest(url: url, timeoutInterval: Self.sendTimeout)
    request.httpMethod = "POST"
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
    for (name, value) in phone.headers { request.setValue(value, forHTTPHeaderField: name) }
    // Note that the send asks for background time of its own, since the app may be suspended as soon as iOS's wake is spent.
    let application = UIApplication.shared
    var background = UIBackgroundTaskIdentifier.invalid
    background = application.beginBackgroundTask(withName: "live-activity-token") {
      application.endBackgroundTask(background)
    }
    URLSession.shared.dataTask(with: request) { _, _, _ in
      DispatchQueue.main.async { application.endBackgroundTask(background) }
    }.resume()
  }

  private static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}
