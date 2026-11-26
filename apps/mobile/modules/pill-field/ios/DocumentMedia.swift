// DocumentMedia.swift -- a document field's pictures, videos, sound clips and files, each drawn across its line as the description's read rows draw it: an attachment whose view is laid out as the words are, its picture decoded only while it stands near the screen.
//
// A picture's Markdown stands in a line as one character, an attachment
// (`MediaAttachment`), whose view TextKit 2 lays out and moves with the
// words: the documented way to stand a view in text
// (`NSTextAttachmentViewProvider`), as the field's cards and pills stand.
// The attachment is as wide as its line, so it stands on a line of its own
// as the read rows stand a picture between a paragraph's words, and draws
// the media at the read rows' frame (`media-frame.ts`'s `mediaFrame` held
// to `MEDIA_BOUNDS`), at its leading edge.
//
// What each address holds comes from JavaScript apart from the words
// (`MediaShelf`), since a picture lands after its words are drawn: a landing
// reads the file's size without decoding it, lays out again only the lines
// that picture stands in, and draws the views that show it. Note that a field
// grown to its words lays out every attachment's view, so a view's bitmap is
// what memory pays for: each is decoded at the size it is drawn, only while
// it stands within a screen of the window, and let go beyond that.

import AVFoundation
import AVKit
import ExpoModulesCore
import ImageIO
import SDWebImage
import UIKit

// MARK: - What JavaScript hands

/// A picture's Markdown standing in a line: the source it is written back as, the address it names, and its words.
struct MediaRunRecord: Record {
  @Field var source: String = ""
  @Field var address: String = ""
  @Field var alt: String = ""
}

/// What an address holds once read: its kind, as `MediaKind` names it, the file it is drawn from, and its words.
struct MediaRecord: Record {
  @Field var address: String = ""
  @Field var kind: String = MediaKind.reading.rawValue
  @Field var file: String? = nil
  @Field var label: String = ""
  @Field var detail: String? = nil
}

/// What an address holds, as `document-field.tsx`'s `MEDIA_KIND` names it.
enum MediaKind: String {
  case reading
  case picture
  case video
  case audio
  case file
  case unread
}

/// A picture's Markdown in a line, as the view holds it.
struct MediaRun: Equatable {
  let source: String
  let address: String
  let alt: String

  init(_ record: MediaRunRecord) {
    source = record.source
    address = record.address
    alt = record.alt
  }
}

/// What an address holds as the view draws it.
struct Media: Equatable {
  let kind: MediaKind
  let file: URL?
  let label: String
  let detail: String?

  init(_ record: MediaRecord) {
    kind = MediaKind(rawValue: record.kind) ?? .reading
    file = record.file.flatMap { URL(string: $0) }
    label = record.label
    detail = record.detail
  }

  init(kind: MediaKind) {
    self.kind = kind
    file = nil
    label = ""
    detail = nil
  }
}

// MARK: - The room it stands in

/// The read rows' media frame, in points: the most a picture or a recording stands at (`media-frame.ts`'s `MEDIA_BOUNDS`), the shape one of no known size stands at, a strip's height, and their corners and gaps.
enum MediaSpace {
  static let mostWidth: CGFloat = 280
  static let mostHeight: CGFloat = 360
  static let unsizedAspect: CGFloat = 16 / 9
  static let stripHeight: CGFloat = 52
  static let radius: CGFloat = 10
  static let gap: CGFloat = 6
  static let padding: CGFloat = 12
  static let playSize: CGFloat = 44
  /// How far past the window's edges a picture still stands decoded, in screens, so a scroll never meets an empty well.
  static let nearScreens: CGFloat = 1
}

/// The size a picture or a recording stands at in a line `width` wide: its own shape, scaled down only, held to `MediaSpace`'s bounds and the line, as `mediaFrame` and `MediaBox` hold it; a strip for a sound clip or a file.
func mediaFrame(_ kind: MediaKind, natural: CGSize?, width: CGFloat) -> CGSize {
  if kind == .audio || kind == .file {
    return CGSize(width: min(MediaSpace.mostWidth, width), height: MediaSpace.stripHeight)
  }

  guard let natural, natural.width > 0, natural.height > 0 else {
    let shown = min(MediaSpace.mostWidth, width)
    return CGSize(width: shown, height: (shown / MediaSpace.unsizedAspect).rounded())
  }

  let aspect = natural.width / natural.height
  let shown = min(natural.width, MediaSpace.mostWidth, MediaSpace.mostHeight * aspect, width)
  return CGSize(width: shown.rounded(), height: (shown / aspect).rounded())
}

// MARK: - What each address holds

