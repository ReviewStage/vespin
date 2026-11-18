// LiveActivityModule.swift -- the app's side of its Live Activities: the tokens the service pushes to, the agents' activity's end, the Stop button's send, and a fixture's activity started on the phone; a voice call's activity, started, set, and ended on the phone, and its presses; and the Inbox widget drawn again once the app moves its snapshot.
//
// The service starts, updates, and ends the activity by push, so the app
// only hands it tokens: the push-to-start token, and the update token of
// each activity iOS starts. It also says when an activity ends or is
// dismissed, but for one it ended itself because a newer one stands, so a
// push-to-start sent twice never stands two activities: whenever the module
// starts, at a launch or a wake, and whenever an activity appears, every
// agents' activity but the newest is ended and dismissed at once. The
// newest is the one the service pushed last, whose stale date, which every
// push sets a fixed while after it, lies furthest ahead. Each goes to JavaScript as an event (`src/live-activity/`),
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
// JavaScript sends the kept token. A Stop pressed on the activity
// (`StopAgentIntent`, in the app's target) is sent to the service the same
// way (`AgentStop`). A fixture run starts
// an activity of its own (`startFixture`), since no push reaches a
// simulator, and ends it (`endAll`). A voice call's activity is the
// phone's alone (`CallActivityAttributes`): JavaScript starts it as a call
// connects (`startCall`), sets each state as the call changes
// (`updateCall`), and ends it with the call (`endCall`), and a press on it
// (`CallPressIntent`, in the app's target) pings this module, which hands it
// on as an event while JavaScript listens, since the call keeps the app
// running, and draws a mute's new state on the activity at once, which
// JavaScript's next state confirms. The Inbox widget, which the same
// extension draws, is asked to draw again (`reloadInboxWidget`) once the
// app's JavaScript has written its snapshot into the App Group
// (`src/inbox-widget/`), since only WidgetKit's Swift can ask. It also
// hands JavaScript iOS's background time (`beginBackgroundTask`,
// `endBackgroundTask`), which the account's renewal holds from its refresh
// grant through the write that keeps it, so a move to the background
// between the two can't lose the rotated tokens.

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

/// The defaults key of the phone a send from Swift goes beside, which JavaScript keeps (`keepPhone`).
private let keptPhoneKey = "dev.vespin.live-activity.phone"
/// The longest a send from Swift waits on the service, inside the few seconds iOS gives a woken app or an intent.
private let keptPhoneTimeout: TimeInterval = 10

/// A POST to the service at `path`, under the phone JavaScript kept and the share sheet's access token, with the JSON `body` names; none where no phone is kept or the token has expired.
private func keptPhoneRequest(path: String, body: ((KeptPhone) -> [String: String])? = nil)
  -> URLRequest?
{
  guard let data = UserDefaults.standard.data(forKey: keptPhoneKey),
    let phone = try? JSONDecoder().decode(KeptPhone.self, from: data),
    let url = URL(string: phone.origin + path),
    let access = ShareToken.read()
  else { return nil }
  var request = URLRequest(url: url, timeoutInterval: keptPhoneTimeout)
  request.httpMethod = "POST"
  if let body {
    guard let encoded = try? JSONEncoder().encode(body(phone)) else { return nil }
    request.httpBody = encoded
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  }
  request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
  for (name, value) in phone.headers { request.setValue(value, forHTTPHeaderField: name) }
  return request
}

/// The Live Activity's Stop, sent to the service from Swift (`StopAgentIntent`, in the app's target).
public enum AgentStop {
  /// The characters an agent's id keeps in its path, so an id can never reach another route.
  private static let idCharacters = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))

  /// Stops `agentId` (`POST /api/agents/{id}/stop`); whether the service took it, and false where it couldn't be sent, as under an access token past its 50 minutes, or the service refused it.
  public static func send(agentId: String) async -> Bool {
    guard let id = agentId.addingPercentEncoding(withAllowedCharacters: idCharacters),
      let request = keptPhoneRequest(path: "/api/agents/\(id)/stop")
    else { return false }
    let answer = try? await URLSession.shared.data(for: request)
    guard let status = (answer?.1 as? HTTPURLResponse)?.statusCode else { return false }
    return (200..<300).contains(status)
  }
}

