// PillFieldModule.swift -- the app's text field that draws mentions and files' markers as pills inside its words: UIKit's text view on TextKit 2, each pill an attachment whose view is the panel's chip, written back as the Markdown it was handed.
//
// `@repo/ui-native`'s `PillField` hands this view the words as runs
// (`@repo/features/pill-words`): plain words, and pills, each carrying the
// Markdown it stands for, the words and glyph it draws, and what VoiceOver
// hears. Nothing here reads Markdown. The view holds a pill as one
// attachment character, so it selects and deletes as one unit, and writes
// the words back by putting each pill's Markdown in its place. It tells
// JavaScript its runs, words as typed and pills by their Markdown, from which
// JavaScript writes the Markdown, a marker typed as words escaped so it names
// no file; and the caret's line around it, each pill read as the object
// character, so an `@` word is found as the panel's box finds it
// (`@repo/features/at-word`); a pick replaces that word with a pill.
//
// The view is handed runs on every change JavaScript makes, its own echoed
// back among them: it redraws only where they differ from what it holds,
// such as a cleared field, a draft laid in, or a mention's link pasted as
// words, which JavaScript reads as a pill. Note that a handing is taken only
// once JavaScript has heard every change typed (`seen`), as React Native's
// own field takes a value, so words typed while a render was on its way are
// never set back.
//
// A pill is a view (`NSTextAttachmentViewProvider`), the documented way to
// stand a view in TextKit 2's words, so it draws at the reader's text size
// and in the theme's colors, which JavaScript hands. Copy writes the
// selection's Markdown as plain words, as the desktop's box copies, so a
// paste back reads its mentions as pills again.
//
// A field that edits a document whole, such as a description, is also handed
// each words run's looks (`@repo/features/markdown-styles`): a heading, bold,
// code, a list's mark, and the marks that only spell a look. The words are
// still the Markdown; the looks are drawn over them and kept on the text as
// an attribute of their own, so they move with every edit until JavaScript
// hands them again for the words now standing, which restyles in place and
// leaves the caret and undo alone. The marks that only spell a look are
// drawn faded.

import ExpoModulesCore
import SDWebImage
import UIKit

public final class PillFieldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PillField")

    View(PillFieldView.self) {
      Events("onWords", "onHeight", "onFocusChange", "onPillPress")

      Prop("value") { (view: PillFieldView, value: ValueRecord) in
        view.take(StyledRuns(value.runs), seen: value.seen)
      }

      Prop("look") { (view: PillFieldView, look: LookRecord) in
        view.look = Look(look)
      }

      Prop("placeholder") { (view: PillFieldView, placeholder: String?) in
        view.placeholder = placeholder ?? ""
      }

      Prop("maxLines") { (view: PillFieldView, lines: Int?) in
        view.maxLines = max(lines ?? defaultMaxLines, 1)
      }

      Prop("editable") { (view: PillFieldView, editable: Bool?) in
        view.editable = editable ?? true
      }

      AsyncFunction("insertPills") { (view: PillFieldView, pills: [PillRecord], word: WordRecord?) in
        view.insertPills(pills.map(Pill.init), over: word.map(Word.init))
      }

      AsyncFunction("rewriteWord") { (view: PillFieldView, text: String, word: WordRecord?) in
        view.rewriteWord(text, over: word.map(Word.init))
      }

      AsyncFunction("take") { (view: PillFieldView) -> [String: Any] in
        view.takeWords()
      }

      AsyncFunction("putBack") { (view: PillFieldView, runs: [RunRecord]) in
        view.putBack(StyledRuns(runs).runs)
      }

      AsyncFunction("focus") { (view: PillFieldView) in
        view.focus()
      }

      AsyncFunction("blur") { (view: PillFieldView) in
        view.blur()
      }
    }

    View(DocumentFieldView.self) {
      Events("onLines", "onHeight", "onFocusChange", "onLinkAsk", "onCaret")

      Prop("value") { (view: DocumentFieldView, value: DocumentValueRecord) in
        view.take(value.lines.map(DocumentLine.init), seen: value.seen)
      }

      Prop("look") { (view: DocumentFieldView, look: LookRecord) in
        view.look = Look(look)
      }

      Prop("placeholder") { (view: DocumentFieldView, placeholder: String?) in
        view.placeholder = placeholder ?? ""
      }

      Prop("editable") { (view: DocumentFieldView, editable: Bool?) in
        view.editable = editable ?? true
      }

      Prop("formats") { (view: DocumentFieldView, formats: FormatsRecord?) in
        view.formats = formats
      }

      Prop("fitsWords") { (view: DocumentFieldView, fits: Bool?) in
        view.fitsWords = fits ?? false
      }

      Prop("keepClear") { (view: DocumentFieldView, clear: Double?) in
        view.keepClear = clear.map { CGFloat($0) }
      }

      Prop("opening") { (view: DocumentFieldView, opening: OpeningRecord?) in
        view.open(opening)
      }

      AsyncFunction("setLink") { (view: DocumentFieldView, address: String) in
        view.setLink(address)
      }

      AsyncFunction("insertPills") { (view: DocumentFieldView, pills: [PillRecord], word: WordRecord?) in
        view.insertPills(pills.map(Pill.init), over: word.map(Word.init))
      }

      AsyncFunction("rewriteWord") { (view: DocumentFieldView, text: String, word: WordRecord?) in
        view.rewriteWord(text, over: word.map(Word.init))
      }

      AsyncFunction("focus") { (view: DocumentFieldView) in
        view.focus()
      }

      AsyncFunction("blur") { (view: DocumentFieldView) in
        view.blur()
      }
    }
  }
}