/// The media a field's lines name, by address: what each holds, and the size it was read at without decoding it, as JavaScript hands them; and the views drawing each, so a landing draws only those.
final class MediaShelf {
  private(set) var held: [String: Media] = [:]
  private(set) var sizes: [String: CGSize] = [:]
  private let views = NSHashTable<MediaView>.weakObjects()
  /// Lays out again the lines standing an address, once its size is read.
  var relay: ((String) -> Void)?

  func media(_ address: String) -> Media {
    held[address] ?? Media(kind: .reading)
  }

  func size(_ address: String) -> CGSize? {
    sizes[address]
  }

  func watch(_ view: MediaView) {
    views.add(view)
  }

  /// Takes what each address holds: an address whose file changed reads its size, off the main thread, and draws its views again.
  func take(_ records: [MediaRecord]) {
    for record in records {
      let media = Media(record)
      guard held[record.address] != media else { continue }
      let before = held[record.address]?.kind ?? .reading
      held[record.address] = media
      redraw(record.address)
      // Note that a sound clip, a file, and a picture that could not be read stand at a height of their own, so their lines are laid out again at once; a picture and a video wait for their size.
      if media.kind != before { relay?(record.address) }
      readSize(of: record.address, media)
    }
  }

  /// Tells each view to reckon whether it stands near enough the window to draw its picture.
  func reckonNear() {
    for view in views.allObjects { view.reckonNear() }
  }

  private func redraw(_ address: String) {
    for view in views.allObjects where view.run.address == address {
      view.draw(media(address), size: sizes[address])
    }
  }

  /// Reads a picture's size from its file's header, or a video's from its track, without decoding a frame; the lines standing it are laid out again where the size differs from the one they were laid at.
  private func readSize(of address: String, _ media: Media) {
    // Note that only a file of the app's caches is read for its size, never an address on the web, whose read would wait on the network.
    guard let file = media.file, file.isFileURL, media.kind == .picture || media.kind == .video else { return }

    let landed: (CGSize?) -> Void = { [weak self] size in
      DispatchQueue.main.async {
        guard let self, let size, self.held[address] == media, self.sizes[address] != size else { return }
        self.sizes[address] = size
        self.redraw(address)
        self.relay?(address)
      }
    }

    if media.kind == .picture {
      DispatchQueue.global(qos: .userInitiated).async { landed(pictureSize(file)) }
      return
    }

    Task.detached(priority: .userInitiated) { landed(await videoSize(file)) }
  }
}

/// A picture file's size in pixels, read from its header, turned as its orientation turns it; none where it cannot be read.
private func pictureSize(_ file: URL) -> CGSize? {
  guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
    let width = properties[kCGImagePropertyPixelWidth] as? CGFloat,
    let height = properties[kCGImagePropertyPixelHeight] as? CGFloat
  else { return nil }
  let orientation = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
  // Note that orientations 5 through 8 turn the picture a quarter, so its width stands as its height.
  return orientation >= 5 ? CGSize(width: height, height: width) : CGSize(width: width, height: height)
}

/// A video file's size as it plays, turned as its track turns it; none where it holds no video track.
private func videoSize(_ file: URL) async -> CGSize? {
  let asset = AVURLAsset(url: file)
  guard let track = try? await asset.loadTracks(withMediaType: .video).first,
    let loaded = try? await track.load(.naturalSize, .preferredTransform)
  else { return nil }
  let turned = loaded.0.applying(loaded.1)
  return CGSize(width: abs(turned.width), height: abs(turned.height))
}

// MARK: - The attachment

/// A picture's Markdown drawn as the media it names, as one character across its line.
final class MediaAttachment: NSTextAttachment {
  let run: MediaRun
  let look: Look
  weak var shelf: MediaShelf?

  init(run: MediaRun, look: Look, shelf: MediaShelf) {
    self.run = run
    self.look = look
    self.shelf = shelf
    super.init(data: nil, ofType: nil)
    accessibilityLabel = run.alt.isEmpty ? "Picture" : run.alt
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A picture is never decoded.")
  }

  override func viewProvider(
    for parentView: UIView?,
    location: any NSTextLocation,
    textContainer: NSTextContainer?
  ) -> NSTextAttachmentViewProvider? {
    let provider = MediaViewProvider(
      textAttachment: self,
      parentView: parentView,
      textLayoutManager: textContainer?.textLayoutManager,
      location: location
    )
    provider.tracksTextAttachmentViewBounds = true
    return provider
  }
}

