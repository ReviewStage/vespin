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
  /// Where a link goes while JavaScript listens; none while it does not.
  var sink: (([String: Any]) -> Void)? {
    didSet {
      guard let sink else { return }
      let handed = waiting
      waiting = []
      handed.forEach(sink)
    }
  }

  func hand(_ continued: [String: Any]) {
    if let sink { sink(continued) } else { waiting.append(continued) }
  }
}

public final class SystemActivityModule: Module {
  /// Our activity type, declared in the app's `NSUserActivityTypes` (`@repo/features/ios-system-activity`).
  static let activityType = "dev.vespin.viewing"
  /// The key a pull request's activity names its number under, since its page is its agent's Changes.
  static let pullRequestKey = "pullRequest"
  /// The app's own index, apart from the default one so its protection is its own.
  private static let indexName = "dev.vespin.spotlight"

  private lazy var index = CSSearchableIndex(name: Self.indexName, protectionClass: .complete)
  // Note that the activity is read and written on the main thread alone.
  private var current: NSUserActivity?

  public func definition() -> ModuleDefinition {
    Name("SystemActivity")

    Events("onContinue")

    OnStartObserving("onContinue") {
      DispatchQueue.main.async {
        ContinuedLinks.shared.sink = { [weak self] continued in
          self?.sendEvent("onContinue", continued)
        }
      }
    }

    OnStopObserving("onContinue") {
      DispatchQueue.main.async { ContinuedLinks.shared.sink = nil }
    }

    AsyncFunction("setCurrent") { (record: ActivityRecord) in
      self.advertise(record)
    }.runOnQueue(.main)

    AsyncFunction("clearCurrent") { (webpageUrl: String) in
      self.withdraw(webpageUrl)
    }.runOnQueue(.main)

    AsyncFunction("index") { (items: [SpotlightRecord]) async throws in
      try await self.index.indexSearchableItems(items.map(Self.searchableItem))
    }

    AsyncFunction("remove") { (ids: [String]) async throws in
      try await self.index.deleteSearchableItems(withIdentifiers: ids)
    }

    AsyncFunction("removeAll") { () async throws in
      try await self.index.deleteAllSearchableItems()
    }
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

  private static func searchableItem(_ record: SpotlightRecord) -> CSSearchableItem {
    let attributes = CSSearchableItemAttributeSet(contentType: .text)
    attributes.title = record.title
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
