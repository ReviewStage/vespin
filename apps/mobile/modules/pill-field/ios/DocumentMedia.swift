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

/// What an address holds once read: its kind, as `MediaKind` names it, the file it is drawn from, its words, a diagram's code as its detail, and its own size in points where it is known before it is read.
struct MediaRecord: Record {
  @Field var address: String = ""
  @Field var kind: String = MediaKind.reading.rawValue
  @Field var file: String? = nil
  @Field var label: String = ""
  @Field var detail: String? = nil
  @Field var width: Double? = nil
  @Field var height: Double? = nil
}

/// What an address holds, as `document-field.tsx`'s `MEDIA_KIND` names it.
enum MediaKind: String {
  case reading
  case picture
  case video
  case audio
  case file
  case unread
  /// A Mermaid fence's diagram, drawn by the app's renderer as a picture, its code standing where it could not be drawn.
  case diagram
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
  /// Its own size in points, where JavaScript knows it, as a diagram's renderer does.
  let natural: CGSize?

  init(_ record: MediaRecord) {
    kind = MediaKind(rawValue: record.kind) ?? .reading
    file = record.file.flatMap { URL(string: $0) }
    label = record.label
    detail = record.detail
    natural = record.width.flatMap { width in record.height.map { CGSize(width: width, height: $0) } }
  }

  init(kind: MediaKind) {
    self.kind = kind
    file = nil
    label = ""
    detail = nil
    natural = nil
  }