/// The most lines the field grows to before it scrolls, where JavaScript names none.
private let defaultMaxLines = 6

/// A space and a line break, as the view's string holds them.
private let space: unichar = 0x20
private let lineBreak: unichar = 0x0A

/// The least change in the field's height, in points, that is told to JavaScript.
private let heightStep: CGFloat = 0.5

/// The pill's room around its glyph and words, and its corner, as the panel's chip stands (`markdown.tsx`'s `chip`).
private enum PillSpace {
  static let leading: CGFloat = 4
  static let gap: CGFloat = 4
  static let trailing: CGFloat = 6
  static let radius: CGFloat = 6
  /// How far the pill stands past the words' line above and below.
  static let rise: CGFloat = 1
}

// MARK: - What JavaScript hands

struct PillRecord: Record {
  @Field var markdown: String = ""
  @Field var words: String = ""
  @Field var glyph: String = ""
  @Field var heard: String = ""
  /// The file a picture's pill draws its thumbnail from in its glyph's place; none for every other pill.
  @Field var thumbnail: String? = nil
}

struct RunRecord: Record {
  @Field var text: String? = nil
  @Field var pill: PillRecord? = nil
  /// The looks a run of words is drawn with (`MarkStyle`), none for plain words.
  @Field var styles: [String] = []
}

/// The words a pick replaces, as JavaScript read them: where they stood in the drawn words, and the words themselves, such as `@Invite li`.
struct WordRecord: Record {
  @Field var start: Int = 0
  @Field var text: String = ""
}

/// The words a pick replaces.
struct Word {
  let start: Int
  let text: String

  init(_ record: WordRecord) {
    start = record.start
    text = record.text
  }
}

struct ValueRecord: Record {
  @Field var runs: [RunRecord] = []
  /// How many changes JavaScript had heard as it handed these runs.
  @Field var seen: Int = 0
}

/// Where a field takes the keyboard as it comes to stand: at its words' start, or on the line at `line`, `x` and `y` points in from its first line's start, where a press on the words as read landed; told once for each `nonce`.
struct OpeningRecord: Record {
  @Field var nonce: Int = 0
  @Field var start: Bool = false
  @Field var line: Int = 0
  @Field var x: Double = 0
  @Field var y: Double = 0
}

struct LookRecord: Record {
  @Field var text: UIColor? = nil
  @Field var placeholder: UIColor? = nil
  @Field var tint: UIColor? = nil
  @Field var pillFill: UIColor? = nil
  @Field var pillWords: UIColor? = nil
  @Field var pillGlyph: UIColor? = nil
}

/// A pill: the Markdown it is written back as, and what it draws and is heard as.
struct Pill: Equatable {
  let markdown: String
  let words: String
  let glyph: String
  let heard: String
  /// The file a picture's pill draws its thumbnail from, where JavaScript has written one.
  let thumbnail: String?

  init(markdown: String, words: String, glyph: String, heard: String, thumbnail: String? = nil) {
    self.markdown = markdown
    self.words = words
    self.glyph = glyph
    self.heard = heard
    self.thumbnail = thumbnail
  }

  init(_ record: PillRecord) {
    markdown = record.markdown
    words = record.words
    glyph = record.glyph
    heard = record.heard
    thumbnail = record.thumbnail
  }
}

/// A run of the words: plain words, or one pill.
enum Run: Equatable {
  case words(String)
  case pill(Pill)

  init?(_ record: RunRecord) {
    if let pill = record.pill {
      self = .pill(Pill(pill))
    } else if let text = record.text {
      self = .words(text)
    } else {
      return nil
    }
  }

  /// How long the run stands in the view's string, a pill one object character.
  var drawnLength: Int {
    switch self {
    case .words(let text): return (text as NSString).length
    case .pill: return 1
    }
  }

  /// The run as the Markdown it stands for.
  var markdown: String {
    switch self {
    case .words(let text): return text
    case .pill(let pill): return pill.markdown
    }
  }

  /// The run as JavaScript reads it: words as typed, a pill by its Markdown.
  var told: [String: Any] {
    switch self {
    case .words(let text): return ["text": text]
    case .pill(let pill): return ["pill": ["markdown": pill.markdown]]
    }
  }
}