/// How highly iOS ranks a voice call's activity among the app's, which decides the one the Dynamic Island shows: above the agents' activity, whose pushes carry no score and so rank at none, since a call standing is what the member is doing now.
enum CallRelevance {
  static let score: Double = 100
}

/// A press on the call's activity, as `CallPressIntent` pings it: what it sets, and the agent its activity shows.
private struct CallPress {
  let press: String
  let agentId: String
}

public final class LiveActivityModule: Module {
  /// The ping `CallPressIntent` names.
  private static let callPressed = Notification.Name("dev.vespin.live-activity.call-press")
  /// The defaults key of each activity's update token, by the activity's id.
  private static let tokensKey = "dev.vespin.live-activity.tokens"
  /// The service's path for an activity's update token (`HOSTED_SERVICE_PATH.ACCOUNT_LIVE_ACTIVITIES_ACTIVITY_TOKEN`).
  private static let activityTokenPath = "/api/account/live-activities/activity-token"

  // Note that the state below is read and written on the main actor alone.
  /// Which events JavaScript listens for, each started and stopped on its own.
  private var listening: Set<String> = []
  private var startToken: String?
  private var activityTokens: [String: String] = [:]
  /// The activities ended because a newer one started, whose end the service is not told, since it would drop the newer one's token.
  private var superseded: Set<String> = []
  private var watchers: [Task<Void, Never>] = []
  private var callPressObserver: NSObjectProtocol?
  /// Where the call's presses wait their turn, taken one at a time in the order they came.
  private var callPressQueue: AsyncStream<CallPress>.Continuation?
  /// The one task that takes the call's presses from their queue.
  private var callPressTaker: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Events("onStartToken", "onActivityToken", "onActivityEnded", "onCallPress")

    OnCreate {
      Task { @MainActor in
        // Note that the kept tokens are read first, since keeping the newest writes back what it keeps.
        self.restoreTokens()
        self.keepNewest(preferring: nil)
        self.watch()
      }
      // Note that presses are taken one at a time, in the order they came, since each waits on the activity's update before it goes on, and two such waits may end in either order: a mute then an unmute must reach the call in that order, or the call ends muted.
      let (callPresses, nextCallPress) = AsyncStream.makeStream(of: CallPress.self)
      self.callPressQueue = nextCallPress
      self.callPressTaker = Task { @MainActor [weak self] in
        for await taken in callPresses {
          guard let self else { return }
          guard self.listening.contains("onCallPress") else { continue }
          // Note that the activity shows a mute at once, rather than after JavaScript's round trip mirrors the call back, which felt delayed on a call; the mirror then confirms it, or sets it back where the call refused.
          await Self.showCallPress(taken.press, agentId: taken.agentId)
          self.sendEvent("onCallPress", ["press": taken.press, "agentId": taken.agentId])
        }
      }
      self.callPressObserver = NotificationCenter.default.addObserver(
        forName: Self.callPressed, object: nil, queue: .main
      ) { note in
        guard let press = note.userInfo?["press"] as? String,
          let agentId = note.userInfo?["agentId"] as? String
        else { return }
        nextCallPress.yield(CallPress(press: press, agentId: agentId))
      }
    }