/// Stands the media across its line, at its frame's height and a gap below it, so the words after it start on a line of their own.
final class MediaViewProvider: NSTextAttachmentViewProvider {
  override func loadView() {
    guard let attachment = textAttachment as? MediaAttachment, let shelf = attachment.shelf else { return }
    let shown = MediaView(run: attachment.run, look: attachment.look)
    shelf.watch(shown)
    shown.draw(shelf.media(attachment.run.address), size: shelf.size(attachment.run.address))
    view = shown
  }

  override func attachmentBounds(
    for attributes: [NSAttributedString.Key: Any],
    location: any NSTextLocation,
    textContainer: NSTextContainer?,
    proposedLineFragment: CGRect,
    position: CGPoint
  ) -> CGRect {
    guard let attachment = textAttachment as? MediaAttachment else { return .zero }
    let width = max(proposedLineFragment.width - 1, 1)
    let media = attachment.shelf?.media(attachment.run.address) ?? Media(kind: .reading)
    let frame = mediaFrame(media.kind, natural: attachment.shelf?.size(attachment.run.address), width: width)
    let font = attributes[.font] as? UIFont ?? bodyFont()
    return CGRect(x: 0, y: font.descender, width: width, height: frame.height + MediaSpace.gap)
  }
}

// MARK: - The view

/// The media at the leading edge of its line: a picture, or its well while on its way or where it could not be read; a video's first frame with the system's play button, which plays it full screen; a sound clip's strip, which plays it in place; or a file's card.
final class MediaView: UIView {
  let run: MediaRun
  private let look: Look
  private let box = UIView()
  private let picture = UIImageView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let words = UILabel()
  private let detail = UILabel()
  private var play: UIButton?
  private var media = Media(kind: .reading)
  private var size: CGSize?
  private var player: AVPlayer?

  /// Whether the view stands near enough the window to hold its picture decoded.
  var near = false {
    didSet {
      guard near != oldValue else { return }
      near ? drawPicture() : letPictureGo()
    }
  }

  init(run: MediaRun, look: Look) {
    self.run = run
    self.look = look
    super.init(frame: .zero)
    box.backgroundColor = look.pillFill
    box.layer.cornerRadius = MediaSpace.radius
    box.layer.cornerCurve = .continuous
    box.clipsToBounds = true
    picture.contentMode = .scaleAspectFill
    picture.clipsToBounds = true
    words.font = .preferredFont(forTextStyle: .subheadline)
    words.adjustsFontForContentSizeCategory = true
    words.textColor = look.text
    words.numberOfLines = 1
    detail.font = .preferredFont(forTextStyle: .footnote)
    detail.adjustsFontForContentSizeCategory = true
    detail.textColor = look.placeholder
    spinner.hidesWhenStopped = true
    addSubview(box)
    box.addSubview(picture)
    box.addSubview(spinner)
    box.addSubview(words)
    box.addSubview(detail)
    isAccessibilityElement = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A picture is never decoded.")
  }

  /// Reckons whether the view stands within a screen of the window, where its picture is drawn; one beyond lets its picture go.
  func reckonNear() {
    guard let window else {
      near = false
      return
    }
    let reach = window.bounds.insetBy(dx: 0, dy: -window.bounds.height * MediaSpace.nearScreens)
    near = convert(bounds, to: window).intersects(reach)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reckonNear()
  }

  /// Draws what the address holds, at the size it was read at.
  func draw(_ media: Media, size: CGSize?) {
    let changed = media != self.media
    self.media = media
    self.size = size
    accessibilityLabel = heard()
    // Note that only a video and a sound clip take a press, on their play button; any other press goes through to the text view, which places the caret beside the picture.
    isUserInteractionEnabled = media.kind == .video || media.kind == .audio
    if media.kind == .reading { spinner.startAnimating() } else { spinner.stopAnimating() }
    words.text = media.kind == .unread ? failedWords() : media.label
    detail.text = media.detail
    layPlay()

    if changed {
      letPictureGo()
      player = nil
      if near { drawPicture() }
    }

    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    guard width > 0 else { return }
    let frame = mediaFrame(media.kind, natural: size, width: width)
    box.frame = CGRect(origin: .zero, size: frame)
    picture.frame = box.bounds
    spinner.center = CGPoint(x: box.bounds.midX, y: box.bounds.midY)
    let strip = media.kind == .audio || media.kind == .file
    let lead = MediaSpace.padding + (strip && play != nil ? MediaSpace.playSize : 0)
    let wordsWidth = max(0, box.bounds.width - lead - MediaSpace.padding)

    if strip {
      let line = words.font.lineHeight
      let below = detail.text == nil ? 0 : detail.font.lineHeight
      let top = (box.bounds.height - line - below) / 2
      words.textAlignment = .natural
      words.frame = CGRect(x: lead, y: top, width: wordsWidth, height: line)
      detail.frame = CGRect(x: lead, y: top + line, width: wordsWidth, height: below)
    } else {
      words.frame = CGRect(x: MediaSpace.padding, y: 0, width: box.bounds.width - MediaSpace.padding * 2, height: box.bounds.height)
      words.textAlignment = .center
    }

    words.isHidden = !(strip || media.kind == .unread)
    detail.isHidden = !strip

    // Note that a view is laid out only after the field around it was, so it reckons its own place here, as it first stands and each time it moves.
    reckonNear()

    if let play {
      let side = MediaSpace.playSize
      play.frame = strip
        ? CGRect(x: MediaSpace.padding / 2, y: (box.bounds.height - side) / 2, width: side, height: side)
        : CGRect(x: box.bounds.midX - side / 2, y: box.bounds.midY - side / 2, width: side, height: side)
    }
  }