/// A look a span of the words is drawn with, as `@repo/features/markdown-styles`' `MARK_STYLE` names it.
enum MarkStyle: String {
  case heading1 = "heading-1"
  case heading2 = "heading-2"
  case heading3 = "heading-3"
  case strong
  case emphasis
  case strike
  case code
  case codeBlock = "code-block"
  case quote
  case link
  case listMark = "list-mark"
  case rule
  case syntax
}

/// The looks laid on the words as an attribute of their own, so they move with each edit.
let markStylesKey = NSAttributedString.Key("VespinMarkStyles")

/// The runs JavaScript hands, the words joined as the view holds them, and the looks of each span of the drawn words.
struct StyledRuns {
  let runs: [Run]
  let spans: [(range: NSRange, styles: [String])]

  init(_ records: [RunRecord]) {
    var runs: [Run] = []
    var spans: [(range: NSRange, styles: [String])] = []
    var at = 0

    for record in records {
      guard let run = Run(record) else { continue }

      // Note that side by side words are joined, as the view holds them, so a handing that only restyles reads as the same words.
      if case .words(let text) = run, case .words(let before)? = runs.last {
        runs[runs.count - 1] = .words(before + text)
      } else {
        runs.append(run)
      }

      if case .words = run, !record.styles.isEmpty {
        spans.append((NSRange(location: at, length: run.drawnLength), record.styles))
      }

      at += run.drawnLength
    }

    self.runs = runs
    self.spans = spans
  }
}

/// The colors the field draws in, which follow the app's theme.
struct Look: Equatable {
  var text: UIColor = .label
  var placeholder: UIColor = .placeholderText
  var tint: UIColor? = nil
  var pillFill: UIColor = .tertiarySystemFill
  var pillWords: UIColor = .label
  var pillGlyph: UIColor = .secondaryLabel

  init() {}

  init(_ record: LookRecord) {
    text = record.text ?? text
    placeholder = record.placeholder ?? placeholder
    tint = record.tint
    pillFill = record.pillFill ?? pillFill
    pillWords = record.pillWords ?? pillWords
    pillGlyph = record.pillGlyph ?? pillGlyph
  }
}

// MARK: - The pill

/// The body's face at the reader's text size, which the words are typed in.
func bodyFont() -> UIFont {
  UIFont.preferredFont(forTextStyle: .body)
}

/// The pill's face: the subheadline's size at the reader's text size, medium, as the panel's chip sets its name.
func pillFont() -> UIFont {
  UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .subheadline).pointSize, weight: .medium)
}

/// A pill in the words: one attachment character, drawn by its own view.
final class PillAttachment: NSTextAttachment {
  let pill: Pill
  let look: Look
  /// What a press on a picture's pill does, which opens the picture; none where the field opens nothing, so a press places the caret.
  let onPress: ((Pill) -> Void)?

  init(pill: Pill, look: Look, onPress: ((Pill) -> Void)? = nil) {
    self.pill = pill
    self.look = look
    self.onPress = onPress
    super.init(data: nil, ofType: nil)
    accessibilityLabel = pill.heard
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A pill is never decoded.")
  }

  override func viewProvider(
    for parentView: UIView?,
    location: any NSTextLocation,
    textContainer: NSTextContainer?
  ) -> NSTextAttachmentViewProvider? {
    let provider = PillViewProvider(
      textAttachment: self,
      parentView: parentView,
      textLayoutManager: textContainer?.textLayoutManager,
      location: location
    )
    provider.tracksTextAttachmentViewBounds = true
    return provider
  }
}

/// Stands a pill's view in the line, sized to its words and centered on the line's capitals.
final class PillViewProvider: NSTextAttachmentViewProvider {
  override func loadView() {
    guard let attachment = textAttachment as? PillAttachment else { return }
    view = PillView(pill: attachment.pill, look: attachment.look, onPress: attachment.onPress)
  }

  override func attachmentBounds(
    for attributes: [NSAttributedString.Key: Any],
    location: any NSTextLocation,
    textContainer: NSTextContainer?,
    proposedLineFragment: CGRect,
    position: CGPoint
  ) -> CGRect {
    guard let attachment = textAttachment as? PillAttachment else { return .zero }
    let font = attributes[.font] as? UIFont ?? bodyFont()
    let size = PillView.size(of: attachment.pill, within: proposedLineFragment.width)

    // Note that a bound's origin is measured up from the baseline, so the pill's middle stands on the middle of the line's capitals.
    return CGRect(x: 0, y: (font.capHeight - size.height) / 2, width: size.width, height: size.height)
  }
}

/// How round a picture pill's thumbnail is cut, as the sent message's chip cuts its own (`markdown.tsx`'s `THUMBNAIL_CORNER`).
private let thumbnailCorner: CGFloat = 4

