// SystemActivityModule.swift -- the app's side of Handoff and Spotlight: the activity the screen standing advertises, the index of the member's tasks and Inbox threads, and each continued activity or tapped item handed to JavaScript.
//
// A screen's activity (`setCurrent`) is our own type, its title, and
// its page on vespin.dev, so Handoff offers it to the member's other devices:
// one with an app that takes the type opens it there, and any other opens the
// page in its browser. It is eligible for Handoff alone, never for Spotlight
// or Siri, since the index below holds what Spotlight finds. The index is the
// app's own, named, and kept under complete file protection, so nothing of it
// is read while the device is locked; JavaScript adds and removes its items
// (`src/system-activity/`), each named by its vespin.dev link.
//
// What comes back, an activity of our type another device handed over or
// a Spotlight item tapped, reaches the app delegate
// (`SystemActivityAppDelegateSubscriber`), which hands its link here; one that
// came before JavaScript listened, as on a launch it opened, waits until it
// does (`ContinuedLinks`). Note that a link the system hands as a browsing
// activity, Safari's on the Mac among them, is React Native's, which routes it
// as any universal link.

import CoreSpotlight
import ExpoModulesCore
import Foundation
import OSLog
import UIKit
import UniformTypeIdentifiers

/// The activity a screen advertises, as `src/system-activity/` sends it.
struct ActivityRecord: Record {
  @Field var title: String = ""
  @Field var webpageUrl: String = ""
  @Field var pullRequest: Int?
}

/// One task or thread as Spotlight finds it, named by its vespin.dev link.
struct SpotlightRecord: Record {
  @Field var id: String = ""
  @Field var domain: String = ""
  @Field var title: String = ""
  @Field var summary: String = ""
}

/// The links continued or tapped, each handed to JavaScript once it listens. Read and written on the main thread alone.
final class ContinuedLinks {
  static let shared = ContinuedLinks()

  private var waiting: [[String: Any]] = []
  /// Where a link goes while JavaScript listens, and the module that listens; none while none does.
  private var sink: (([String: Any]) -> Void)?
  private weak var owner: AnyObject?

  /// Hands each link to `sink` from now on, those waiting first, for as long as `owner` listens.
  func listen(_ owner: AnyObject, _ sink: @escaping ([String: Any]) -> Void) {
    self.owner = owner
    self.sink = sink
    let handed = waiting
    waiting = []
    handed.forEach(sink)
  }

  /// Holds links again once `owner` stops listening or goes, unless another module listens by now, as after a reload.
  func release(_ owner: AnyObject) {
    guard self.owner === owner || self.owner == nil else { return }
    self.owner = nil
    sink = nil
  }

  func hand(_ continued: [String: Any]) {
    if let sink, owner != nil { sink(continued) } else { waiting.append(continued) }
  }
}

/// A `replaceAll`'s two answers, the delete-all's and the items', settling its promise once both are in, or a while after the items' where the delete-all never answers, refused where either was. Note that the system documents no order between the two completions, so neither is assumed to come first; and that the delete-all is waited on only so long, because the system was seen never to answer one on an index it held nothing of. Its state is read and written on its own queue alone.
final class Replacement: @unchecked Sendable {
  /// How long the delete-all may still answer once the items are added.
  private static let grace: DispatchTimeInterval = .seconds(5)

  private let queue = DispatchQueue(label: "dev.vespin.spotlight.replacement")
  private let settle: @Sendable (Error?) -> Void
  private var emptying: Result<Void, Error>?
  private var adding: Result<Void, Error>?
  private var settled = false

  init(_ settle: @escaping @Sendable (Error?) -> Void) {
    self.settle = settle
  }

  func emptied(_ error: Error?) {
    queue.async {
      self.emptying = Self.result(error)
      self.settleOnceAnswered()
    }
  }