  /// Whether it is a diagram, or a diagram still being drawn, which stands under its head.
  var diagram: Bool {
    kind == .diagram || (kind == .reading && detail != nil)
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

/// A diagram's head and code, as the read rows' diagram card draws them (`DiagramBlock`): "Diagram" over the picture with Show code at its end, and the code in the monospaced face.
enum DiagramSpace {
  static let headGap: CGFloat = 6
  static let codePadding: CGFloat = 12

  static func headFont() -> UIFont { .preferredFont(forTextStyle: .subheadline) }
  static func codeFont() -> UIFont {
    UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .monospacedSystemFont(ofSize: 13, weight: .regular))
  }

  /// How tall the head stands over the diagram.
  static func headHeight() -> CGFloat { ceil(headFont().lineHeight) + headGap }

  /// How tall a diagram's code stands at `width`, its lines wrapped.
  static func codeHeight(_ code: String, width: CGFloat) -> CGFloat {
    let inner = max(1, width - codePadding * 2)
    let bounds = (code as NSString).boundingRect(
      with: CGSize(width: inner, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: [.font: codeFont()],
      context: nil
    )
    return ceil(bounds.height) + codePadding * 2
  }
}

/// The size a picture or a recording stands at in a line `width` wide: its own shape, scaled down only, held to `MediaSpace`'s bounds and the line, as `mediaFrame` and `MediaBox` hold it; a strip for a sound clip or a file.
func mediaFrame(_ kind: MediaKind, natural: CGSize?, width: CGFloat) -> CGSize {
  // Note that a diagram is held only to its own size and the column, as the panel holds one, since one held to a message's picture drew its labels too small to read (`COLUMN_BOUNDS`).
  if kind == .diagram, let natural, natural.width > 0, natural.height > 0 {
    let shown = min(natural.width, width)
    return CGSize(width: shown.rounded(), height: (shown * natural.height / natural.width).rounded())
  }

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
  /// The diagrams standing as their code, by their code, which Show code and Show diagram trade.
  private(set) var showingCode: Set<String> = []
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

  /// The views drawing the media, which VoiceOver reaches as elements of their own beside the words.
  func shownViews() -> [UIView] {
    views.allObjects
  }

  /// Whether the address holds a picture drawn, which a press at rest opens in the app's viewer.
  func drawsPicture(_ address: String) -> Bool {
    let media = media(address)
    return media.kind == .picture && media.file != nil
  }

  /// How tall the media at `address` stands in a line `width` wide: a diagram's head and its picture or code, or the media's frame.
  func height(of address: String, width: CGFloat) -> CGFloat {
    let media = media(address)

    guard media.diagram else { return mediaFrame(media.kind, natural: sizes[address], width: width).height }

    let code = media.detail ?? ""
    let body = media.kind == .diagram && (media.file == nil || showingCode.contains(address))
      ? DiagramSpace.codeHeight(code, width: width)
      : mediaFrame(media.kind, natural: sizes[address], width: width).height
    return DiagramSpace.headHeight() + body
  }

  /// Trades a diagram's picture for its code, or back, laying out again the lines it stands in.
  func toggleCode(_ address: String) {
    if showingCode.contains(address) { showingCode.remove(address) } else { showingCode.insert(address) }
    redraw(address)
    relay?(address)
  }

  /// Takes what each address holds: an address whose file changed reads its size, off the main thread, and draws its views again.
  func take(_ records: [MediaRecord]) {
    for record in records {
      let media = Media(record)
      guard held[record.address] != media else { continue }
      let before = held[record.address]?.kind ?? .reading
      held[record.address] = media
      if let natural = media.natural { sizes[record.address] = natural }
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
      view.draw(media(address), size: sizes[address], code: showingCode.contains(address))
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

/// A picture's bytes decoded no larger than `most` pixels on its longer side, read from a file or a `data:` address; none where they cannot be read.
private func decodedPicture(_ file: URL, most: CGFloat) -> UIImage? {
  guard let data = try? Data(contentsOf: file), let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: max(1, most),
  ]
  guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
  return UIImage(cgImage: image)
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
    let shown = MediaView(run: attachment.run, look: attachment.look, shelf: shelf)
    shelf.watch(shown)
    let address = attachment.run.address
    shown.draw(shelf.media(address), size: shelf.size(address), code: shelf.showingCode.contains(address))
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
    let height = attachment.shelf?.height(of: attachment.run.address, width: width)
      ?? mediaFrame(.reading, natural: nil, width: width).height
    let font = attributes[.font] as? UIFont ?? bodyFont()
    return CGRect(x: 0, y: font.descender, width: width, height: height + MediaSpace.gap)
  }
}

// MARK: - The view

/// The media at the leading edge of its line: a picture, or its well while on its way or where it could not be read; a video's first frame with the system's play button, which plays it full screen; a sound clip's strip, which plays it in place; a file's card; or a diagram under its head, with Show code trading its picture for its code.
final class MediaView: UIView {
  let run: MediaRun
  private let look: Look
  private weak var shelf: MediaShelf?
  private let box = UIView()
  private let head = UILabel()
  private var toggle: UIButton?
  private let code = UILabel()
  /// Whether a diagram stands as its code rather than its picture.
  private var showingCode = false
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

  init(run: MediaRun, look: Look, shelf: MediaShelf) {
    self.run = run
    self.look = look
    self.shelf = shelf
    super.init(frame: .zero)
    head.font = DiagramSpace.headFont()
    head.adjustsFontForContentSizeCategory = true
    head.textColor = look.placeholder
    head.isAccessibilityElement = false
    code.font = DiagramSpace.codeFont()
    code.textColor = look.text
    code.numberOfLines = 0
    addSubview(head)
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
    box.addSubview(code)
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

  /// Draws what the address holds, at the size it was read at, a diagram as its picture or, with `code`, its code.
  func draw(_ media: Media, size: CGSize?, code showing: Bool) {
    let changed = media != self.media
    self.media = media
    self.size = size
    showingCode = showing
    accessibilityLabel = heard()
    // Note that only a video, a sound clip and a diagram take a press, on their play button or Show code; any other press goes through to the text view, which places the caret beside the picture.
    isUserInteractionEnabled = media.kind == .video || media.kind == .audio || media.kind == .diagram
    head.text = media.diagram ? media.label : nil
    code.text = media.diagram ? media.detail : nil
    // Note that the view stands as one element, the diagram's head and its toggle among it, so VoiceOver offers the toggle as the element's action.
    accessibilityCustomActions = media.kind == .diagram && media.file != nil
      ? [UIAccessibilityCustomAction(name: showing ? "Show diagram" : "Show code") { [weak self] _ in self?.toggleCode(); return true }]
      : nil
    layToggle()
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
    // Note that a diagram stands under its head, as its code where Mermaid could not draw it or where Show code was pressed, else as its picture.
    let top = media.diagram ? DiagramSpace.headHeight() : 0
    let asCode = media.kind == .diagram && (media.file == nil || showingCode)
    let frame = asCode
      ? CGSize(width: width, height: DiagramSpace.codeHeight(code.text ?? "", width: width))
      : mediaFrame(media.kind, natural: size, width: width)
    head.frame = CGRect(x: 0, y: 0, width: width, height: max(0, top - DiagramSpace.headGap))
    box.frame = CGRect(origin: CGPoint(x: 0, y: top), size: frame)
    box.backgroundColor = media.kind == .diagram && !asCode ? .clear : look.pillFill
    picture.frame = box.bounds
    picture.contentMode = media.diagram ? .scaleAspectFit : .scaleAspectFill
    picture.isHidden = asCode
    code.isHidden = !asCode
    code.frame = box.bounds.insetBy(dx: DiagramSpace.codePadding, dy: DiagramSpace.codePadding)

    if let toggle {
      let fits = toggle.sizeThatFits(CGSize(width: width, height: head.frame.height))
      toggle.frame = CGRect(x: width - fits.width, y: 0, width: fits.width, height: head.frame.height)
    }
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
    case .diagram: return media.label
    case .reading: return media.diagram ? media.label : named ?? "Picture"
    case .picture: return named ?? "Picture"
    }
  }

  /// A drawn diagram's Show code at its head's end, Show diagram while its code stands, as the read rows' card offers them.
  private func layToggle() {
    guard media.kind == .diagram, media.file != nil else {
      toggle?.removeFromSuperview()
      toggle = nil
      return
    }

    let title = showingCode ? "Show diagram" : "Show code"

    if let toggle {
      toggle.configuration?.title = title
      return
    }

    var configuration = UIButton.Configuration.plain()
    configuration.title = title
    configuration.baseForegroundColor = look.text
    configuration.contentInsets = .zero
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var shown = attributes
      shown.font = DiagramSpace.headFont().withWeight(.medium)
      return shown
    }
    let button = UIButton(configuration: configuration, primaryAction: UIAction { [weak self] _ in self?.toggleCode() })
    button.isAccessibilityElement = false
    addSubview(button)
    toggle = button
  }

  private func toggleCode() {
    shelf?.toggleCode(run.address)
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

  /// Decodes the picture, a video's first frame, or a diagram's picture, at the size it stands at: a picture through SDWebImage, the engine expo-image draws with, and a diagram, which its renderer hands as a PNG's `data:` address, through ImageIO.
  private func drawPicture() {
    guard let file = media.file, media.kind == .picture || media.kind == .video || media.kind == .diagram else { return }
    let scale = window?.screen.scale ?? traitCollection.displayScale
    let frame = mediaFrame(media.kind, natural: size, width: max(bounds.width, MediaSpace.mostWidth))
    let pixels = CGSize(width: frame.width * scale, height: frame.height * scale)
    let wanted = media

    if media.kind == .diagram {
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        let image = decodedPicture(file, most: max(pixels.width, pixels.height))
        DispatchQueue.main.async {
          guard let self, self.media == wanted, self.near else { return }
          self.picture.image = image
        }
      }
      return
    }

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