/// The panel's chip: its kind's glyph and its words on a rounded fill, cut short where the line is narrower; a picture's wears its thumbnail in the glyph's place.
final class PillView: UIView {
  private let glyph = UIImageView()
  private let label = UILabel()
  private let pill: Pill
  private let onPress: ((Pill) -> Void)?

  init(pill: Pill, look: Look, onPress: ((Pill) -> Void)? = nil) {
    self.pill = pill
    self.onPress = onPress
    super.init(frame: .zero)
    backgroundColor = look.pillFill
    layer.cornerRadius = PillSpace.radius
    layer.cornerCurve = .continuous
    // Note that a press goes through to the text view, which places the caret beside the pill, and VoiceOver hears the pill through the text view's words; but a picture's pill with a thumbnail takes the press and opens the picture, as Messages opens a photo in its field.
    isUserInteractionEnabled = pill.thumbnail != nil && onPress != nil
    isAccessibilityElement = false
    glyph.image = Self.image(named: pill.glyph)
    glyph.tintColor = look.pillGlyph
    // Note that a picture, such as a Manager's face, is fit to the glyph's square, where a symbol stands at its font's own size.
    glyph.contentMode = glyph.image?.isSymbolImage == false ? .scaleAspectFit : .center
    label.text = pill.words
    label.font = pillFont()
    label.textColor = look.pillWords
    label.lineBreakMode = .byTruncatingTail
    addSubview(glyph)
    addSubview(label)
    showThumbnail()

    if isUserInteractionEnabled {
      addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(pressed)))
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A pill is never decoded.")
  }

  /// Stands the picture's thumbnail in the glyph's place through SDWebImage, the image engine expo-image draws every other picture with: it decodes the file no larger than the pill's square and keeps the result in the one memory and disk cache expo-image shares, so a pill drawn again, as each edit redraws the words, never decodes its picture twice. The glyph stands until the thumbnail is drawn, so the pill never stands empty.
  private func showThumbnail() {
    guard let address = pill.thumbnail, let url = URL(string: address) else { return }
    glyph.layer.cornerRadius = thumbnailCorner
    glyph.layer.cornerCurve = .continuous
    glyph.clipsToBounds = true
    let side = (ceil(pillFont().pointSize) + PillSpace.rise * 2) * UITraitCollection.current.displayScale

    glyph.sd_setImage(
      with: url,
      placeholderImage: glyph.image,
      options: [],
      context: [.imageThumbnailPixelSize: CGSize(width: side, height: side)],
      progress: nil
    ) { [weak self] image, _, _, _ in
      guard let self, image != nil else { return }
      self.glyph.contentMode = .scaleAspectFill
      self.setNeedsLayout()
    }
  }

  @objc private func pressed() {
    onPress?(pill)
  }

  /// The glyph by its name: one of the app's symbol sets or pictures, such as a Manager's face, or an SF Symbol where the panel draws none of its own.
  static func image(named name: String) -> UIImage? {
    let configuration = UIImage.SymbolConfiguration(font: pillFont(), scale: .small)
    return UIImage(named: name, in: nil, with: configuration)
      ?? UIImage(systemName: name, withConfiguration: configuration)
  }

  /// The pill's size at the reader's text size, no wider than the line it stands in.
  static func size(of pill: Pill, within width: CGFloat) -> CGSize {
    let font = pillFont()
    let words = ceil((pill.words as NSString).size(withAttributes: [.font: font]).width)
    let glyphSide = ceil(font.pointSize)
    let natural = PillSpace.leading + glyphSide + PillSpace.gap + words + PillSpace.trailing
    let widest = width > 0 ? width : natural
    return CGSize(width: min(natural, widest), height: ceil(font.lineHeight) + PillSpace.rise * 2)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let glyphSide = ceil(label.font.pointSize)
    // Note that a thumbnail stands as a square centered on the pill, a hair taller than the words, where a glyph stands at its font's own size in the pill's whole height.
    glyph.frame =
      pill.thumbnail == nil
      ? CGRect(x: PillSpace.leading, y: 0, width: glyphSide, height: bounds.height)
      : CGRect(x: PillSpace.leading, y: (bounds.height - glyphSide) / 2, width: glyphSide, height: glyphSide)
    let wordsStart = glyph.frame.maxX + PillSpace.gap
    label.frame = CGRect(
      x: wordsStart,
      y: 0,
      width: max(bounds.width - wordsStart - PillSpace.trailing, 0),
      height: bounds.height
    )
  }
}

// MARK: - The field

/// UIKit's text view, which copies and cuts the selection as its Markdown and is heard with each pill as its words.
final class PillTextView: UITextView {
  weak var field: PillFieldView?

  override func copy(_ sender: Any?) {
    guard let field else { return super.copy(sender) }
    field.copySelection()
  }

  override func cut(_ sender: Any?) {
    guard let field, selectedRange.length > 0, isEditable else { return super.cut(sender) }
    field.copySelection()
    // Note that a delete over the selection goes through the text view's own editing, so undo takes it back.
    deleteBackward()
  }

