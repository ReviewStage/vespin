// PillFieldModule.swift -- the app's text field that draws mentions and files' markers as pills inside its words: UIKit's text view on TextKit 2, each pill an attachment whose view is the panel's chip, written back as the Markdown it was handed.
//
// `@repo/ui-native`'s `PillField` hands this view the words as runs
// (`@repo/features/pill-words`): plain words, and pills, each carrying the
// Markdown it stands for, the words and glyph it draws, and what VoiceOver
// hears. Nothing here reads Markdown. The view holds a pill as one
// attachment character, so it selects and deletes as one unit, and writes
// the words back by putting each pill's Markdown in its place. It tells
// JavaScript the Markdown, and the caret's line around it, each pill read as
// the object character, so an `@` word is found as the panel's box finds it
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

import ExpoModulesCore
import UIKit

public final class PillFieldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PillField")

    View(PillFieldView.self) {
      Events("onWords", "onHeight", "onFocusChange")

      Prop("value") { (view: PillFieldView, value: ValueRecord) in
        view.take(value.runs.compactMap(Run.init), seen: value.seen)
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

      AsyncFunction("insertPill") { (view: PillFieldView, start: Int, end: Int, pill: PillRecord) in
        view.insertPill(Pill(pill), replacing: NSRange(location: start, length: end - start))
      }

      AsyncFunction("focus") { (view: PillFieldView) in
        view.focus()
      }

      AsyncFunction("blur") { (view: PillFieldView) in
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
}

struct RunRecord: Record {
  @Field var text: String? = nil
  @Field var pill: PillRecord? = nil
}

struct ValueRecord: Record {
  @Field var runs: [RunRecord] = []
  /// How many changes JavaScript had heard as it handed these runs.
  @Field var seen: Int = 0
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

  init(_ record: PillRecord) {
    markdown = record.markdown
    words = record.words
    glyph = record.glyph
    heard = record.heard
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
private func bodyFont() -> UIFont {
  UIFont.preferredFont(forTextStyle: .body)
}

/// The pill's face: the subheadline's size at the reader's text size, medium, as the panel's chip sets its name.
private func pillFont() -> UIFont {
  UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .subheadline).pointSize, weight: .medium)
}

/// A pill in the words: one attachment character, drawn by its own view.
final class PillAttachment: NSTextAttachment {
  let pill: Pill
  let look: Look

  init(pill: Pill, look: Look) {
    self.pill = pill
    self.look = look
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
    view = PillView(pill: attachment.pill, look: attachment.look)
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

/// The panel's chip: its kind's glyph and its words on a rounded fill, cut short where the line is narrower.
final class PillView: UIView {
  private let glyph = UIImageView()
  private let label = UILabel()

  init(pill: Pill, look: Look) {
    super.init(frame: .zero)
    backgroundColor = look.pillFill
    layer.cornerRadius = PillSpace.radius
    layer.cornerCurve = .continuous
    // Note that a press goes through to the text view, which places the caret beside the pill, and VoiceOver hears the pill through the text view's words.
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    glyph.image = Self.image(named: pill.glyph)
    glyph.tintColor = look.pillGlyph
    glyph.contentMode = .center
    label.text = pill.words
    label.font = pillFont()
    label.textColor = look.pillWords
    label.lineBreakMode = .byTruncatingTail
    addSubview(glyph)
    addSubview(label)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A pill is never decoded.")
  }

  /// The glyph by its name: one of the app's symbol sets, or an SF Symbol where the panel draws none of its own.
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
    glyph.frame = CGRect(x: PillSpace.leading, y: 0, width: glyphSide, height: bounds.height)
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

  private let textView = PillTextView(usingTextLayoutManager: true)
  private let placeholderLabel = UILabel()

  /// How many changes have been typed, which a handing must have heard to be taken.
  private var changes = 0

  /// The height last told to JavaScript; none yet.
  private var toldHeight: CGFloat?

  var look = Look() {
    didSet {
      guard look != oldValue else { return }
      drawLook()
      redraw(heldRuns(), force: true)
    }
  }

  var placeholder = "" {
    didSet {
      placeholderLabel.text = placeholder
      textView.accessibilityLabel = placeholder
    }
  }

  var maxLines = defaultMaxLines {
    didSet { setNeedsLayout() }
  }

  var editable = true {
    didSet { textView.isEditable = editable }
  }

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
    }
  }

  // MARK: Doors JavaScript opens

  /// Takes the runs JavaScript hands, once it has heard every change typed, redrawing only where they differ from the words held.
  func take(_ runs: [Run], seen: Int) {
    guard seen >= changes, textView.markedTextRange == nil else { return }
    redraw(runs, force: false)
  }

  /// Puts the pill in place of the range of the drawn words, such as the `@` word a pick answers, with a space after it unless one stands there.
  func insertPill(_ pill: Pill, replacing range: NSRange) {
    let storage = textView.textStorage
    guard range.location >= 0, range.length >= 0, NSMaxRange(range) <= storage.length else { return }
    let string = storage.string as NSString
    let end = NSMaxRange(range)
    let next = end < string.length ? string.character(at: end) : nil
    let piece = NSMutableAttributedString(attributedString: drawn([.pill(pill)]))

    // Note that a space standing after the word is kept and stepped over, and a line's end needs none.
    if next != space, next != lineBreak {
      piece.append(NSAttributedString(string: " ", attributes: baseAttributes()))
    }
    storage.replaceCharacters(in: range, with: piece)
    // Note that undo knows nothing of an edit made on the storage, so its earlier steps would land on the wrong words.
    textView.undoManager?.removeAllActions()
    let after = range.location + piece.length + (next == space ? 1 : 0)
    textView.selectedRange = NSRange(location: after, length: 0)
    textView.typingAttributes = baseAttributes()
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
    changed()
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
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
          attributedString: NSAttributedString(attachment: PillAttachment(pill: pill, look: look))
        )
        piece.addAttributes(baseAttributes(), range: NSRange(location: 0, length: piece.length))
        built.append(piece)
      }
    }

    return built
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
    let caret = markdownOffset(of: textView.selectedRange.location, in: held)
    textView.attributedText = drawn(runs)
    textView.undoManager?.removeAllActions()
    textView.selectedRange = NSRange(location: drawnOffset(of: caret, in: runs), length: 0)
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

  /// Tells JavaScript the Markdown, and the caret's line before and after it with each pill as the object character.
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
      "markdown": markdown(of: heldRuns()),
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