  func added(_ error: Error?) {
    queue.async {
      self.adding = Self.result(error)
      self.settleOnceAnswered()
      self.queue.asyncAfter(deadline: .now() + Self.grace) { self.settleUnemptied() }
    }
  }

  private static func result(_ error: Error?) -> Result<Void, Error> {
    error.map { .failure($0) } ?? .success(())
  }

  private static func failure(_ result: Result<Void, Error>?) -> Error? {
    guard case .failure(let error) = result else { return nil }
    return error
  }

  /// Settles once both have answered, or at once where the items were refused.
  private func settleOnceAnswered() {
    guard !settled, let adding else { return }
    let refusal = Self.failure(adding) ?? Self.failure(emptying)
    guard emptying != nil || refusal != nil else { return }
    settled = true
    settle(refusal)
  }

  /// Settles with the items' answer alone where the delete-all has not answered by the grace's end.
  private func settleUnemptied() {
    guard !settled, let adding else { return }
    settled = true
    settle(Self.failure(adding))
  }
}

public final class SystemActivityModule: Module {
  /// Our activity type, declared in the app's `NSUserActivityTypes` (`@repo/features/ios-system-activity`).
  static let activityType = "dev.vespin.viewing"
  /// The key a pull request's activity names its number under, since its page is its agent's Changes.
  static let pullRequestKey = "pullRequest"
  /// The app's own index, apart from the default one so its protection is its own.
  private static let indexName = "dev.vespin.spotlight"
  /// Where the index's answers are said in the device log.
  private static let log = Logger(subsystem: "dev.vespin.ios", category: "spotlight")

  /// The queue every Spotlight call runs on, apart from Expo's one shared async queue.
  private static let calls = DispatchQueue(label: "dev.vespin.spotlight.calls")

  private lazy var index = CSSearchableIndex(name: Self.indexName, protectionClass: .complete)
  // Note that the activity is read and written on the main thread alone.
  private var current: NSUserActivity?

  public func definition() -> ModuleDefinition {
    Name("SystemActivity")

    Events("onContinue")

    OnStartObserving("onContinue") {
      DispatchQueue.main.async {
        ContinuedLinks.shared.listen(self) { [weak self] continued in
          self?.sendEvent("onContinue", continued)
        }
      }
    }

    OnStopObserving("onContinue") {
      DispatchQueue.main.async { ContinuedLinks.shared.release(self) }
    }

    // Note that a module torn down, as on a reload, lets go too, so a link handed before the next one listens waits rather than reaching a sink no one hears.
    OnDestroy {
      DispatchQueue.main.async { ContinuedLinks.shared.release(self) }
    }

    AsyncFunction("setCurrent") { (record: ActivityRecord) in
      self.advertise(record)
    }.runOnQueue(.main)

    AsyncFunction("clearCurrent") { (webpageUrl: String) in
      self.withdraw(webpageUrl)
    }.runOnQueue(.main)

    // Note that each Spotlight call runs on the module's own serial queue (`calls`), so the system takes them in the order JavaScript made them while no call holds Expo's one shared async queue, which every other module's calls wait on. Each is answered by its own completion alone, and none waits on the answer to the one before, because the system was seen never to answer a delete-all on an index it held nothing of, and every call awaiting it then never reached the index.
    // Note that a refused delete-all refuses the whole call (`Replacement`), so the index is never taken as holding the lists alone while an earlier account's items may stand in it.
    AsyncFunction("replaceAll") { (items: [SpotlightRecord], promise: Promise) in
      let replacement = Replacement(Self.answer(promise))
      self.index.deleteAllSearchableItems { error in
        if let error {
          Self.log.error("Spotlight's delete-all was refused: \(error.localizedDescription, privacy: .public)")
        } else {
          Self.log.notice("Spotlight's delete-all was answered")
        }
        replacement.emptied(error)
      }
      self.index.indexSearchableItems(items.map(Self.searchableItem), completionHandler: replacement.added)
    }.runOnQueue(Self.calls)

    AsyncFunction("index") { (items: [SpotlightRecord], promise: Promise) in
      self.index.indexSearchableItems(items.map(Self.searchableItem), completionHandler: Self.answer(promise))
    }.runOnQueue(Self.calls)

    AsyncFunction("remove") { (ids: [String], promise: Promise) in
      self.index.deleteSearchableItems(withIdentifiers: ids, completionHandler: Self.answer(promise))
    }.runOnQueue(Self.calls)

    AsyncFunction("removeAll") { (promise: Promise) in
      self.index.deleteAllSearchableItems(completionHandler: Self.answer(promise))
    }.runOnQueue(Self.calls)
  }

