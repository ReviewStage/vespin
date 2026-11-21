// PictureViewerModule.swift -- a picture a message carried, opened full screen as Photos opens one: zoomed out of the thumbnail pressed, drawn at once from the bitmap the thumbnail already shows, then sharpened to its full size.
//
// Quick Look held its presentation until it had read its file, so a press
// waited 0.9 to 1.7 seconds before anything moved. This viewer stands on the
// next frame: the press hands the thumbnail's place on screen, the viewer
// finds the image view drawn there and takes its decoded image as its first
// frame, and grows from it as Photos' does, the picture flying from the
// thumbnail's place while the page fades in; a drag down shrinks it and lets
// the page behind show through, and a release closes it back into its
// thumbnail. Note that the zoom is the viewer's own (`PictureZoom`) rather
// than UIKit's `.zoom` transition, which never finished out of the app's
// thumbnails on iOS 27, leaving the picture hidden behind it. The picture's full
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

/// How long the zoom in and out runs, in seconds, about as long as Photos' own.
private let zoomSeconds: TimeInterval = 0.36

/// How far a drag down runs, in points, before a release closes the picture rather than letting it spring back.
private let dragToClose: CGFloat = 110

/// How fast a drag down flings, in points a second, that closes the picture however short it ran.
private let flingToClose: CGFloat = 800

/// The rect a picture of `size` stands in fitted whole inside `rect`, centered.
private func fitted(_ size: CGSize, in rect: CGRect) -> CGRect {
  guard size.width > 0, size.height > 0 else { return rect }
  let scale = min(rect.width / size.width, rect.height / size.height)
  let fit = CGSize(width: size.width * scale, height: size.height * scale)
  return CGRect(x: rect.midX - fit.width / 2, y: rect.midY - fit.height / 2, width: fit.width, height: fit.height)
}

/// The picture's bytes at `url`: a file, a `data:` address, or a web address.
private func bytes(at url: URL) async throws -> Data {
  if url.isFileURL || url.scheme == "data" { return try Data(contentsOf: url) }
  return try await URLSession.shared.data(from: url).0
}

/// One picture full screen: a scroll view zooming its image, the bars over it, and its share sheet.
final class PictureViewerController: UIViewController, UIScrollViewDelegate, UIGestureRecognizerDelegate {
  private let source: URL
  private let scroll = UIScrollView()
  private let imageView = UIImageView()
  private let drag = UIPanGestureRecognizer()
  private var barsHidden = false
  /// The zoom it opens and closes with, held here since UIKit holds a transitioning delegate weakly.
  var zoom: PictureZoom?

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

  /// The picture as drawn now: its full size once read, its thumbnail's before.
  var image: UIImage? { imageView.image }

  /// Where the picture itself stands in `space`, fitted inside the screen and moved as a drag moves it; none before it has an image.
  func pictureFrame(in space: UIView) -> CGRect? {
    guard let image = imageView.image else { return nil }
    return imageView.convert(fitted(image.size, in: imageView.bounds), to: space)
  }

  /// Hides the picture while the zoom flies its copy, and shows it once it lands.
  func hidePicture(_ hidden: Bool) { imageView.isHidden = hidden }

  /// The page's ground: the system's in the bars' light, black with the bars hidden, as Photos' is.
  private var ground: UIColor { barsHidden ? .black : .systemBackground }

  /// Shows how far a drag has run, from 0 to 1: the ground and the bars fading so the page behind shows through.
  private func showDrag(_ progress: CGFloat) {
    let left = max(0, 1 - progress * 2)
    view.backgroundColor = ground.withAlphaComponent(left)
    navigationController?.navigationBar.alpha = left
    navigationController?.toolbar.alpha = left
  }

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