    OnDestroy {
      self.callPressQueue?.finish()
      self.callPressTaker?.cancel()
      self.watchers.forEach { $0.cancel() }
      if let callPressObserver = self.callPressObserver {
        NotificationCenter.default.removeObserver(callPressObserver)
      }
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

    OnStopObserving("onStartToken") { Task { @MainActor in self.listening.remove("onStartToken") } }
    OnStopObserving("onActivityToken") { Task { @MainActor in self.listening.remove("onActivityToken") } }
    OnStopObserving("onActivityEnded") { Task { @MainActor in self.listening.remove("onActivityEnded") } }
    OnStartObserving("onCallPress") { Task { @MainActor in self.listening.insert("onCallPress") } }
    OnStopObserving("onCallPress") { Task { @MainActor in self.listening.remove("onCallPress") } }

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
        defaults.removeObject(forKey: keptPhoneKey)
        return
      }
      defaults.set(data, forKey: keptPhoneKey)
    }

    // Background time asked for by name, answered as its identifier for `endBackgroundTask`. Note that iOS's expiry ends the task itself, as Apple's own pattern does, so a hold is never left open; JavaScript's end after an expiry only logs that the task is gone. Both calls are safe off the main thread.
    Function("beginBackgroundTask") { (name: String) -> Int in
      let application = UIApplication.shared
      var identifier = UIBackgroundTaskIdentifier.invalid
      identifier = application.beginBackgroundTask(withName: name) {
        application.endBackgroundTask(identifier)
      }
      return identifier.rawValue
    }

    Function("endBackgroundTask") { (identifier: Int) -> Void in
      guard identifier != UIBackgroundTaskIdentifier.invalid.rawValue else { return }
      UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: identifier))
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

    // A voice call's activity started, from its attributes' JSON and its first state's; one left from an earlier call ends first, so one call never stands two.
    AsyncFunction("startCall") { (attributes: String, contentState: String) async throws -> Void in
      let decoder = JSONDecoder()
      let called = try decoder.decode(CallActivityAttributes.self, from: Data(attributes.utf8))
      let state = try decoder.decode(
        CallActivityAttributes.ContentState.self, from: Data(contentState.utf8))
      for activity in Activity<CallActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      _ = try Activity.request(
        attributes: called,
        content: .init(state: state, staleDate: nil, relevanceScore: CallRelevance.score))
    }

    // The call's activity set to a new state, from its JSON.
    AsyncFunction("updateCall") { (contentState: String) async throws -> Void in
      let state = try JSONDecoder().decode(
        CallActivityAttributes.ContentState.self, from: Data(contentState.utf8))
      for activity in Activity<CallActivityAttributes>.activities {
        await activity.update(
          .init(state: state, staleDate: nil, relevanceScore: CallRelevance.score))
      }
    }

    // The call's activity gone at once, the call having ended.
    AsyncFunction("endCall") { () async -> Void in
      for activity in Activity<CallActivityAttributes>.activities {
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
        for activity in Activity<AgentsActivityAttributes>.activities
        where self?.superseded.contains(activity.id) == false {
          self?.follow(activity)
        }
        for await activity in Activity<AgentsActivityAttributes>.activityUpdates {
          self?.keepNewest(preferring: activity.id)
          guard self?.superseded.contains(activity.id) == false else { continue }
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

  /// Ends every agents' activity but the newest at once, so a push-to-start the service sent twice never stands two activities on the phone. The newest is the one whose stale date lies furthest ahead, and `preferred`, the one that just appeared, where they tie.
  @MainActor private func keepNewest(preferring preferred: String?) {
    let activities = Activity<AgentsActivityAttributes>.activities.filter { !superseded.contains($0.id) }
    let kept = activities.max { older, newer in
      let olderStale = older.content.staleDate ?? .distantPast
      let newerStale = newer.content.staleDate ?? .distantPast
      if olderStale != newerStale { return olderStale < newerStale }
      return newer.id == preferred
    }
    guard let kept else { return }
    for older in activities where older.id != kept.id {
      superseded.insert(older.id)
      activityTokens[older.id] = nil
      Task { await older.end(nil, dismissalPolicy: .immediate) }
    }
    keepTokens()
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

  /// The call's activity drawn with a mute press already set, for the agent the press names: the microphone's or the speaker's muted flag as the press sets it. End call and a press it doesn't know leave the activity to JavaScript.
  @MainActor
  private static func showCallPress(_ press: String, agentId: String) async {
    for activity in Activity<CallActivityAttributes>.activities
    where activity.attributes.agentId == agentId {
      var state = activity.content.state
      switch press {
      case "mute-microphone": state.microphoneMuted = true
      case "unmute-microphone": state.microphoneMuted = false
      case "mute-speaker": state.speakerMuted = true
      case "unmute-speaker": state.speakerMuted = false
      default: return
      }
      guard state != activity.content.state else { continue }
      await activity.update(
        .init(state: state, staleDate: nil, relevanceScore: CallRelevance.score))
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
      let request = keptPhoneRequest(path: Self.activityTokenPath, body: { phone in
        ["deviceToken": phone.deviceToken, "environment": phone.environment, "token": token]
      })
    else { return }
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
