// ShareViewController.swift -- the share extension's principal class: the system's share sheet hands it what was shared, and it stands the app's share page, drawn by React Native from the extension's own bundle, under the system's own bar.
//
// The page is the app's own (`src/share/share-page.tsx`), run from the
// extension's JavaScript entry (`share.ts`), which Xcode bundles into the
// extension beside this file (`app.config.ts`). It runs with no host: it reads
// the snapshot the app left in their App Group, sends through the service's
// own routes under the access token it reads at send time, and keeps a draft
// for the app where a send did not go. This controller is the page's host
// (`ShareExtensionHost`, `modules/share-extension/`): it reads what was shared
// as React Native starts, so neither waits on the other; stands the bar, its
// title, the system's search field stacked under it and the close button, as
// the app's stack stands them; and ends the sheet. No public API opens the app
// from an extension, so the way back is the notification and the draft.

import React
import ReactAppDependencyProvider
import UIKit
import VespinShareExtension

internal import Expo

/// How tall the sheet asks to stand on an iPad, in points: the places to tick over the composer, rather than a form sheet's default.
private let padSheetHeight: CGFloat = 640

/// The name the extension's JavaScript registers its page under (`share.ts`).
private let pageModuleName = "ShareExtension"

/// React Native's delegate for the extension: its bundle is always the one built into the extension (`share.jsbundle`, named apart from the app's), since a share sheet has no Metro to reach.
final class ShareReactDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
    Bundle.main.url(forResource: "share", withExtension: "jsbundle")
  }
}

final class ShareViewController: UIViewController, ShareExtensionHost, UISearchResultsUpdating {
  private let gate = ShareGate()
  private var factory: ExpoReactNativeFactory?
  private var factoryDelegate: ShareReactDelegate?
  private var items: Task<[String: Any], Never>?
  private var page: UIViewController?
  private var ended = false

  override func viewDidLoad() {
    super.viewDidLoad()
    gate.start()
    // Note that an iPhone's share sheet stands at the system's own height, while an iPad's form sheet takes the height its controller asks for.
    if traitCollection.userInterfaceIdiom == .pad {
      preferredContentSize = CGSize(width: preferredContentSize.width, height: padSheetHeight)
    }
    ShareExtensionBridge.host = self
    let inputs = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    items = Task { await SharedItems.read(inputs) }
    standPage()
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Note that a sheet swiped away ends here, with neither finish nor cancel.
    tearDown()
  }

  /// React Native's page in a navigation controller of its own, under the system's bar with its search field and close button.
  private func standPage() {
    let delegate = ShareReactDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    factoryDelegate = delegate
    self.factory = factory

    let page = UIViewController()
    page.view = factory.rootViewFactory.view(withModuleName: pageModuleName, initialProperties: [:])
    page.view.backgroundColor = .systemBackground

    let search = UISearchController(searchResultsController: nil)
    search.searchResultsUpdater = self
    search.obscuresBackgroundDuringPresentation = false
    search.hidesNavigationBarDuringPresentation = false
    page.navigationItem.searchController = search
    page.navigationItem.hidesSearchBarWhenScrolling = false
    page.navigationItem.preferredSearchBarPlacement = .stacked
    page.navigationItem.largeTitleDisplayMode = .never
    page.navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.cancel() })
    self.page = page

    let navigation = UINavigationController(rootViewController: page)
    // Note that the bar's buttons wear the ink, as the app's stack tints its own.
    navigation.view.tintColor = .label
    addChild(navigation)
    navigation.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(navigation.view)
    NSLayoutConstraint.activate([
      navigation.view.topAnchor.constraint(equalTo: view.topAnchor),
      navigation.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      navigation.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      navigation.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    navigation.didMove(toParent: self)
  }

  func updateSearchResults(for searchController: UISearchController) {
    NotificationCenter.default.post(
      name: ShareExtensionBridge.searched, object: nil,
      userInfo: ["text": searchController.searchBar.text ?? ""])
  }

  // MARK: ShareExtensionHost

  func sharedItems() async -> [String: Any] {
    await items?.value ?? [:]
  }

  func snapshot() -> String? {
    AppGroupFiles.snapshot()
  }

  // Note that this is the one place the extension reads the token, and only as the page sends.
  func accessToken() -> String? {
    ShareToken.read()
  }

  func picture(_ address: String) -> String? {
    SharedItems.picture(address)?.base64EncodedString()
  }

  func keepDraft(_ json: String, pictures: [String]) -> Bool {
    // Note that only pictures this sheet wrote are kept, whatever paths the page names.
    let kept = pictures.compactMap(SharedItems.picture)
    return kept.count == pictures.count && AppGroupFiles.keep(json, pictures: kept)
  }

  func notify(id: String, title: String, body: String, payload: [String: Any]) async -> Bool {
    await ShareNotice.post(id: id, title: title, body: body, payload: payload)
  }

  func setBar(title: String, search: String, close: String) {
    page?.navigationItem.title = title
    page?.navigationItem.searchController?.searchBar.placeholder = search
    page?.navigationItem.leftBarButtonItem?.accessibilityLabel = close
  }

  func drawn() {
    gate.drawn()
  }

  func finish() {
    guard !ended else { return }
    ended = true
    extensionContext?.completeRequest(returningItems: nil)
    tearDown()
  }

  private func cancel() {
    guard !ended else { return }
    ended = true
    extensionContext?.cancelRequest(
      withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    tearDown()
  }

  /// Logs the sheet's measurements, and lets React Native and what was shared go.
  private func tearDown() {
    gate.end()
    items?.cancel()
    SharedItems.removePictures()
    page?.view = UIView()
    factory = nil
    factoryDelegate = nil
    if ShareExtensionBridge.host === self { ShareExtensionBridge.host = nil }
  }
}