    drag.addTarget(self, action: #selector(dragged(_:)))
    drag.delegate = self
    view.addGestureRecognizer(drag)

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
      self.view.backgroundColor = self.ground
      self.setNeedsStatusBarAppearanceUpdate()
    }
  }

  /// A drag down begins only on a picture that isn't zoomed in, and only downward, so a zoomed picture pans and a sideways swipe stays the scroll's.
  func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
    guard gesture === drag else { return true }
    let velocity = drag.velocity(in: view)
    return !zoomedIn && velocity.y > 0 && abs(velocity.y) > abs(velocity.x)
  }

  /// Moves and shrinks the picture under a drag down, the page behind showing through, and closes it on a long enough drag or a fling, springing it back otherwise.
  @objc private func dragged(_ gesture: UIPanGestureRecognizer) {
    let moved = gesture.translation(in: view)
    let progress = min(1, max(0, moved.y / view.bounds.height))
    switch gesture.state {
    case .changed:
      let shrink = 1 - progress * 0.35
      scroll.transform = CGAffineTransform(translationX: moved.x, y: moved.y).scaledBy(x: shrink, y: shrink)
      showDrag(progress)
    case .ended, .cancelled:
      if gesture.state == .ended, moved.y > dragToClose || gesture.velocity(in: view).y > flingToClose {
        dismiss(animated: true)
        return
      }
      UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) {
        self.scroll.transform = .identity
        self.showDrag(0)
      }
    default:
      break
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

/// The viewer's zoom, as Photos' runs: a copy of the picture flies from the thumbnail's place to the screen while the viewer's page fades in, and back into the thumbnail as it closes, from wherever a drag left it; with no thumbnail to fly from or to, the page fades.
final class PictureZoom: NSObject, UIViewControllerTransitioningDelegate, UIViewControllerAnimatedTransitioning {
  private weak var viewer: PictureViewerController?
  /// Finds the thumbnail on screen now, which a scroll behind the viewer may have moved or taken away.
  private let thumbnail: () -> UIImageView?
  private var opening = true

  init(viewer: PictureViewerController, thumbnail: @escaping () -> UIImageView?) {
    self.viewer = viewer
    self.thumbnail = thumbnail
  }

  func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
    opening = true
    return self
  }

  func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
    opening = false
    return self
  }

  func transitionDuration(using context: UIViewControllerContextTransitioning?) -> TimeInterval { zoomSeconds }

  func animateTransition(using context: UIViewControllerContextTransitioning) {
    let container = context.containerView
    let page = context.view(forKey: opening ? .to : .from)
    if opening, let page, let presented = context.viewController(forKey: .to) {
      page.frame = context.finalFrame(for: presented)
      container.addSubview(page)
      page.layoutIfNeeded()
    }

    // Note that the thumbnail stands hidden while its copy flies, so the picture is never drawn twice.
    let drawn = thumbnail().flatMap { $0.window == nil ? nil : $0 }
    let picture = viewer?.image ?? drawn?.image
    let from = drawn.map { $0.convert($0.bounds, to: container) }
    let to = viewer?.pictureFrame(in: container)
    let flying = UIImageView(image: picture)
    flying.contentMode = .scaleAspectFill
    flying.clipsToBounds = true
    let flies = picture != nil && from != nil && to != nil
    if flies, let from, let to {
      flying.frame = opening ? from : to
      container.addSubview(flying)
      drawn?.isHidden = true
      viewer?.hidePicture(true)
    }
    page?.alpha = opening ? 0 : 1

    let animator = UIViewPropertyAnimator(duration: zoomSeconds, dampingRatio: 0.9) {
      if flies, let from, let to { flying.frame = self.opening ? to : from }
      page?.alpha = self.opening ? 1 : 0
    }
    animator.addCompletion { _ in
      flying.removeFromSuperview()
      drawn?.isHidden = false
      self.viewer?.hidePicture(false)
      context.completeTransition(!context.transitionWasCancelled)
    }
    animator.startAnimation()
  }
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
      // Note that the page behind stays drawn under the viewer, so a drag down shows it through, and that the viewer's bars say whether the status bar stands.
      stack.modalPresentationStyle = .overFullScreen
      stack.modalPresentationCapturesStatusBarAppearance = true
      stack.view.backgroundColor = .clear
      let zoom = PictureZoom(viewer: viewer) { [weak window] in
        window.flatMap { thumbnail(at: place, in: $0) }
      }
      viewer.zoom = zoom
      stack.transitioningDelegate = zoom

      presenter.present(stack, animated: true)
      return true
    }.runOnQueue(.main)
  }
}
