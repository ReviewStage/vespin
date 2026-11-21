// PictureViewerModule.swift -- a picture a message carried, opened full screen as Photos opens one: zoomed out of the thumbnail pressed, drawn at once from the bitmap the thumbnail already shows, then sharpened to its full size.
//
// Quick Look held its presentation until it had read its file, so a press
// waited 0.9 to 1.7 seconds before anything moved. This viewer stands on the
// next frame: the press hands the thumbnail's place on screen, the viewer
// finds the image view drawn there and takes its decoded image as its first
// frame, and grows from it with UIKit's own zoom transition, which also
// closes it with a drag down, the page behind fading in. The picture's full
// size is read and decoded off the main thread and swapped in once it lands.
// A pinch or a double tap zooms, a tap hides or shows the bars, the bar names
// who showed it and when, and Share opens the system's sheet, which holds Copy
// and Save Image. Files other than pictures still open in Quick Look.

import ExpoModulesCore
import UIKit

/// The most a picture zooms past fitting the screen.
private let mostZoom: CGFloat = 4

/// How far a double tap zooms in.
private let doubleTapZoom: CGFloat = 2.5

/// How far up the view tree a thumbnail's image view is looked for from the view a press lands on.
private let ancestorReach = 6

/// The foreground scene's key window, which the viewer stands over.
private func keyWindow() -> UIWindow? {
  let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
  let front = scenes.filter { $0.activationState == .foregroundActive }
  return front.flatMap(\.windows).first(where: \.isKeyWindow)
    ?? scenes.flatMap(\.windows).first(where: \.isKeyWindow)
}

/// The controller on top of the window, which presents the viewer.
private func topmost(_ window: UIWindow) -> UIViewController? {
  var top = window.rootViewController
  while let shown = top?.presentedViewController, !shown.isBeingDismissed { top = shown }
  return top
}

/// The image view under `view` drawing an image across most of `place`, in window points, the deepest first.
private func imageView(under view: UIView, covering place: CGRect, in window: UIWindow) -> UIImageView? {
  for child in view.subviews.reversed() where !child.isHidden {
    if let found = imageView(under: child, covering: place, in: window) { return found }
  }
  guard let drawn = view as? UIImageView, drawn.image != nil else { return nil }
  let frame = drawn.convert(drawn.bounds, to: window)
  let shared = frame.intersection(place)
  guard !shared.isNull, place.width > 0, place.height > 0 else { return nil }
  return shared.width * shared.height >= place.width * place.height / 2 ? drawn : nil
}

/// The thumbnail drawn at `place` in the window: the image view the press landed on or one near it.
private func thumbnail(at place: CGRect, in window: UIWindow) -> UIImageView? {
  var node = window.hitTest(CGPoint(x: place.midX, y: place.midY), with: nil)
  for _ in 0..<ancestorReach {
    guard let view = node, !(view is UIWindow) else { return nil }
    if let found = imageView(under: view, covering: place, in: window) { return found }
    node = view.superview
  }
  return nil
}

/// The picture's bytes at `url`: a file, a `data:` address, or a web address.
private func bytes(at url: URL) async throws -> Data {
  if url.isFileURL || url.scheme == "data" { return try Data(contentsOf: url) }
  return try await URLSession.shared.data(from: url).0
}

/// One picture full screen: a scroll view zooming its image, the bars over it, and its share sheet.
final class PictureViewerController: UIViewController, UIScrollViewDelegate {
  private let source: URL
  private let scroll = UIScrollView()
  private let imageView = UIImageView()
  private var barsHidden = false