  /// What the system handed back, as JavaScript reads it: the link, and a pull request's number; none for an activity that is not ours.
  static func continued(_ activity: NSUserActivity) -> [String: Any]? {
    switch activity.activityType {
    case activityType:
      guard let link = activity.webpageURL?.absoluteString else { return nil }
      guard let number = activity.userInfo?[pullRequestKey] as? Int else { return ["link": link] }
      return ["link": link, "pullRequest": number]
    case CSSearchableItemActionType:
      guard let link = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return nil }
      return ["link": link]
    default:
      return nil
    }
  }

  /// Settles `promise` with what the index answered, said in the device log too, since JavaScript's console does not reach it in a Release build.
  private static func answer(_ promise: Promise) -> @Sendable (Error?) -> Void {
    return { error in
      guard let error else { return promise.resolve() }
      log.error("A Spotlight call was refused: \(error.localizedDescription, privacy: .public)")
      promise.reject(error)
    }
  }

  private static func searchableItem(_ record: SpotlightRecord) -> CSSearchableItem {
    let attributes = CSSearchableItemAttributeSet(contentType: .text)
    attributes.title = record.title
    // Note that the name is the title too, because Spotlight has matched a query against an item's display name alone since iOS 17, so an item with a title alone is held but never found.
    attributes.displayName = record.title
    attributes.contentDescription = record.summary
    return CSSearchableItem(
      uniqueIdentifier: record.id, domainIdentifier: record.domain, attributeSet: attributes)
  }

  /// The window's root view controller, whose activity UIKit makes current again each time the app comes forward.
  private static func rootViewController() -> UIViewController? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController
  }

  /// Advertises the screen's activity, the one standing updated in place where it names the same page.
  private func advertise(_ record: ActivityRecord) {
    guard let page = URL(string: record.webpageUrl), page.scheme == "https" else { return }
    let standing = current?.persistentIdentifier == record.webpageUrl ? current : nil
    let activity = standing ?? NSUserActivity(activityType: Self.activityType)
    activity.title = record.title
    activity.webpageURL = page
    activity.persistentIdentifier = record.webpageUrl
    activity.targetContentIdentifier = record.webpageUrl
    activity.userInfo = record.pullRequest.map { [Self.pullRequestKey: $0] } ?? [:]
    activity.isEligibleForHandoff = true
    activity.isEligibleForSearch = false
    activity.isEligibleForPrediction = false
    activity.isEligibleForPublicIndexing = false
    if current !== activity {
      current?.invalidate()
      current = activity
    }
    Self.rootViewController()?.userActivity = activity
    activity.becomeCurrent()
  }

  /// Takes the screen's activity back, as a screen that advertised one goes, unless another screen's stands by now.
  private func withdraw(_ webpageUrl: String) {
    guard current?.persistentIdentifier == webpageUrl else { return }
    if let root = Self.rootViewController(), root.userActivity === current { root.userActivity = nil }
    current?.invalidate()
    current = nil
  }
}

/// Hands each activity of ours that another device handed over, and each Spotlight item tapped, to `ContinuedLinks`; every other activity is left to the app delegate's other subscribers.
public final class SystemActivityAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    guard let continued = SystemActivityModule.continued(userActivity) else { return false }
    ContinuedLinks.shared.hand(continued)
    return true
  }
}