  /// What VoiceOver hears the media as: its words, else what it is.
  private func heard() -> String {
    let named = run.alt.isEmpty ? nil : run.alt

    switch media.kind {
    case .video, .audio: return named ?? media.label
    case .file: return [named ?? media.label, media.detail].compactMap { $0 }.joined(separator: ", ")
    case .unread: return failedWords()
    case .reading, .picture: return named ?? "Picture"
    }
  }

  /// What a picture that could not be read says in its well, its own words first, as the read rows' stand-in says it (`MEDIA_READ_WORDS`).
  private func failedWords() -> String {
    "\(run.alt.isEmpty ? "This picture" : run.alt) could not be read."
  }

  /// The play button a video stands over its first frame, and a sound clip at its strip's start, in the system's own glyph.
  private func layPlay() {
    let plays = media.kind == .video || media.kind == .audio

    guard plays else {
      play?.removeFromSuperview()
      play = nil
      return
    }

    guard play == nil else { return }
    var configuration = media.kind == .video ? UIButton.Configuration.glass() : UIButton.Configuration.plain()
    configuration.image = UIImage(systemName: "play.fill")
    configuration.baseForegroundColor = look.text
    let button = UIButton(configuration: configuration, primaryAction: UIAction { [weak self] _ in self?.playMedia() })
    button.accessibilityLabel = "Play"
    box.addSubview(button)
    play = button
  }

  /// Decodes the picture, or a video's first frame, at the size it stands at, through SDWebImage, the engine expo-image draws with.
  private func drawPicture() {
    guard let file = media.file, media.kind == .picture || media.kind == .video else { return }
    let scale = window?.screen.scale ?? traitCollection.displayScale
    let frame = mediaFrame(media.kind, natural: size, width: max(bounds.width, MediaSpace.mostWidth))
    let pixels = CGSize(width: frame.width * scale, height: frame.height * scale)

    if media.kind == .picture {
      // Note that the picture is decoded at its drawn size and kept in no cache of SDWebImage's, so a picture let go beyond the window is gone from memory and read again from its file as it comes back.
      picture.sd_setImage(
        with: file,
        placeholderImage: nil,
        options: [.decodeFirstFrameOnly, .fromLoaderOnly],
        context: [.imageThumbnailPixelSize: pixels, .storeCacheType: SDImageCacheType.none.rawValue]
      )
      return
    }

    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: file))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = pixels
    let wanted = media
    generator.generateCGImageAsynchronously(for: .zero) { [weak self] image, _, _ in
      guard let image else { return }
      DispatchQueue.main.async {
        guard let self, self.media == wanted, self.near else { return }
        self.picture.image = UIImage(cgImage: image)
      }
    }
  }

  private func letPictureGo() {
    picture.sd_cancelCurrentImageLoad()
    picture.image = nil
  }

  /// Plays a video full screen in the system's player, as the read rows' video opens; a sound clip in place, its button pausing it again.
  private func playMedia() {
    guard let file = media.file else { return }

    if media.kind == .audio {
      let held = player ?? AVPlayer(url: file)
      player = held
      let playing = held.timeControlStatus == .playing
      playing ? held.pause() : held.play()
      play?.configuration?.image = UIImage(systemName: playing ? "play.fill" : "pause.fill")
      play?.accessibilityLabel = playing ? "Play" : "Pause"
      return
    }

    guard let presenter = presentingController() else { return }
    let controller = AVPlayerViewController()
    controller.player = AVPlayer(url: file)
    presenter.present(controller, animated: true) { controller.player?.play() }
  }

  /// The view controller on top of the window, which the system's player is presented over.
  private func presentingController() -> UIViewController? {
    var top = window?.rootViewController
    while let shown = top?.presentedViewController { top = shown }
    return top
  }
}