  override var accessibilityValue: String? {
    get { field?.heardWords() ?? super.accessibilityValue }
    set { super.accessibilityValue = newValue }
  }
}

final class PillFieldView: ExpoView, UITextViewDelegate {
  let onWords = EventDispatcher()
  let onHeight = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onPillPress = EventDispatcher()

  private let textView = PillTextView(usingTextLayoutManager: true)
  private let placeholderLabel = UILabel()

  /// How many changes have been typed, which a handing must have heard to be taken.
  private var changes = 0

  /// The height last told to JavaScript; none yet.
  private var toldHeight: CGFloat?

  /// The words' length and the width the field last measured its words at, which a field already at its most lines skips measuring again while its words only grow.
  private var measured: (length: Int, width: CGFloat)?

  /// Whether an edit of the view's own is under way, which tells JavaScript once it is whole rather than as the text view reports each step.
  private var quiet = false

  var look = Look() {
    didSet {
      guard look != oldValue else { return }
      drawLook()
      redraw(heldRuns(), force: true)
      restyle(spans)
    }
  }

  var placeholder = "" {
    didSet {
      placeholderLabel.text = placeholder
      textView.accessibilityLabel = placeholder
    }
  }

  // Note that a new most of lines measures the words again, since a field already scrolling at the same width otherwise kept the height of its old most.
  var maxLines = defaultMaxLines {
    didSet {
      if maxLines != oldValue { measured = nil }
      setNeedsLayout()
    }
  }

  var editable = true {
    didSet { textView.isEditable = editable }
  }

  /// The looks last handed, laid again where the words are drawn anew, such as at a new text size.
  private var spans: [(range: NSRange, styles: [String])] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.field = self
    textView.delegate = self
    textView.backgroundColor = .clear
    textView.textContainerInset = .zero
    textView.textContainer.lineFragmentPadding = 0
    textView.isScrollEnabled = false
    textView.allowsEditingTextAttributes = false
    textView.adjustsFontForContentSizeCategory = true
    textView.font = bodyFont()
    placeholderLabel.font = bodyFont()
    placeholderLabel.adjustsFontForContentSizeCategory = true
    placeholderLabel.isAccessibilityElement = false
    addSubview(textView)
    addSubview(placeholderLabel)
    drawLook()