  init(source: URL, first: UIImage?, title: String, subtitle: String?) {
    self.source = source
    super.init(nibName: nil, bundle: nil)
    imageView.image = first
    navigationItem.title = title
    navigationItem.subtitle = subtitle
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  /// Whether the picture stands zoomed in, which a drag pans rather than closes.
  var zoomedIn: Bool { scroll.zoomScale > scroll.minimumZoomScale + 0.01 }

  override var prefersStatusBarHidden: Bool { barsHidden }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    scroll.frame = view.bounds
    scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    scroll.delegate = self
    scroll.minimumZoomScale = 1
    scroll.maximumZoomScale = mostZoom
    scroll.showsVerticalScrollIndicator = false
    scroll.showsHorizontalScrollIndicator = false
    scroll.contentInsetAdjustmentBehavior = .never
    scroll.decelerationRate = .fast
    view.addSubview(scroll)

    imageView.contentMode = .scaleAspectFit
    imageView.frame = scroll.bounds
    imageView.isAccessibilityElement = true
    imageView.accessibilityTraits = .image
    imageView.accessibilityLabel = navigationItem.title
    scroll.addSubview(imageView)

    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
    doubleTap.numberOfTapsRequired = 2
    scroll.addGestureRecognizer(doubleTap)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
    tap.require(toFail: doubleTap)
    scroll.addGestureRecognizer(tap)

    let close = UIBarButtonItem(
      systemItem: .close,
      primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
    )
    close.accessibilityIdentifier = "picture-viewer-close"
    navigationItem.leftBarButtonItem = close
    let share = UIBarButtonItem(
      systemItem: .action,
      primaryAction: UIAction { [weak self] _ in self?.share() }
    )
    share.accessibilityIdentifier = "picture-viewer-share"
    toolbarItems = [share, UIBarButtonItem(systemItem: .flexibleSpace)]

    readFullSize()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // Note that the image stands as large as the screen while it isn't zoomed, so a turn of the device fits it anew.
    guard !zoomedIn else { return }
    imageView.frame = scroll.bounds
    scroll.contentSize = scroll.bounds.size
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

  /// Reads the picture at its full size and decodes it off the main thread, then draws it in the thumbnail's place.
  private func readFullSize() {
    let source = source
    // Note that the read and the decode run detached from the main actor, so the zoom never waits on a large picture's bytes.
    let read = Task.detached(priority: .userInitiated) { () -> UIImage? in
      guard let decoded = UIImage(data: try await bytes(at: source)) else { return nil }
      return await decoded.byPreparingForDisplay() ?? decoded
    }
    Task { [weak self] in
      do {
        guard let ready = try await read.value else { return }
        self?.imageView.image = ready
      } catch {
        NSLog("The picture viewer could not read its picture at full size.")
      }
    }
  }

  @objc private func tapped() {
    barsHidden.toggle()
    navigationController?.setNavigationBarHidden(barsHidden, animated: true)
    navigationController?.setToolbarHidden(barsHidden, animated: true)
    UIView.animate(withDuration: 0.25) {
      self.view.backgroundColor = self.barsHidden ? .black : .systemBackground
      self.setNeedsStatusBarAppearanceUpdate()
    }
  }

  @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
    if zoomedIn {
      scroll.setZoomScale(scroll.minimumZoomScale, animated: true)
      return
    }
    let point = gesture.location(in: imageView)
    let size = CGSize(width: scroll.bounds.width / doubleTapZoom, height: scroll.bounds.height / doubleTapZoom)
    scroll.zoom(to: CGRect(origin: CGPoint(x: point.x - size.width / 2, y: point.y - size.height / 2), size: size), animated: true)
  }

  /// Opens the system's share sheet on the picture: its file where it is one, and its image otherwise.
  private func share() {
    let item: Any = source.isFileURL ? source : (imageView.image as Any)
    let sheet = UIActivityViewController(activityItems: [item], applicationActivities: nil)
    sheet.popoverPresentationController?.barButtonItem = toolbarItems?.first
    present(sheet, animated: true)
  }
}

/// What a press opens: the picture's address, the thumbnail's place in the window, in points, and the bar's words.
struct ShownPicture: Record {
  @Field var uri: String = ""
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var title: String = ""
  @Field var subtitle: String?
}

public final class PictureViewerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PictureViewer")

    AsyncFunction("show") { (shown: ShownPicture) -> Bool in
      guard let source = URL(string: shown.uri) else { return false }

      guard let window = keyWindow(), let presenter = topmost(window) else {
        NSLog("The picture viewer found no window to stand over.")
        return false
      }

      // Note that a refusal is told before presenting, since UIKit refuses a presentation only in its log, such as over a controller whose view stands in no window or that is still dismissing another.
      guard presenter.viewIfLoaded?.window != nil, presenter.presentedViewController == nil else {
        NSLog("The picture viewer would not be presented over %@.", String(describing: type(of: presenter)))
        return false
      }

      let place = CGRect(x: shown.x, y: shown.y, width: shown.width, height: shown.height)
      let drawn = thumbnail(at: place, in: window)
      let viewer = PictureViewerController(source: source, first: drawn?.image, title: shown.title, subtitle: shown.subtitle)
      let stack = UINavigationController(rootViewController: viewer)
      stack.setToolbarHidden(false, animated: false)
      stack.modalPresentationStyle = .fullScreen

      // Note that the zoom grows out of the thumbnail and closes back into it, and that a drag down closes it only while the picture isn't zoomed in, where a drag pans the picture instead; with no thumbnail found it rises as a plain full screen page.
      if let drawn {
        let options = UIViewController.Transition.ZoomOptions()
        options.interactiveDismissShouldBegin = { [weak viewer] _ in !(viewer?.zoomedIn ?? false) }
        weak var from = drawn
        stack.preferredTransition = .zoom(options: options) { _ in from }
      } else {
        NSLog("The picture viewer found no thumbnail to grow from.")
      }

      presenter.present(stack, animated: true)
      return true
    }.runOnQueue(.main)
  }
}