    // Note that pills are drawn anew at a new text size, since each measured its words at the old one.
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: PillFieldView, _: UITraitCollection) in
      view.redraw(view.heldRuns(), force: true)
      view.restyle(view.spans)
    }
  }

  // MARK: Doors JavaScript opens

  /// Takes the runs JavaScript hands, once it has heard every change typed, redrawing only where they differ from the words held.
  func take(_ styled: StyledRuns, seen: Int) {
    guard seen >= changes else { return }

    if styled.runs != heldRuns() {
      // Note that words being composed, as a keyboard of marks or dictation holds them, are committed first, so a reset such as a cleared field lands rather than waiting on a composition that would then tell the old words back.
      if textView.markedTextRange != nil {
        quiet = true
        textView.unmarkText()
        quiet = false
      }

      redraw(styled.runs, force: false)
    }

    // Note that words being composed are left as the keyboard draws them, and take their looks with the handing after they are committed.
    guard textView.markedTextRange == nil else { return }
    restyle(styled.spans)
  }

  /// The range the pills go in: the word a pick replaces where it still stands where JavaScript read it, else the nearest such words before the caret on its line, else the caret, so a pick made while words were still being typed lands rather than being dropped.
  private func pickRange(over word: Word?) -> NSRange {
    let string = textView.textStorage.string as NSString
    let caret = textView.selectedRange
    guard let word, !word.text.isEmpty else { return caret }
    let length = (word.text as NSString).length
    let read = NSRange(location: word.start, length: length)

    if word.start >= 0, NSMaxRange(read) <= string.length, string.substring(with: read) == word.text {
      return read
    }

    let lineStart = string.lineRange(for: NSRange(location: min(caret.location, string.length), length: 0)).location
    let reach = min(NSMaxRange(caret) + length, string.length)
    let found = string.range(of: word.text, options: .backwards, range: NSRange(location: lineStart, length: reach - lineStart))

    return found.location == NSNotFound ? caret : found
  }

  /// Puts the pills in the range a pick names (`pickRange`), or at the caret, each followed by a space, the last unless one stands there.
  func insertPills(_ pills: [Pill], over word: Word?) {
    let storage = textView.textStorage
    let range = pickRange(over: word)
    guard editable, !pills.isEmpty, NSMaxRange(range) <= storage.length else { return }
    guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let replaced = textView.textRange(from: start, to: end)
    else { return }
    let string = storage.string as NSString
    let next = NSMaxRange(range) < string.length ? string.character(at: NSMaxRange(range)) : nil
    // Note that a space standing after the last is kept and stepped over, and a line's end needs none.
    let spaced = next == space || next == lineBreak
    let words = Array(repeating: "\u{FFFC} ", count: pills.count).joined()
    let typed = spaced ? String(words.dropLast()) : words

    // Note that the words are replaced through the text view's own editing, so undo takes the pick back, and each pill is then laid on its character, which moves no words undo knows of.
    quiet = true
    textView.replace(replaced, withText: typed)
    for (index, pill) in pills.enumerated() {
      let character = NSRange(location: range.location + index * 2, length: 1)
      storage.setAttributes(baseAttributes(), range: character)
      storage.addAttribute(.attachment, value: attachment(of: pill), range: character)
    }
    quiet = false
    let after = range.location + (typed as NSString).length + (next == space ? 1 : 0)
    textView.selectedRange = NSRange(location: after, length: 0)
    textView.typingAttributes = baseAttributes()
    changed()
  }

  /// Writes plain words in the range a pick names (`pickRange`), such as `@people:` in place of the `@` word as a kind is picked to narrow it, the caret after them.
  func rewriteWord(_ text: String, over word: Word?) {
    let range = pickRange(over: word)
    guard editable, NSMaxRange(range) <= textView.textStorage.length,
      let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let replaced = textView.textRange(from: start, to: end)
    else { return }

    quiet = true
    textView.replace(replaced, withText: text)
    quiet = false
    textView.selectedRange = NSRange(location: range.location + (text as NSString).length, length: 0)
    textView.typingAttributes = baseAttributes()
    changed()
  }

  /**
   * Takes the words out of the field for a send, in one step on the main
   * thread, where every key lands: answers their Markdown as the field holds
   * it, and the count of changes the emptying stands at. Note that a second
   * send finds the field empty, so one press, or two that reach JavaScript
   * together, sends the words once, and a handing made before the take,
   * which has not heard it, is refused rather than laying the words back.
   * The emptying is told to JavaScript only through the answer, never as the
   * field's own telling, so JavaScript hears it once the send has taken the
   * words, and never where they go back (`putBack`), which would let go of
   * the files their markers hold.
   */
  func takeWords() -> [String: Any] {
    quiet = true

    // Note that words being composed, as dictation or a keyboard of marks holds them, are committed first, so they go with the rest.
    if textView.markedTextRange != nil { textView.unmarkText() }

    let markdown = markdown(of: heldRuns())

    if !markdown.isEmpty {
      redraw([], force: false)
      changes += 1
    }

    quiet = false
    return ["markdown": markdown, "changes": changes]
  }

  /// Lays words a send did not take back in the field, ahead of anything typed since, with the caret after everything.
  func putBack(_ runs: [Run]) {
    guard editable, !runs.isEmpty else { return }

    if textView.markedTextRange != nil {
      quiet = true
      textView.unmarkText()
      quiet = false
    }

    let held = heldRuns()
    redraw(held.isEmpty ? runs : runs + [.words("\n")] + held, force: false)
    textView.selectedRange = NSRange(location: textView.textStorage.length, length: 0)
    changed()
  }

  func focus() {
    textView.becomeFirstResponder()
  }

  func blur() {
    textView.resignFirstResponder()
  }

  // MARK: The text view's delegate

  func textViewDidChange(_ textView: UITextView) {
    guard !quiet else { return }
    changed()
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    guard !quiet else { return }
    tell()
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onFocusChange(["focused": true])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    onFocusChange(["focused": false])
  }

  // MARK: Words

  /// The attributes plain words are typed with.
  private func baseAttributes() -> [NSAttributedString.Key: Any] {
    [.font: bodyFont(), .foregroundColor: look.text]
  }

  /// The runs drawn: words in the body's face, and each pill an attachment in the same face, so the line keeps its height.
  private func drawn(_ runs: [Run]) -> NSAttributedString {
    let built = NSMutableAttributedString()

    for run in runs {
      switch run {
      case .words(let text):
        built.append(NSAttributedString(string: text, attributes: baseAttributes()))
      case .pill(let pill):
        let piece = NSMutableAttributedString(
          attributedString: NSAttributedString(attachment: attachment(of: pill))
        )
        piece.addAttributes(baseAttributes(), range: NSRange(location: 0, length: piece.length))
        built.append(piece)
      }
    }

    return built
  }

  /// A pill's attachment, whose press, on a picture's pill, tells JavaScript which pill it was, by its Markdown.
  private func attachment(of pill: Pill) -> PillAttachment {
    PillAttachment(pill: pill, look: look) { [weak self] pressed in
      self?.onPillPress(["markdown": pressed.markdown])
    }
  }

  /// The runs the words hold in the range: each pill's attachment a pill, and everything else words, any other attachment's character among them.
  private func heldRuns(in range: NSRange? = nil) -> [Run] {
    let storage = textView.textStorage
    let string = storage.string as NSString
    let whole = range ?? NSRange(location: 0, length: storage.length)
    var runs: [Run] = []
    var words = ""

    storage.enumerateAttribute(.attachment, in: whole) { value, piece, _ in
      guard let attachment = value as? PillAttachment else {
        words += string.substring(with: piece)
        return
      }

      if !words.isEmpty { runs.append(.words(words)) }
      words = ""
      runs.append(contentsOf: Array(repeating: Run.pill(attachment.pill), count: piece.length))
    }

    if !words.isEmpty { runs.append(.words(words)) }
    return runs
  }

  /// The runs as the Markdown they stand for.
  private func markdown(of runs: [Run]) -> String {
    runs.map(\.markdown).joined()
  }

  /// Where a point of the drawn words stands in the Markdown, a pill counting its Markdown's length.
  private func markdownOffset(of drawnAt: Int, in runs: [Run]) -> Int {
    var drawn = 0
    var written = 0

    for run in runs {
      let length = run.drawnLength
      if drawnAt < drawn + length {
        if case .words = run { return written + (drawnAt - drawn) }
        return written
      }
      drawn += length
      written += (run.markdown as NSString).length
    }

    return written
  }

  /// Where a point of the Markdown stands in the drawn words: inside a pill's Markdown, after the pill.
  private func drawnOffset(of writtenAt: Int, in runs: [Run]) -> Int {
    var drawn = 0
    var written = 0

    for run in runs {
      let length = (run.markdown as NSString).length
      if writtenAt < written + length {
        if case .words = run { return drawn + (writtenAt - written) }
        return writtenAt == written ? drawn : drawn + 1
      }
      drawn += run.drawnLength
      written += length
    }

    return drawn
  }

  /// Lays in the runs where they differ from the words held, or always where forced, keeping the caret where it stood in the Markdown.
  private func redraw(_ runs: [Run], force: Bool) {
    let held = heldRuns()
    guard force || runs != held else { return }
    let selected = textView.selectedRange
    let atEnd = selected.length == 0 && selected.location == textView.textStorage.length
    let selectionStart = markdownOffset(of: selected.location, in: held)
    let selectionEnd = markdownOffset(of: NSMaxRange(selected), in: held)
    textView.attributedText = drawn(runs)
    // Note that words laid in whole leave nothing for undo's earlier steps to stand on, so they are let go rather than landing on the wrong words.
    textView.undoManager?.removeAllActions()

    // Note that a caret at the words' end stays at their end, so words added there, as dictation's or a picked skill's, leave it after them.
    if atEnd {
      textView.selectedRange = NSRange(location: textView.textStorage.length, length: 0)
    } else {
      let start = drawnOffset(of: selectionStart, in: runs)
      let end = max(drawnOffset(of: selectionEnd, in: runs), start)
      textView.selectedRange = NSRange(location: start, length: end - start)
    }
    textView.typingAttributes = baseAttributes()
    placeholderLabel.isHidden = textView.textStorage.length > 0
    setNeedsLayout()
  }

  /// What a change typed does: counts it, keeps typing in the plain face, and tells JavaScript.
  private func changed() {
    changes += 1
    textView.typingAttributes = baseAttributes()
    placeholderLabel.isHidden = textView.textStorage.length > 0
    setNeedsLayout()
    tell()
  }

  /// Tells JavaScript the runs, so it writes the Markdown with a marker typed as words escaped, and the caret's line before and after it with each pill as the object character.
  private func tell() {
    let string = textView.textStorage.string as NSString
    let selected = textView.selectedRange
    let caret = min(selected.location, string.length)
    let selectionEnd = min(NSMaxRange(selected), string.length)
    let lineBreak = string.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: caret))
    let lineStart = lineBreak.location == NSNotFound ? 0 : NSMaxRange(lineBreak)
    let rest = NSRange(location: selectionEnd, length: string.length - selectionEnd)
    let nextBreak = string.range(of: "\n", options: [], range: rest)
    let lineEnd = nextBreak.location == NSNotFound ? string.length : nextBreak.location

    onWords([
      "runs": heldRuns().map(\.told),
      "before": string.substring(with: NSRange(location: lineStart, length: caret - lineStart)),
      "after": string.substring(with: NSRange(location: selectionEnd, length: lineEnd - selectionEnd)),
      "caret": caret,
      "selected": selected.length > 0,
      "changes": changes,
    ])
  }

  /// Puts the selection's Markdown on the pasteboard as plain words, as the desktop's box copies.
  func copySelection() {
    let selected = textView.selectedRange
    guard selected.length > 0 else { return }
    UIPasteboard.general.string = markdown(of: heldRuns(in: selected))
  }

  /// The words as VoiceOver hears them, each pill as its words.
  func heardWords() -> String {
    heldRuns().map { run in
      switch run {
      case .words(let text): return text
      case .pill(let pill): return pill.heard
      }
    }.joined()
  }

  // MARK: Looks

  /// Lays the looks handed on the words they name, in place of those laid before, and draws them.
  func restyle(_ handed: [(range: NSRange, styles: [String])]) {
    let storage = textView.textStorage
    let whole = NSRange(location: 0, length: storage.length)
    // Note that a field handed no looks, as every composer is, lays none, so its words are never walked again on each key.
    guard !(handed.isEmpty && spans.isEmpty) else { return }
    spans = handed
    // Note that a look changes the words' faces and so their height, which the next layout measures again rather than keeping the height measured before.
    measured = nil

    quiet = true
    storage.beginEditing()
    storage.removeAttribute(markStylesKey, range: whole)
    for span in handed where NSMaxRange(span.range) <= storage.length {
      storage.addAttribute(markStylesKey, value: span.styles, range: span.range)
    }
    storage.endEditing()
    quiet = false
    drawStyles()
  }

  /// Draws each span of the words in the looks laid on it, and plain words in the body's face.
  private func drawStyles() {
    let storage = textView.textStorage
    let whole = NSRange(location: 0, length: storage.length)

    quiet = true
    storage.beginEditing()
    storage.enumerateAttribute(markStylesKey, in: whole) { value, range, _ in
      let styles = Set(((value as? [String]) ?? []).compactMap(MarkStyle.init))
      storage.removeAttribute(.strikethroughStyle, range: range)
      storage.removeAttribute(.underlineStyle, range: range)
      storage.removeAttribute(.backgroundColor, range: range)
      storage.addAttributes(lookAttributes(styles), range: range)
    }
    // Note that a pill keeps the body's face whatever words it stands among, so its line keeps its height and it its size.
    storage.enumerateAttribute(.attachment, in: whole) { value, range, _ in
      guard value is PillAttachment else { return }
      storage.addAttributes(baseAttributes(), range: range)
    }
    storage.endEditing()
    quiet = false
    setNeedsLayout()
  }

  /// The attributes a span is drawn with: its face, sized by the reader's text size, and its color, a mark of syntax faded.
  private func lookAttributes(_ styles: Set<MarkStyle>) -> [NSAttributedString.Key: Any] {
    var attributes: [NSAttributedString.Key: Any] = [
      .font: lookFont(styles),
      .foregroundColor: styles.isDisjoint(with: [MarkStyle.syntax, .quote, .listMark, .rule]) ? look.text : look.placeholder,
    ]

    if styles.contains(.strike) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if styles.contains(.link) { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    if styles.contains(.code) { attributes[.backgroundColor] = look.pillFill }

    return attributes
  }

  /// A span's face: a heading's text style, bold and italic as its looks ask, and code in the monospaced face, each at the reader's text size.
  private func lookFont(_ styles: Set<MarkStyle>) -> UIFont {
    let base: UIFont =
      styles.contains(.heading1) ? .preferredFont(forTextStyle: .title2)
      : styles.contains(.heading2) ? .preferredFont(forTextStyle: .title3)
      : styles.contains(.heading3) ? .preferredFont(forTextStyle: .headline)
      : bodyFont()
    let bold = styles.contains(.strong) || !styles.isDisjoint(with: [MarkStyle.heading1, .heading2])

    if !styles.isDisjoint(with: [MarkStyle.code, .codeBlock]) {
      return .monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: bold ? .semibold : .regular)
    }

    var traits = base.fontDescriptor.symbolicTraits
    if bold { traits.insert(.traitBold) }
    if styles.contains(.emphasis) { traits.insert(.traitItalic) }

    return base.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: 0) } ?? base
  }

  // MARK: Drawing

  private func drawLook() {
    textView.textColor = look.text
    textView.tintColor = look.tint
    placeholderLabel.textColor = look.placeholder
  }

  /// Stands the text view over the whole field, grown to its words up to its most lines and scrolling past them, and tells JavaScript the height it asks for.
  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    guard width > 0 else { return }
    let line = ceil(bodyFont().lineHeight)
    let most = line * CGFloat(maxLines)
    let length = textView.textStorage.length

    // Note that a field already scrolling at its most lines, whose words only grew at the same width, stays at its most, so its long words are not laid out whole again on every key, as SwiftUI's field did until it hung.
    if textView.isScrollEnabled, let measured, measured.width == width, length >= measured.length {
      textView.frame = bounds
      placeholderLabel.frame = CGRect(x: 0, y: 0, width: width, height: line)
      if textView.isFirstResponder { textView.scrollRangeToVisible(textView.selectedRange) }
      return
    }

    measured = (length, width)
    let natural = ceil(textView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    let height = max(line, min(natural, most))
    let scrolls = natural > most
    textView.frame = bounds
    placeholderLabel.frame = CGRect(x: 0, y: 0, width: width, height: line)

    if textView.isScrollEnabled != scrolls {
      textView.isScrollEnabled = scrolls
    }

    if scrolls, textView.isFirstResponder {
      textView.scrollRangeToVisible(textView.selectedRange)
    }

    if let toldHeight, abs(toldHeight - height) < heightStep { return }
    toldHeight = height
    onHeight(["height": height])
  }
}
