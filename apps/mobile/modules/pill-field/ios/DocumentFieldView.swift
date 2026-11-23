// DocumentFieldView.swift -- the app's rich field for a document edited whole, such as a task's description: UIKit's text view on TextKit 2 drawing each block with no syntax, a heading in its text style, a list with the system's own markers, a task's box, a quote, a code block, and a block the phone cannot edit as a card.
//
// `@repo/ui-native`'s `DocumentField` hands this view the document as lines
// (`document-field-model.ts`), a paragraph each, every line carrying its
// block's facts: its key, kind, a heading's level, a list's start, a code
// block's language, a card's kind, a task's box, and which block of the
// document it came from. The view keeps those facts on the line's words as
// an attribute of their own, so a Return typed in a line carries its block on
// to the new one, as a list's next item; inline looks ride the pill field's
// own attribute (`markStylesKey`), so typing after bold words types bold, and
// a link its address. Nothing here reads or writes Markdown: the view tells
// JavaScript its lines after each change, and JavaScript writes the document
// from them, each untouched block as the source it came from
// (`@repo/features/document-blocks`).

import ExpoModulesCore
import UIKit

// MARK: - What JavaScript hands

/// A block the phone does not edit, drawn as a card: the source it keeps, and the words its card says.
struct CardRecord: Record {
  @Field var source: String = ""
  @Field var title: String = ""
  @Field var detail: String = ""
}

/// A run of a line: words with their looks and address, a pill, or a card.
struct DocumentRunRecord: Record {
  @Field var text: String? = nil
  @Field var marks: [String] = []
  @Field var link: String? = nil
  @Field var pill: PillRecord? = nil
  @Field var card: CardRecord? = nil
}

/// A line of the document, and the facts of the block it belongs to.
struct DocumentLineRecord: Record {
  @Field var block: Int = 0
  @Field var kind: String = DocumentKind.paragraph.rawValue
  @Field var level: Int? = nil
  @Field var start: Int? = nil
  @Field var language: String? = nil
  @Field var locked: String? = nil
  @Field var checked: Bool? = nil
  @Field var depth: Int? = nil
  @Field var marker: String? = nil
  @Field var from: Int? = nil
  @Field var runs: [DocumentRunRecord] = []
}

/// The document's lines, and how many of the view's changes JavaScript had heard as it handed them.
struct DocumentValueRecord: Record {
  @Field var lines: [DocumentLineRecord] = []
  @Field var seen: Int = 0
}

/// One act the edit menu and the keyboard bar offer on the selection: what it does, as `DocumentFormat` names it, and its words and glyph in the panel's vocabulary.
struct FormatActRecord: Record {
  @Field var act: String = ""
  @Field var title: String = ""
  @Field var glyph: String = ""
}

/// The acts the field offers on its selection: its marks, a link, and the blocks a line is turned into, under the menus' own words.
struct FormatsRecord: Record {
  @Field var title: String = ""
  @Field var marks: [FormatActRecord] = []
  @Field var link: FormatActRecord? = nil
  /// The bar's `@`, which types one, so a mention offer opens on it.
  @Field var mention: FormatActRecord? = nil
  @Field var blocksTitle: String = ""
  @Field var blocksGlyph: String = ""
  @Field var blocks: [FormatActRecord] = []
  /// The bar's moves of a list's items a step deeper and back, as Tab and Shift-Tab move them.
  @Field var indent: FormatActRecord? = nil
  @Field var outdent: FormatActRecord? = nil
}

/// What a format act does: a mark toggled on the selection, a link asked for, or the selection's lines turned into a block.
enum DocumentFormat {
  case mark(String)
  case link
  case mention
  case indent
  case outdent
  case block(DocumentKind, level: Int?)

  /// The act JavaScript names: a mark by `MarkStyle`'s name, `link`, or a block by its kind, a heading by `heading-<level>`.
  init?(_ act: String) {
    if let style = MarkStyle(rawValue: act), [MarkStyle.strong, .emphasis, .strike, .code].contains(style) {
      self = .mark(act)
      return
    }

    switch act {
    case "link": self = .link
    case "mention": self = .mention
    case "indent": self = .indent
    case "outdent": self = .outdent
    case "heading-1": self = .block(.heading, level: 1)
    case "heading-2": self = .block(.heading, level: 2)
    case "heading-3": self = .block(.heading, level: 3)
    default:
      guard let kind = DocumentKind(rawValue: act), turnable.contains(kind) else { return nil }
      self = .block(kind, level: nil)
    }
  }
}

/// The blocks a line is turned into, each holding words as a line of its own; a code block, a rule, and a card are made only on the desktop.
private let turnable: Set<DocumentKind> = [.paragraph, .heading, .bulletList, .orderedList, .taskList, .quote]

/// What a block is, as `@repo/features/document-blocks`' `BLOCK_KIND` names it.
enum DocumentKind: String {
  case paragraph
  case heading
  case bulletList = "bullet-list"
  case orderedList = "ordered-list"
  case taskList = "task-list"
  case quote
  case code
  case rule
  case locked
}

/// The list a nested item stands in, as `@repo/features/document-blocks`' `LIST_MARKER` names it, which may differ from its block's own.
enum ListMarker: String {
  case bullet
  case ordered
  case task

  /// The list a list block's own items stand in; none for a block that is no list.
  init?(_ kind: DocumentKind) {
    switch kind {
    case .bulletList: self = .bullet
    case .orderedList: self = .ordered
    case .taskList: self = .task
    default: return nil
    }
  }

  /// The block kind an item in this list draws as.
  var kind: DocumentKind {
    switch self {
    case .bullet: .bulletList
    case .ordered: .orderedList
    case .task: .taskList
    }
  }
}

/// The block a line belongs to, kept on its words as an attribute, so a line a Return types carries it on.
final class LineFacts: NSObject {
  let block: Int
  let kind: String
  let level: Int?
  let start: Int?
  let language: String?
  let locked: String?
  let checked: Bool?
  let from: Int?
  /// How deep a list's item stands under its block's own items, which stand at none.
  let depth: Int?
  /// The list a nested item stands in, as `ListMarker` names it.
  let marker: String?

  init(_ record: DocumentLineRecord) {
    block = record.block
    kind = record.kind
    level = record.level
    start = record.start
    language = record.language
    locked = record.locked
    checked = record.checked
    from = record.from
    depth = record.depth
    marker = record.marker
  }

  init(
    block: Int,
    kind: String,
    level: Int? = nil,
    start: Int? = nil,
    language: String? = nil,
    locked: String? = nil,
    checked: Bool? = nil,
    from: Int? = nil,
    depth: Int? = nil,
    marker: String? = nil
  ) {
    self.block = block
    self.kind = kind
    self.level = level
    self.start = start
    self.language = language
    self.locked = locked
    self.checked = checked
    self.from = from
    self.depth = depth
    self.marker = marker
  }

  var drawnKind: DocumentKind { DocumentKind(rawValue: kind) ?? .paragraph }

  /// Whether the line is a list's item, its block's own or a nested one.
  var isListItem: Bool { ListMarker(drawnKind) != nil }

  /// How deep the line stands, none for a line at its block's own depth.
  var nesting: Int { isListItem ? max(0, depth ?? 0) : 0 }

  /// What the line draws as: a nested item as its own list's item, any other line as its block.
  var itemKind: DocumentKind {
    guard nesting > 0 else { return drawnKind }
    return (marker.flatMap(ListMarker.init(rawValue:)) ?? .bullet).kind
  }

  /// Whether two lines draw alike: everything but which block they belong to and where it came from.
  func drawsAs(_ other: LineFacts) -> Bool {
    kind == other.kind && level == other.level && start == other.start && language == other.language
      && locked == other.locked && checked == other.checked && nesting == other.nesting
      && (nesting == 0 || itemKind == other.itemKind)
  }

  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? LineFacts else { return false }
    return drawsAs(other) && block == other.block && from == other.from
  }

  override var hash: Int { block.hashValue ^ kind.hashValue }

  /// The facts as JavaScript reads them, with nothing a block lacks.
  var told: [String: Any] {
    var facts: [String: Any] = ["block": block, "kind": kind]
    if let level { facts["level"] = level }
    if let start { facts["start"] = start }
    if let language { facts["language"] = language }
    if let locked { facts["locked"] = locked }
    if let checked { facts["checked"] = checked }
    if let from { facts["from"] = from }
    if nesting > 0 {
      facts["depth"] = nesting
      facts["marker"] = ListMarker(itemKind)?.rawValue ?? ListMarker.bullet.rawValue
    }
    return facts
  }
}

/// A card's source and words.
struct Card: Equatable {
  let source: String
  let title: String
  let detail: String
}

/// A run of a line as the view holds it.
enum DocumentRun: Equatable {
  case words(String, marks: [String], link: String?)
  case pill(Pill)
  case card(Card)

  init?(_ record: DocumentRunRecord) {
    if let pill = record.pill {
      self = .pill(Pill(pill))
    } else if let card = record.card {
      self = .card(Card(source: card.source, title: card.title, detail: card.detail))
    } else if let text = record.text {
      self = .words(text, marks: record.marks, link: record.link)
    } else {
      return nil
    }
  }

  /// The run as JavaScript reads it: words with their looks, a pill by its Markdown, a card by its source.
  var told: [String: Any] {
    switch self {
    case .words(let text, let marks, let link):
      var run: [String: Any] = ["text": text, "marks": marks]
      if let link { run["link"] = link }
      return run
    case .pill(let pill): return ["pill": ["markdown": pill.markdown]]
    case .card(let card): return ["card": ["source": card.source]]
    }
  }
}

/// A line as the view holds it: its block's facts and its runs.
struct DocumentLine {
  let facts: LineFacts
  let runs: [DocumentRun]

  init(_ record: DocumentLineRecord) {
    facts = LineFacts(record)
    runs = record.runs.compactMap(DocumentRun.init)
  }

  init(facts: LineFacts, runs: [DocumentRun]) {
    self.facts = facts
    self.runs = runs
  }

  /// Whether two lines draw alike, which a handing that only renames blocks leaves standing.
  func drawsAs(_ other: DocumentLine) -> Bool {
    facts.drawsAs(other.facts) && runs == other.runs
  }

  var told: [String: Any] {
    var line = facts.told
    line["runs"] = runs.map(\.told)
    return line
  }
}

/// A line's block, kept on its words.
private let lineKey = NSAttributedString.Key("VespinLine")

/// The address a run of words links to.
private let linkKey = NSAttributedString.Key("VespinLink")

/// A run of a list's items at one depth as the field draws them: their kind, the list they stand in, the number its first item took, and how many items it holds so far.
private struct ListRun {
  let kind: DocumentKind
  let start: Int
  var items: Int
}

/// The runs of a block's items standing open as its lines are drawn, outermost first.
private struct ListNesting {
  let block: Int
  let runs: [ListRun]
}

/// What stands in a list item's gutter, as the desktop's list marks it: a bullet that changes with the item's depth (a disc, a ring, a square, as a browser marks nested lists), or its number.
enum ItemMark: Equatable {
  case bullet(depth: Int)
  case number(Int)

  /// The mark of the item after this one in its run.
  var next: ItemMark {
    switch self {
    case .bullet: self
    case .number(let number): .number(number + 1)
    }
  }
}

/// An item's mark as its paragraph's words hold it, with the ink it is drawn in, which the item's layout fragment reads to draw it.
final class ItemMarkValue: NSObject {
  let mark: ItemMark
  let color: UIColor

  init(_ mark: ItemMark, color: UIColor) {
    self.mark = mark
    self.color = color
  }

  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? ItemMarkValue else { return false }
    return other.mark == mark && other.color == color
  }

  override var hash: Int {
    switch mark {
    case .bullet(let depth): return depth
    case .number(let number): return 1_000 + number
    }
  }
}

/// Where an item's mark is held on its paragraph's words.
let itemMarkKey = NSAttributedString.Key("dev.vespin.document.itemMark")

/// A list's gutter and its mark, as the read view's `Markdown` sets them after the desktop's prose: the gutter's width in body sizes and the points between it and the words, and a bullet's width and how far in from the gutter's end it stands, in body sizes; a number ends at the gutter's end.
private enum MarkSize {
  static let gutter: CGFloat = 1.4
  static let gutterGap: CGFloat = 4
  static let bullet: CGFloat = 0.34
  static let bulletInset: CGFloat = 0.2
}

/// How wide a list's gutter stands, and so how far each depth stands in, at the body's size the reader chose.
func listIndent() -> CGFloat {
  bodyFont().pointSize * MarkSize.gutter + MarkSize.gutterGap
}

/// Draws an item's mark in the gutter before `textStart`, on the line whose baseline is `baseline`, in the current context: a bullet on the middle of the line's lowercase letters, a number on its baseline, each in `color`.
func drawItemMark(_ mark: ItemMark, textStart: CGFloat, baseline: CGFloat, font: UIFont, color: UIColor) {
  let size = font.pointSize

  switch mark {
  case .bullet(let depth):
    let dot = size * MarkSize.bullet
    let middle = baseline - font.xHeight / 2
    let rect = CGRect(x: textStart - size * MarkSize.bulletInset - MarkSize.gutterGap - dot, y: middle - dot / 2, width: dot, height: dot)
    color.set()

    switch depth % 3 {
    case 0:
      UIBezierPath(ovalIn: rect).fill()
    case 1:
      let line = max(1, dot * 0.16)
      let ring = UIBezierPath(ovalIn: rect.insetBy(dx: line / 2, dy: line / 2))
      ring.lineWidth = line
      ring.stroke()
    default:
      UIBezierPath(rect: rect.insetBy(dx: dot * 0.08, dy: dot * 0.08)).fill()
    }
  case .number(let number):
    let face = UIFont.monospacedDigitSystemFont(ofSize: size, weight: .regular)
    let words = NSAttributedString(string: "\(number).", attributes: [.font: face, .foregroundColor: color])
    let width = words.size().width
    words.draw(at: CGPoint(x: textStart - MarkSize.gutterGap - width, y: baseline - face.ascender))
  }
}

/// A paragraph's layout as TextKit lays it, drawing a list item's mark in its gutter before its first line, since the system's own list markers stand in the words' full ink at their own size.
final class ItemMarkFragment: NSTextLayoutFragment {
  override var renderingSurfaceBounds: CGRect {
    // Note that the mark stands in the gutter left of the words, which the fragment's own frame starts past where its paragraph is set in, so the surface reaches back to the container's edge, or the mark is cut at the frame's.
    let gutter = CGRect(x: -layoutFragmentFrame.minX, y: 0, width: layoutFragmentFrame.maxX, height: layoutFragmentFrame.height)
    return super.renderingSurfaceBounds.union(gutter)
  }

  override func draw(at point: CGPoint, in context: CGContext) {
    super.draw(at: point, in: context)
    guard let paragraph = textElement as? NSTextParagraph, let line = textLineFragments.first else { return }
    let text = paragraph.attributedString
    guard text.length > 0 else { return }
    var held: ItemMarkValue?

    // Note that the mark is read from any of the paragraph's words, since words typed at the item's start hold none until it is drawn again.
    text.enumerateAttribute(itemMarkKey, in: NSRange(location: 0, length: text.length)) { value, _, stop in
      guard let value = value as? ItemMarkValue else { return }
      held = value
      stop.pointee = true
    }

    guard let held else { return }
    let font = text.attribute(.font, at: 0, effectiveRange: nil) as? UIFont ?? bodyFont()
    let style = text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
    let textStart = (style?.firstLineHeadIndent ?? 0) - layoutFragmentFrame.minX
    let baseline = line.typographicBounds.minY + line.glyphOrigin.y
    UIGraphicsPushContext(context)
    defer { UIGraphicsPopContext() }
    drawItemMark(held.mark, textStart: point.x + textStart, baseline: point.y + baseline, font: font, color: held.color)
  }
}

/// The mark of an empty last list item, which holds no words for a layout fragment to draw it beside, drawn over the field where its line stands.
final class EndMarkView: UIView {
  var mark: ItemMark?
  var font: UIFont = bodyFont()
  var color: UIColor = .secondaryLabel
  var baseline: CGFloat = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("An item's mark is never decoded.")
  }

  override func draw(_ rect: CGRect) {
    guard let mark else { return }
    drawItemMark(mark, textStart: bounds.width, baseline: baseline, font: font, color: color)
  }
}

/// How far a list's, a task's and a quote's lines stand in from the edge.
private enum DocumentSpace {
  static let quoteIndent: CGFloat = 14
  static let blockGap: CGFloat = 10
  /// The room between a list's items, a share of the body's size, as the read view's.
  static let itemGapShare: CGFloat = 0.25
  static let cardHeight: CGFloat = 52
  static let cardRadius: CGFloat = 10
  static let cardPadding: CGFloat = 12
  /// How far above the keyboard the caret's line stands once the field scrolls it clear.
  static let caretClearance: CGFloat = 12
  /// How much room above and below the caret's line a page holding a field grown to its words leaves as it scrolls the caret into sight.
  static let caretReveal: CGFloat = 48
}

// MARK: - What a line draws besides its words

/// A task's box at its line's start, checked or not, which is none of the line's words.
final class TaskBoxAttachment: NSTextAttachment {
  let checked: Bool

  init(checked: Bool, look: Look) {
    self.checked = checked
    super.init(data: nil, ofType: nil)
    let configuration = UIImage.SymbolConfiguration(font: bodyFont(), scale: .medium)
    image = UIImage(systemName: checked ? "checkmark.square.fill" : "square", withConfiguration: configuration)?
      .withTintColor(checked ? look.text : look.placeholder, renderingMode: .alwaysOriginal)
    accessibilityLabel = checked ? "Done" : "Not done"
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A task's box is never decoded.")
  }
}

/// A block drawn whole as one character: a rule's line, or a card the phone does not edit.
final class BlockAttachment: NSTextAttachment {
  let card: Card?
  let look: Look

  init(card: Card?, look: Look) {
    self.card = card
    self.look = look
    super.init(data: nil, ofType: nil)
    accessibilityLabel = card.map { "\($0.title), \($0.detail)" } ?? "Divider"
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A block is never decoded.")
  }

  override func viewProvider(
    for parentView: UIView?,
    location: any NSTextLocation,
    textContainer: NSTextContainer?
  ) -> NSTextAttachmentViewProvider? {
    let provider = BlockViewProvider(
      textAttachment: self,
      parentView: parentView,
      textLayoutManager: textContainer?.textLayoutManager,
      location: location
    )
    provider.tracksTextAttachmentViewBounds = true
    return provider
  }
}

/// Stands a block across its line: a card at its height, a rule as a hairline.
final class BlockViewProvider: NSTextAttachmentViewProvider {
  override func loadView() {
    guard let attachment = textAttachment as? BlockAttachment else { return }
    view = BlockView(card: attachment.card, look: attachment.look)
  }

  override func attachmentBounds(
    for attributes: [NSAttributedString.Key: Any],
    location: any NSTextLocation,
    textContainer: NSTextContainer?,
    proposedLineFragment: CGRect,
    position: CGPoint
  ) -> CGRect {
    guard let attachment = textAttachment as? BlockAttachment else { return .zero }
    let width = max(proposedLineFragment.width - 1, 1)
    let font = attributes[.font] as? UIFont ?? bodyFont()

    if attachment.card == nil {
      return CGRect(x: 0, y: font.capHeight / 2, width: width, height: 1)
    }

    return CGRect(x: 0, y: font.descender, width: width, height: DocumentSpace.cardHeight)
  }
}

/// A card's two lines on the raised fill, or a rule's hairline.
final class BlockView: UIView {
  init(card: Card?, look: Look) {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    isAccessibilityElement = false

    guard let card else {
      backgroundColor = look.placeholder
      return
    }

    backgroundColor = look.pillFill
    layer.cornerRadius = DocumentSpace.cardRadius
    layer.cornerCurve = .continuous
    let title = UILabel()
    title.text = card.title
    title.font = .preferredFont(forTextStyle: .subheadline).withWeight(.semibold)
    title.textColor = look.text
    let detail = UILabel()
    detail.text = card.detail
    detail.font = .preferredFont(forTextStyle: .footnote)
    detail.textColor = look.placeholder
    detail.lineBreakMode = .byTruncatingTail
    let stack = UIStackView(arrangedSubviews: [title, detail])
    stack.axis = .vertical
    stack.spacing = 2
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: DocumentSpace.cardPadding),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -DocumentSpace.cardPadding),
      stack.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A block is never decoded.")
  }
}

extension UIFont {
  /// The same face at another weight.
  func withWeight(_ weight: UIFont.Weight) -> UIFont {
    .systemFont(ofSize: pointSize, weight: weight)
  }
}

// MARK: - The field

final class DocumentFieldView: ExpoView, UITextViewDelegate {
  let onLines = EventDispatcher()
  let onHeight = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onLinkAsk = EventDispatcher()
  let onCaret = EventDispatcher()

  private let textView = UITextView(usingTextLayoutManager: true)
  private let placeholderLabel = UILabel()
  /// The mark of an empty last list item, which no layout fragment draws.
  private let endMark = EndMarkView()

  /// How many changes have been typed, which a handing must have heard to be taken.
  private var changes = 0

  /// Whether an edit of the view's own is under way, which tells JavaScript nothing.
  private var quiet = false

  /// The words an edit typed, where they stand once it lands, whose block and looks are carried on to them.
  private var typed: NSRange?

  /// The words the last edit the text itself saw laid in, which the keyboard's own edits, such as a prediction it commits, lay in without asking the field first.
  private var landed: NSRange?

  var look = Look() {
    didSet {
      guard look != oldValue else { return }
      placeholderLabel.textColor = look.placeholder
      textView.tintColor = look.tint
      bar?.tintColor = look.text
      redraw(heldLines())
    }
  }

  var placeholder = "" {
    didSet {
      placeholderLabel.text = placeholder
      textView.accessibilityLabel = placeholder
    }
  }

  var editable = true {
    didSet { textView.isEditable = editable }
  }

  /// Whether the field grows to its words inside the page that holds it, as a description edited in place stands in its task's list, rather than scrolling them itself; it then tells JavaScript the height its words ask for.
  var fitsWords = false {
    didSet {
      guard fitsWords != oldValue else { return }
      textView.isScrollEnabled = !fitsWords
      textView.alwaysBounceVertical = !fitsWords
      toldHeight = nil
      setNeedsLayout()
    }
  }

  /// The height last told while the field grows to its words.
  private var toldHeight: CGFloat?

  /// A focus asked for before the field stood in a window, as a page's list builds its rows only once they come in sight, laid once it does.
  private var focusWhenShown: (() -> Void)?

  /// The acts the field offers on its selection, in the edit menu and the bar over the keyboard; none for a field that offers none.
  var formats: FormatsRecord? {
    didSet { buildBar() }
  }

  /// The bar over the keyboard, and its buttons by the act each does.
  private var bar: UIToolbar?
  private var barItems: [(act: String, item: UIBarButtonItem)] = []
  /// The bar's Outdent and Indent, standing in its last marks' place while the caret is in a list item, and whether the bar stands that way now.
  private var moveItems: (outdent: UIBarButtonItem, indent: UIBarButtonItem)?
  private var barInList = false

  /// The looks the next words typed at a caret take, where a mark was toggled with nothing selected, as Notes' Bold does.
  private var typingMarks: (at: Int, marks: [String])?

  /// The words a link is asked for, kept while JavaScript asks for its address.
  private var linkRange: NSRange?

  /// Where the keyboard's top stands in the window, none while no keyboard stands.
  private var keyboardTop: CGFloat?

  /// The words a link is asked for, which the address is laid on only where they still stand.
  private var linkWords: String?

  /// The block an empty last line is turned into before anything is typed on it, which holds no character to keep it: where the line stands, and its facts, which the words typed there take.
  private var pendingLine: (at: Int, facts: LineFacts)?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.delegate = self
    // Note that each paragraph is laid out by a fragment that draws its item's mark, since the system's list markers draw in the words' full ink at their own size.
    textView.textLayoutManager?.delegate = self
    textView.addSubview(endMark)
    endMark.isHidden = true
    textView.backgroundColor = .clear
    // Note that the words are inset for the whole safe area, the bar over them included, wherever the field stands: under automatic, iPadOS 26 counts no form sheet's bar, so a sheet's first line stood under it.
    textView.contentInsetAdjustmentBehavior = .always
    textView.textContainer.lineFragmentPadding = 0
    textView.allowsEditingTextAttributes = false
    textView.adjustsFontForContentSizeCategory = true
    textView.alwaysBounceVertical = true
    textView.keyboardDismissMode = .interactive
    textView.font = bodyFont()
    placeholderLabel.font = bodyFont()
    placeholderLabel.adjustsFontForContentSizeCategory = true
    placeholderLabel.isAccessibilityElement = false
    addSubview(textView)
    addSubview(placeholderLabel)

    // Note that the words stand clear of the keyboard, as Notes keeps the caret in view, since the field fills its page.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardMoved(_:)),
      name: UIResponder.keyboardWillChangeFrameNotification,
      object: nil
    )

    // Note that the text's own word of each edit is kept, so the block and looks carry on to words the keyboard lays in without asking, as it commits a prediction typed as marked words.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(textEdited(_:)),
      name: NSTextStorage.didProcessEditingNotification,
      object: textView.textStorage
    )

    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: DocumentFieldView, _: UITraitCollection) in
      view.redraw(view.heldLines())
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
    tellHeight()
    let line = ceil(bodyFont().lineHeight)
    placeholderLabel.frame = CGRect(
      x: textView.textContainerInset.left,
      y: textView.textContainerInset.top,
      width: bounds.width - textView.textContainerInset.left - textView.textContainerInset.right,
      height: line
    )
  }

  @objc private func textEdited(_ notification: Notification) {
    let storage = textView.textStorage
    guard !quiet, storage.editedMask.contains(.editedCharacters), storage.editedRange.location != NSNotFound,
      storage.editedRange.length > 0
    else { return }
    landed = storage.editedRange
  }

  @objc private func keyboardMoved(_ notification: Notification) {
    guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
      let window
    else { return }
    // Note that the frame is the screen's, which a window in Split View or Stage Manager does not share, and that only a keyboard docked to the window's foot covers the field: one going away ends below the window, and a floating or undocked one stands clear of its foot, so neither moves the words. A hardware keyboard's shortcut bar is docked, and covers only its own height. The bar over the keyboard is the text view's own accessory, so the frame holds it.
    let docked = window.convert(frame, from: window.screen.coordinateSpace)
    let atFoot = docked.height > 0 && docked.minY < window.bounds.maxY && docked.maxY >= window.bounds.maxY - 1
    keyboardTop = atFoot ? docked.minY : nil
    keepCaretClear()
  }

  /// Keeps the caret above the keyboard while the field is typed in, as Notes keeps it: the field insets its words for the part of it the keyboard covers, measured again on each edit and each move of the caret since the page around it may have moved; scrolls its words to the caret; and where the keyboard covers the caret all the same, as when the field stands low on a page, scrolls the page that holds it until the caret's line stands clear.
  private func keepCaretClear() {
    guard let window else { return }
    let mine = convert(bounds, to: window)
    // Note that a field grown to its words scrolls none of its own, so the page that holds it scrolls the caret clear instead.
    let covered = fitsWords ? 0 : keyboardTop.map { max(0, min(mine.height, mine.maxY - $0)) } ?? 0
    textView.contentInset.bottom = covered
    textView.verticalScrollIndicatorInsets.bottom = covered
    guard textView.isFirstResponder, let keyboardTop, let end = textView.selectedTextRange?.end else { return }
    textView.scrollRangeToVisible(textView.selectedRange)
    let caret = textView.convert(textView.caretRect(for: end), to: window)
    let clear = keyboardTop - DocumentSpace.caretClearance
    guard caret.maxY > clear, let page = holdingScrollView() else { return }
    let lowest = max(0, page.contentSize.height + page.adjustedContentInset.bottom - page.bounds.height)
    let offset = min(page.contentOffset.y + caret.maxY - clear, lowest)
    page.setContentOffset(CGPoint(x: page.contentOffset.x, y: offset), animated: true)
  }

  /// Tells JavaScript the height the words ask for at the field's width, while the field grows to them, once it moves by a point or more.
  private func tellHeight() {
    guard fitsWords, bounds.width > 0 else { return }
    let height = wordsHeight()
    if let toldHeight, abs(toldHeight - height) < 1 { return }
    toldHeight = height
    onHeight(["height": height])
  }

  /// The height the words ask for, read from the layout the text view already holds rather than laid out whole again: only the caret's paragraph, which a key changes, is laid out anew, and the rest stands as laid, so a key that wraps no line costs no measure of the words around it. Note that `sizeThatFits` laid out every word on each key, about a millisecond for every thousand characters.
  private func wordsHeight() -> CGFloat {
    let insets = textView.textContainerInset.top + textView.textContainerInset.bottom
    guard let layout = textView.textLayoutManager, let content = layout.textContentManager else {
      return ceil(textView.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
    }

    let string = textView.textStorage.string as NSString
    let caret = min(textView.selectedRange.location, string.length)
    let paragraph = string.paragraphRange(for: NSRange(location: caret, length: 0))

    if let start = content.location(content.documentRange.location, offsetBy: paragraph.location),
      let end = content.location(start, offsetBy: paragraph.length),
      let range = NSTextRange(location: start, end: end) {
      layout.ensureLayout(for: range)
    }

    return ceil(layout.usageBoundsForTextContainer.height + insets)
  }

  /// The nearest scroll view the field stands in, the page it scrolls with.
  private func holdingScrollView() -> UIScrollView? {
    var view = superview
    while let current = view {
      if let scroll = current as? UIScrollView { return scroll }
      view = current.superview
    }
    return nil
  }


  // MARK: Doors JavaScript opens

  /// Takes the lines JavaScript hands, once it has heard every change typed: where they draw as the lines held, only their blocks' keys and sources are laid again, leaving the caret and undo alone; else the lines are drawn anew.
  func take(_ lines: [DocumentLine], seen: Int) {
    guard seen >= changes else { return }
    let held = heldLines()

    if held.count == lines.count, zip(held, lines).allSatisfy({ $0.drawsAs($1) }) {
      relayFacts(lines)
      return
    }

    if textView.markedTextRange != nil {
      quiet = true
      textView.unmarkText()
      quiet = false
    }

    redraw(lines)
  }

  func focus() {
    guard window != nil else {
      focusWhenShown = { [weak self] in self?.focus() }
      return
    }

    textView.becomeFirstResponder()
    revealCaret()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return }
    // Note that a height told before the field stood in a window may not have reached the page, so it is told again.
    toldHeight = nil
    setNeedsLayout()
    guard let focus = focusWhenShown else { return }
    focusWhenShown = nil
    DispatchQueue.main.async(execute: focus)
  }

  /// Scrolls the page that holds a field grown to its words until the caret's line stands in sight, as a field that scrolls itself keeps its caret in sight.
  private func revealCaret() {
    guard fitsWords else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self, let page = self.holdingScrollView(), let end = self.textView.selectedTextRange?.end else { return }
      let caret = self.textView.convert(self.textView.caretRect(for: end), to: page)
      page.scrollRectToVisible(caret.insetBy(dx: 0, dy: -DocumentSpace.caretReveal), animated: true)
    }
  }

  /// Takes the keyboard with the caret where a press on the words as read landed: on the line at `index`, `x` and `y` points in from its first line's start, as near as the words drawn here allow, else at the line's start.
  func focus(atLine index: Int, x: CGFloat, y: CGFloat) {
    guard window != nil else {
      focusWhenShown = { [weak self] in self?.focus(atLine: index, x: x, y: y) }
      return
    }

    layoutIfNeeded()
    let string = textView.textStorage.string as NSString
    var location = 0

    for _ in 0..<max(0, index) where location < string.length {
      location = NSMaxRange(string.paragraphRange(for: NSRange(location: location, length: 0)))
    }

    guard let start = textView.position(from: textView.beginningOfDocument, offset: min(location, string.length)) else {
      textView.becomeFirstResponder()
      return
    }

    let top = textView.caretRect(for: start).minY
    let point = CGPoint(x: textView.textContainerInset.left + x, y: top + y)
    let landed = textView.closestPosition(to: point) ?? start
    textView.becomeFirstResponder()
    textView.selectedRange = NSRange(location: textView.offset(from: textView.beginningOfDocument, to: landed), length: 0)
    revealCaret()
  }

  func blur() {
    textView.resignFirstResponder()
  }

  // MARK: The text view's delegate

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    // Note that a Return on a nested item with no words, and a Delete at a nested item's start, move it out a step rather than end the list or join it to the item before, as Notes and Notion do.
    if let line = caretNestedLine() {
      let returned = text == "\n" && range.length == 0 && line.empty
      let deleted = text.isEmpty && range.length == 1 && line.atStart
      if returned || deleted {
        shiftLines(by: -1)
        return false
      }
    }

    typed = NSRange(location: range.location, length: (text as NSString).length)
    return true
  }

  func textViewDidChange(_ textView: UITextView) {
    guard !quiet else { return }
    let edit = landed ?? typed
    // Note that the words the text itself saw laid in are the ones carried on to, the range asked about being the field's guess before the keyboard lays them.
    if let piece = landed ?? typed {
      carryOn(to: piece)
      boxNewTask(after: piece)
    }
    typed = nil
    landed = nil
    takePendingLine()
    keepPendingLine()
    keepItemDrawn()
    refreshMarks(around: edit ?? textView.selectedRange)
    linkRange = nil
    linkWords = nil
    changes += 1
    placeholderLabel.isHidden = textView.textStorage.length > 0
    tell()
    keepCaretClear()
    tellCaret()
    // Note that a field grown to its words tells its new height as a key wraps a line or takes one away.
    tellHeight()
    // Note that the bar is marked again once the typed words hold their looks, which they take only now.
    updateBar()
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onFocusChange(["focused": true])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    onFocusChange(["focused": false])
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    // Note that a caret moved anywhere but where the words typed next go lets go of the looks a mark set for them; an edit under way moves it there itself.
    if typed == nil, let typingMarks, textView.selectedRange != NSRange(location: typingMarks.at, length: 0) {
      self.typingMarks = nil
    }

    // Note that a block chosen for the empty last line stays with the line while the caret is elsewhere, and its look comes back with the caret.
    if typed == nil, let pendingLine, textView.selectedRange == NSRange(location: pendingLine.at, length: 0) {
      textView.typingAttributes = pendingAttributes(pendingLine.facts)
    } else {
      forgetTypedFacts()
    }

    updateBar()
    keepCaretClear()
    guard !quiet else { return }
    tellCaret()
  }

  /// The system's edit menu with the field's Format menu after its own acts, as Notes offers one.
  func textView(
    _ textView: UITextView,
    editMenuForTextIn range: NSRange,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    guard editable, let menu = formatMenu() else { return nil }
    return UIMenu(children: suggestedActions + [menu])
  }

  // MARK: Drawing

  /// Draws the lines anew, keeping the caret where it stood, as near as the new words allow. Words laid in whole leave nothing for undo's earlier steps to stand on, so they are let go, but where the words are the same as before, as a block's change of kind leaves them, which keeps its own undo.
  private func redraw(_ lines: [DocumentLine], keepUndo: Bool = false) {
    let selected = textView.selectedRange
    quiet = true
    pendingLine = nil
    // Note that a link asked for is let go once the words are drawn anew, since the words it was asked for may stand elsewhere now.
    linkRange = nil
    linkWords = nil
    let next = drawn(lines)
    let storage = textView.textStorage

    // Note that where the words stay as they stand, as a block's change or an item's move leaves them, only their looks are laid on again, since words laid in whole leave the keyboard's correction holding a range of the words it replaced, which it reads on the next key.
    let inPlace = keepUndo && next.string == storage.string

    if inPlace {
      storage.beginEditing()
      next.enumerateAttributes(in: NSRange(location: 0, length: next.length)) { attributes, range, _ in
        storage.setAttributes(attributes, range: range)
      }
      storage.endEditing()
      if let layout = textView.textLayoutManager { layout.invalidateLayout(for: layout.documentRange) }
    } else {
      textView.attributedText = next
    }

    if !keepUndo { textView.undoManager?.removeAllActions() }
    let length = textView.textStorage.length
    // Note that a field drawn empty types a plain paragraph, rather than in the looks of the words it last held, which UIKit would keep for the next words typed.
    if length == 0 { textView.typingAttributes = wordAttributes(.paragraph, nil, [], nil) }
    var location = min(selected.location, length)
    // Note that a caret standing before a task's box goes after it, so the words typed next are the task's.
    if selected.length == 0, location < length,
      textView.textStorage.attribute(.attachment, at: location, effectiveRange: nil) is TaskBoxAttachment {
      location = min(location + 2, length)
    }
    textView.selectedRange = NSRange(location: location, length: min(selected.length, length - location))
    // Note that looks laid on in place leave UIKit typing in the looks the caret's words had before, a moved item's old depth among them, so the next words would draw at it; the caret's own looks are handed it again, its line's facts left out, as ever.
    if inPlace, let typing = lineLooks(at: location) { textView.typingAttributes = typing }
    forgetTypedFacts()
    quiet = false
    placeholderLabel.isHidden = length > 0
    setNeedsLayout()
  }

  /// Lays each handed line's facts on the line held in its place, which only renames blocks and where they came from.
  private func relayFacts(_ lines: [DocumentLine]) {
    let storage = textView.textStorage
    let string = storage.string as NSString
    var location = 0
    quiet = true
    storage.beginEditing()

    for line in lines {
      let paragraph = string.paragraphRange(for: NSRange(location: min(location, string.length), length: 0))
      if paragraph.length > 0 { storage.addAttribute(lineKey, value: line.facts, range: paragraph) }
      location = NSMaxRange(paragraph)
      if location >= string.length { break }
    }

    storage.endEditing()
    quiet = false
    forgetTypedFacts()
  }

  /// The looks the words typed at `location` take: those of the word before it on its line, else of the line's first character, as UIKit reads them, an attachment's own and the line's facts left out; none on the empty last line, whose typing the line it carries on or a block chosen for it gives.
  private func lineLooks(at location: Int) -> [NSAttributedString.Key: Any]? {
    let storage = textView.textStorage
    let string = storage.string as NSString
    guard location <= storage.length else { return nil }
    let lineStart = location == 0 || string.character(at: location - 1) == 0x0A
    let at = lineStart ? location : location - 1
    guard at < storage.length else { return nil }
    var looks = storage.attributes(at: at, effectiveRange: nil)
    looks[.attachment] = nil
    looks[lineKey] = nil
    return looks
  }

  /// Lets go of the line facts UIKit types with, which it copies from the words at the caret and keeps as they stood, though JavaScript renames each line's block on each answer and a move lays new facts on in place; words typed with none take their line's own (`heldLine` reads a line by the facts its words hold, else the line before). A block chosen for the empty last line keeps its facts, which are the ones its words take.
  private func forgetTypedFacts() {
    if let pendingLine, textView.selectedRange == NSRange(location: pendingLine.at, length: 0) { return }
    textView.typingAttributes[lineKey] = nil
  }

  /// The lines drawn: each a paragraph in its block's look, a task led by its box, a rule and a card as one character across the line, and a line break after every line but the last.
  private func drawn(_ lines: [DocumentLine]) -> NSAttributedString {
    let built = NSMutableAttributedString()
    // Note that a list's items share one list at each depth, so its markers count on from one item to the next rather than each starting again, and a run of items nested under one stands in a list of its own inside its parent's, counting from one.
    var nesting: ListNesting?

    for (index, line) in lines.enumerated() {
      let piece = NSMutableAttributedString()
      let kind = line.facts.itemKind

      if kind == .taskList {
        let box = TaskBoxAttachment(checked: line.facts.checked == true, look: look)
        piece.append(NSAttributedString(attachment: box))
        piece.append(NSAttributedString(string: " "))
      }

      if kind == .rule {
        piece.append(NSAttributedString(attachment: BlockAttachment(card: nil, look: look)))
      }

      for run in line.runs {
        switch run {
        case .words(let text, let marks, let link):
          piece.append(NSAttributedString(string: text, attributes: wordAttributes(kind, line.facts.level, marks, link)))
        case .pill(let pill):
          let character = NSMutableAttributedString(
            attributedString: NSAttributedString(attachment: PillAttachment(pill: pill, look: look))
          )
          character.addAttributes(wordAttributes(kind, line.facts.level, [], nil), range: NSRange(location: 0, length: 1))
          piece.append(character)
        case .card(let card):
          piece.append(NSAttributedString(attachment: BlockAttachment(card: card, look: look)))
        }
      }

      if index < lines.count - 1 { piece.append(NSAttributedString(string: "\n")) }

      let whole = NSRange(location: 0, length: piece.length)
      if whole.length == 0 { continue }
      piece.addAttribute(lineKey, value: line.facts, range: whole)
      piece.addAttribute(.paragraphStyle, value: paragraphStyle(line.facts), range: whole)
      if let mark = itemMark(line.facts, in: &nesting) {
        piece.addAttribute(itemMarkKey, value: ItemMarkValue(mark, color: look.placeholder), range: whole)
      }
      piece.enumerateAttribute(.font, in: whole) { value, range, _ in
        if value == nil { piece.addAttributes(wordAttributes(kind, line.facts.level, [], nil), range: range) }
      }
      built.append(piece)
    }

    return built
  }

  /// A run's words' attributes: its face by its block and looks, its color, and its looks and address kept for telling back.
  private func wordAttributes(
    _ kind: DocumentKind,
    _ level: Int?,
    _ marks: [String],
    _ link: String?
  ) -> [NSAttributedString.Key: Any] {
    let looks = Set(marks.compactMap(MarkStyle.init))
    var attributes: [NSAttributedString.Key: Any] = [
      .font: runFont(kind, level, looks),
      .foregroundColor: kind == .quote ? look.placeholder : look.text,
      markStylesKey: marks,
    ]

    if looks.contains(.strike) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if looks.contains(.code) || kind == .code { attributes[.backgroundColor] = look.pillFill }
    if let link {
      attributes[linkKey] = link
      attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
    }

    return attributes
  }

  /// A run's face: a heading's text style, bold and italic as its looks ask, code in the monospaced face, each at the reader's text size.
  private func runFont(_ kind: DocumentKind, _ level: Int?, _ looks: Set<MarkStyle>) -> UIFont {
    let heading = kind == .heading ? level ?? 1 : nil
    let base: UIFont =
      heading == 1 ? .preferredFont(forTextStyle: .title2)
      : heading == 2 ? .preferredFont(forTextStyle: .title3)
      : heading != nil ? .preferredFont(forTextStyle: .headline)
      : bodyFont()
    let bold = looks.contains(.strong) || heading == 1 || heading == 2

    if looks.contains(.code) || kind == .code {
      return .monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: bold ? .semibold : .regular)
    }

    var traits = base.fontDescriptor.symbolicTraits
    if bold { traits.insert(.traitBold) }
    if looks.contains(.emphasis) { traits.insert(.traitItalic) }

    return base.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: 0) } ?? base
  }

  /// The mark a list's item draws in its gutter, each depth's run of items counting on: the item's own run goes on where the item before it at its depth stood in the same kind of list, and starts anew otherwise, as the Markdown it prints numbers it, a task standing between two numbered items at their depth starting the second's count again; a task, whose box marks it, draws none.
  private func itemMark(_ facts: LineFacts, in nesting: inout ListNesting?) -> ItemMark? {
    guard facts.isListItem else {
      nesting = nil
      return nil
    }

    let same = nesting?.block == facts.block
    var runs = same ? nesting?.runs ?? [] : []
    let depth = min(facts.nesting, runs.count)
    let kind = facts.itemKind

    if depth < runs.count, runs[depth].kind == kind {
      runs.removeSubrange((depth + 1)...)
    } else {
      runs.removeSubrange(depth...)
      runs.append(ListRun(kind: kind, start: depth == 0 ? facts.start ?? 1 : 1, items: 0))
    }

    runs[depth].items += 1
    nesting = ListNesting(block: facts.block, runs: runs)

    switch kind {
    case .bulletList: return .bullet(depth: depth)
    case .orderedList: return .number(runs[depth].start + runs[depth].items - 1)
    default: return nil
    }
  }

  /// A line's paragraph: its indent, a gutter further in for each depth it is nested and the gutter its mark stands in, its words hanging there however many lines they wrap to, a quote's indent, and the room between blocks, as the read view and the desktop set a list. A task nested under an item stands its box under the item's words.
  private func paragraphStyle(_ facts: LineFacts) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.paragraphSpacing = DocumentSpace.blockGap
    let gutter = listIndent()
    let nested = gutter * CGFloat(facts.nesting)
    let itemGap = bodyFont().pointSize * DocumentSpace.itemGapShare

    switch facts.itemKind {
    case .bulletList, .orderedList:
      style.headIndent = nested + gutter
      style.firstLineHeadIndent = nested + gutter
      style.paragraphSpacing = itemGap
    case .taskList:
      style.headIndent = nested
      style.firstLineHeadIndent = nested
      style.paragraphSpacing = itemGap
    case .quote:
      style.headIndent = DocumentSpace.quoteIndent
      style.firstLineHeadIndent = DocumentSpace.quoteIndent
    case .code:
      style.paragraphSpacing = 0
    case .heading, .paragraph, .rule, .locked:
      break
    }

    return style
  }

  /// Lays the block and looks the words around a typed piece carry on the piece, since UIKit types with no attribute of the field's own: its block from the next character, which stands in its paragraph (a word, or the line break that ends it), else the one before; its looks and address from the character before where it stands in the same paragraph, as typing after bold words types bold. A piece that ends in a line break ends its paragraph there: where the break is the line's own, already holding its block, as the range the text saw laid in may run on through it, the piece keeps that block, never the next paragraph's, which would draw the line into the block after it; where it is a new break, as a Return types, it takes the block of the paragraph it splits, from the character after it where it splits a paragraph at its start, and from the one before it elsewhere.
  private func carryOn(to piece: NSRange) {
    let storage = textView.textStorage
    let string = storage.string as NSString
    guard piece.length > 0, NSMaxRange(piece) <= storage.length else { return }
    let last = NSMaxRange(piece) - 1
    let endsLine = string.character(at: last) == 0x0A
    let startsLine = piece.location == 0 || string.character(at: piece.location - 1) == 0x0A
    let ownBreak = endsLine ? storage.attribute(lineKey, at: last, effectiveRange: nil) as? LineFacts : nil
    let after = (!endsLine || startsLine) && NSMaxRange(piece) < storage.length ? NSMaxRange(piece) : nil
    let before = piece.location > 0 ? piece.location - 1 : nil
    let blockFrom = after ?? before
    let looksFrom = before.flatMap { string.character(at: $0) == 0x0A ? nil : $0 } ?? after

    quiet = true
    storage.beginEditing()

    if let facts = ownBreak ?? blockFrom.flatMap({ storage.attribute(lineKey, at: $0, effectiveRange: nil) }) {
      storage.addAttribute(lineKey, value: facts, range: piece)
    }

    storage.removeAttribute(markStylesKey, range: piece)
    storage.removeAttribute(linkKey, range: piece)

    if let looksFrom {
      if let marks = storage.attribute(markStylesKey, at: looksFrom, effectiveRange: nil) {
        storage.addAttribute(markStylesKey, value: marks, range: piece)
      }

      if let link = storage.attribute(linkKey, at: looksFrom, effectiveRange: nil) {
        storage.addAttribute(linkKey, value: link, range: piece)
      }
    }

    // Note that words typed on an empty last line turned into a block take its facts, which nothing held until now.
    if let pendingLine, pendingLine.at == piece.location {
      let line = NSRange(location: piece.location, length: storage.length - piece.location)
      storage.addAttribute(lineKey, value: pendingLine.facts, range: line)
      storage.addAttribute(.paragraphStyle, value: paragraphStyle(pendingLine.facts), range: line)
      self.pendingLine = nil
      restyleWords(in: line)
    }

    // Note that a mark toggled with nothing selected gives the words typed next its looks, and goes on with the words typed after them.
    if let typingMarks, typingMarks.at == piece.location {
      storage.removeAttribute(markStylesKey, range: piece)
      if !typingMarks.marks.isEmpty { storage.addAttribute(markStylesKey, value: typingMarks.marks, range: piece) }
      restyleWords(in: piece)
      self.typingMarks = (NSMaxRange(piece), typingMarks.marks)
    }

    storage.endEditing()
    quiet = false
  }

  /// Lays the block chosen for the empty last line on the words now typed there, where the typing did not take it, as a key the field refused leaves UIKit typing in the looks it had before; the line is then drawn as the block it is.
  private func takePendingLine() {
    guard let pendingLine else { return }
    let storage = textView.textStorage
    let string = storage.string as NSString
    guard pendingLine.at < string.length else { return }
    let line = string.paragraphRange(for: NSRange(location: pendingLine.at, length: 0))
    guard line.location == pendingLine.at, line.length > 0,
      storage.attribute(lineKey, at: line.location, effectiveRange: nil) as? LineFacts !== pendingLine.facts
    else { return }
    quiet = true
    storage.addAttribute(lineKey, value: pendingLine.facts, range: line)
    quiet = false
    self.pendingLine = nil
    let selected = textView.selectedRange
    redraw(heldLines(), keepUndo: true)
    textView.selectedRange = selected
  }

  /// Draws the caret's line as the list item it is read as (`heldLine` carries the line before on) where UIKit typed it plain, as on the line a Return opens at a list's end: an empty line's words typed next take the item's paragraph and facts, and a line already typed plain is drawn again, keeping its undo, since its words are unchanged.
  private func keepItemDrawn() {
    let storage = textView.textStorage
    let string = storage.string as NSString
    let caret = min(textView.selectedRange.location, string.length)
    let paragraph = caretLine(caret)
    guard textView.selectedRange.length == 0, paragraph.location > 0 else { return }
    let before = string.paragraphRange(for: NSRange(location: paragraph.location - 1, length: 0))
    guard let facts = heldFacts(before),
      facts.isListItem, facts.itemKind != .taskList,
      let style = storage.attribute(.paragraphStyle, at: before.location, effectiveRange: nil) as? NSParagraphStyle,
      let mark = storage.attribute(itemMarkKey, at: before.location, effectiveRange: nil) as? ItemMarkValue
    else { return }
    let ends = NSMaxRange(paragraph) > paragraph.location && string.character(at: NSMaxRange(paragraph) - 1) == 0x0A
    let words = paragraph.length - (ends ? 1 : 0)

    if words == 0 {
      textView.typingAttributes[.paragraphStyle] = style
      // Note that the words typed next carry the next item's mark until the line is drawn again, which numbers it among its list.
      textView.typingAttributes[itemMarkKey] = ItemMarkValue(mark.mark.next, color: mark.color)
      return
    }

    let own = heldFacts(paragraph)
    let drawn = storage.attribute(itemMarkKey, at: paragraph.location, effectiveRange: nil)
    guard own == nil || own?.block == facts.block, drawn == nil else { return }
    let selected = textView.selectedRange
    redraw(heldLines(), keepUndo: true)
    textView.selectedRange = selected
  }

  /// Leads a task line a Return opened with its own unchecked box, the caret after it, as a checklist's Return does in Notes and Notion: the line after a typed line break, where its block is a task list and no box leads it.
  private func boxNewTask(after piece: NSRange) {
    let storage = textView.textStorage
    let string = storage.string as NSString
    let start = NSMaxRange(piece)
    guard piece.length > 0, start <= storage.length, string.character(at: start - 1) == 0x0A else { return }
    let factsAt = start < storage.length ? start : start - 1
    guard let facts = storage.attribute(lineKey, at: factsAt, effectiveRange: nil) as? LineFacts,
      facts.itemKind == .taskList
    else { return }
    if start < storage.length, storage.attribute(.attachment, at: start, effectiveRange: nil) is TaskBoxAttachment {
      return
    }

    let unchecked = facts.with(checked: false)
    var attributes = wordAttributes(.taskList, facts.level, [], nil)
    attributes[lineKey] = unchecked
    attributes[.paragraphStyle] = storage.attribute(.paragraphStyle, at: factsAt, effectiveRange: nil)
    let box = NSMutableAttributedString(attachment: TaskBoxAttachment(checked: false, look: look))
    box.append(NSAttributedString(string: " "))
    box.addAttributes(attributes, range: NSRange(location: 0, length: box.length))

    quiet = true
    storage.insert(box, at: start)
    textView.selectedRange = NSRange(location: start + box.length, length: 0)
    quiet = false
  }

  // MARK: Formatting

  /// A glyph by its name in the app's asset catalog, at the body's size, as the bar's buttons and the menus draw it.
  private func glyphImage(_ name: String) -> UIImage? {
    guard !name.isEmpty else { return nil }
    let configuration = UIImage.SymbolConfiguration(font: bodyFont(), scale: .medium)
    return UIImage(named: name, in: nil, with: configuration) ?? UIImage(systemName: name, withConfiguration: configuration)
  }

  /// The acts the field offers, in the order the menus and the bar stand them: the marks, a link, then each block.
  private func offeredActs() -> [FormatActRecord] {
    guard let formats else { return [] }
    return formats.marks + [formats.link].compactMap { $0 } + formats.blocks
  }

  /// An act as the menus offer it: its words and glyph, checked where the selection already stands that way.
  private func menuAction(_ record: FormatActRecord) -> UIAction {
    let action = UIAction(title: record.title, image: glyphImage(record.glyph)) { [weak self] _ in
      self?.perform(record.act)
    }
    action.state = isOn(record.act) ? .on : .off
    return action
  }

  /// The Format menu: the marks and the link side by side, then the blocks a line is turned into under their own menu, as the desktop's toolbar and Turn into stand.
  private func formatMenu() -> UIMenu? {
    guard let formats, !offeredActs().isEmpty else { return nil }
    let marks = UIMenu(options: .displayInline, children: (formats.marks + [formats.link].compactMap { $0 }).map(menuAction))
    let blocks = UIMenu(title: formats.blocksTitle, image: glyphImage(formats.blocksGlyph), children: formats.blocks.map(menuAction))
    return UIMenu(title: formats.title, children: [marks, blocks])
  }

  /// The marks that step off the bar into Turn into's menu while a list item's two moves stand there: the last two, so the bar holds no more buttons than a phone fits.
  private func marksAside() -> [FormatActRecord] {
    guard let formats, moveItems != nil else { return [] }
    return Array(formats.marks.suffix(2))
  }

  /// Stands the bar over the keyboard: a button for each mark, the link and the `@`, and the blocks behind one button's menu, each heard by its words. While the caret is in a list item, Outdent and Indent stand in the last marks' place, as Notion's bar offers them there, and those marks lead Turn into's menu.
  private func buildBar() {
    guard let formats, !offeredActs().isEmpty else {
      bar = nil
      barItems = []
      moveItems = nil
      textView.inputAccessoryView = nil
      textView.reloadInputViews()
      return
    }

    let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: bounds.width, height: 44))
    toolbar.autoresizingMask = .flexibleWidth
    toolbar.tintColor = look.text
    barItems = []

    for record in formats.marks + [formats.link, formats.mention].compactMap({ $0 }) {
      barItems.append((record.act, barButton(record)))
    }

    if let outdent = formats.outdent, let indent = formats.indent {
      moveItems = (barButton(outdent), barButton(indent))
    } else {
      moveItems = nil
    }

    bar = toolbar
    layBar(inList: caretInList())
    textView.inputAccessoryView = toolbar
    textView.reloadInputViews()
    updateBar()
  }

  /// One of the bar's buttons: the act's glyph, heard by its words.
  private func barButton(_ record: FormatActRecord) -> UIBarButtonItem {
    let item = UIBarButtonItem(
      image: glyphImage(record.glyph),
      primaryAction: UIAction { [weak self] _ in self?.perform(record.act) }
    )
    item.accessibilityLabel = record.title
    return item
  }

  /// Stands the mark of an empty last list item where its line stands, while the caret is on it, since the line holds no words a layout fragment could draw it beside; hidden elsewhere.
  private func placeEndMark() {
    guard let facts = emptyLastLineFacts(), facts.isListItem, let mark = lastLineMark(facts) else {
      endMark.isHidden = true
      return
    }

    let font = bodyFont()
    let caret = textView.caretRect(for: textView.endOfDocument)
    let textStart = textView.textContainerInset.left + paragraphStyle(facts).firstLineHeadIndent
    endMark.mark = mark
    endMark.font = font
    endMark.color = look.placeholder
    // Note that the caret stands as tall as its line, the words' baseline the face's ascent below its top.
    endMark.frame = CGRect(x: 0, y: caret.minY, width: textStart, height: max(caret.height, font.lineHeight))
    endMark.baseline = font.ascender
    endMark.isHidden = false
    endMark.setNeedsDisplay()
  }

  /// Whether the caret stands in a list item, where the bar offers Outdent and Indent.
  private func caretInList() -> Bool {
    moveItems != nil && caretParagraph()?.facts.isListItem == true
  }

  /// Lays the bar's buttons out: in a list item, the marks aside give their place to Outdent and Indent.
  private func layBar(inList: Bool) {
    guard let bar, let formats else { return }
    barInList = inList
    let aside: Set<String> = inList ? Set(marksAside().map(\.act)) : []
    var items = barItems.filter { !aside.contains($0.act) }.map(\.item)
    if inList, let moveItems { items += [moveItems.outdent, moveItems.indent] }

    let blocks = UIBarButtonItem(title: nil, image: glyphImage(formats.blocksGlyph), primaryAction: nil, menu: nil)
    blocks.accessibilityLabel = formats.blocksTitle
    // Note that the blocks stand in Turn into's own order wherever the menu opens, rather than turned over to start nearest the button.
    blocks.preferredMenuElementOrder = .fixed
    // Note that the blocks' menu is built as it opens, so its check stands on the block the caret is in now, led by the marks that stepped aside for Outdent and Indent while the caret is in a list item.
    blocks.menu = UIMenu(children: [
      UIDeferredMenuElement.uncached { [weak self] answer in
        guard let self, let formats = self.formats else { return answer([]) }
        let aside: [UIAction] = self.barInList ? self.marksAside().map(self.menuAction) : []
        let blocks = formats.blocks.map(self.menuAction)
        answer(aside.isEmpty ? blocks : [UIMenu(options: .displayInline, children: aside)] + blocks)
      },
    ])
    bar.setItems(items + [.flexibleSpace(), blocks], animated: false)
    bar.sizeToFit()
  }

  /// Marks each of the bar's buttons on where the selection already stands that way, as Notes marks Bold, stands Outdent and Indent where the caret is in a list item, and dims each move its item cannot make.
  private func updateBar() {
    placeEndMark()
    let inList = caretInList()
    if bar != nil, inList != barInList { layBar(inList: inList) }
    for (act, item) in barItems {
      item.isSelected = isOn(act)
    }
    guard inList, let moveItems else { return }
    let shifts = shiftable()
    moveItems.outdent.isEnabled = shifts.shallower
    moveItems.indent.isEnabled = shifts.deeper
  }

  /// Whether the selection already stands as an act makes it: every word selected in the mark, or with nothing selected, the words typed next; the line in the block; the words in a link.
  private func isOn(_ act: String) -> Bool {
    guard let format = DocumentFormat(act) else { return false }
    let selected = textView.selectedRange

    switch format {
    case .mark(let mark):
      if selected.length == 0 { return caretMarks().contains(mark) }
      return wordsAll(in: selected) { ($0[markStylesKey] as? [String] ?? []).contains(mark) }
    case .link:
      return selected.length > 0 && wordsAll(in: selected) { $0[linkKey] != nil }
    case .mention, .indent, .outdent:
      return false
    case .block(let kind, let level):
      if let facts = emptyLastLineFacts() { return facts.drawnKind == kind && facts.level == level }
      // Note that only the lines a block change turns count, as `turnLines` counts them, so a card in the selection leaves the check standing.
      let lines = touchedLines().filter { turnable.contains($0.facts.drawnKind) }
      return !lines.isEmpty && lines.allSatisfy { $0.facts.drawnKind == kind && $0.facts.level == level }
    }
  }

  /// The looks the words typed at the caret take: those a mark toggled there set, else the looks of the words before it on its line.
  private func caretMarks() -> [String] {
    let caret = textView.selectedRange.location
    if let typingMarks, typingMarks.at == caret { return typingMarks.marks }
    let string = textView.textStorage.string as NSString
    guard caret > 0, caret <= string.length, string.character(at: caret - 1) != 0x0A else { return [] }
    return textView.textStorage.attribute(markStylesKey, at: caret - 1, effectiveRange: nil) as? [String] ?? []
  }

  /// Whether every character of words in the range, past attachments and line breaks, holds as `test` asks; a range holding none does not.
  private func wordsAll(in range: NSRange, _ test: ([NSAttributedString.Key: Any]) -> Bool) -> Bool {
    let storage = textView.textStorage
    let string = storage.string as NSString
    var any = false
    var all = true

    storage.enumerateAttributes(in: range) { attributes, piece, stop in
      guard attributes[.attachment] == nil,
        !string.substring(with: piece).trimmingCharacters(in: .newlines).isEmpty
      else { return }
      any = true
      if !test(attributes) {
        all = false
        stop.pointee = true
      }
    }

    return any && all
  }

  /// Does an act on the selection, as the edit menu, the bar, and a key command ask.
  private func perform(_ act: String) {
    guard editable, let format = DocumentFormat(act) else { return }

    switch format {
    case .mark(let mark): toggleMark(mark)
    case .link: askLink()
    case .mention: textView.insertText("@")
    case .indent: shiftLines(by: 1)
    case .outdent: shiftLines(by: -1)
    case .block(let kind, let level): turnLines(into: kind, level: level)
    }
  }

  /// Toggles a mark on the selected words, on where any lacks it and off where all hold it, or with nothing selected on the words typed next.
  private func toggleMark(_ mark: String) {
    let storage = textView.textStorage
    let selected = textView.selectedRange

    if selected.length == 0 {
      var marks = caretMarks().filter { $0 != mark }
      if !isOn(mark) { marks.append(mark) }
      typingMarks = (selected.location, marks)
      updateBar()
      return
    }

    let on = !isOn(mark)
    quiet = true
    storage.beginEditing()
    storage.enumerateAttribute(markStylesKey, in: selected) { value, piece, _ in
      var marks = (value as? [String] ?? []).filter { $0 != mark }
      if on { marks.append(mark) }
      storage.addAttribute(markStylesKey, value: marks, range: piece)
    }
    restyleWords(in: selected)
    storage.endEditing()
    quiet = false
    edited()
  }

  /// Draws the words in the range in their lines' faces and their looks again, after their looks changed; attachments keep theirs.
  private func restyleWords(in range: NSRange) {
    let storage = textView.textStorage
    guard NSMaxRange(range) <= storage.length else { return }

    storage.enumerateAttributes(in: range) { attributes, piece, _ in
      guard attributes[.attachment] == nil else { return }
      let facts = attributes[lineKey] as? LineFacts
      let marks = attributes[markStylesKey] as? [String] ?? []
      let link = attributes[linkKey] as? String
      storage.removeAttribute(.strikethroughStyle, range: piece)
      storage.removeAttribute(.underlineStyle, range: piece)
      storage.removeAttribute(.backgroundColor, range: piece)
      storage.removeAttribute(linkKey, range: piece)
      storage.addAttributes(wordAttributes(facts?.drawnKind ?? .paragraph, facts?.level, marks, link), range: piece)
    }
  }

  /// The paragraphs the view holds, as `heldLines` reads them, an empty last line after a line break among them.
  private func paragraphRanges() -> [NSRange] {
    let string = textView.textStorage.string as NSString
    var ranges: [NSRange] = []
    var location = 0

    while location < string.length {
      let paragraph = string.paragraphRange(for: NSRange(location: location, length: 0))
      ranges.append(paragraph)
      location = NSMaxRange(paragraph)
    }

    if string.length > 0, string.character(at: string.length - 1) == 0x0A {
      ranges.append(NSRange(location: string.length, length: 0))
    }

    return ranges
  }

  /// The indexes of the lines the selection stands in, the caret's one where nothing is selected.
  private func touchedIndexes() -> [Int] {
    let string = textView.textStorage.string as NSString
    let selected = textView.selectedRange
    let start = min(selected.location, string.length)
    let touched = string.paragraphRange(for: NSRange(location: start, length: min(selected.length, string.length - start)))
    let ranges = paragraphRanges()

    // Note that the empty line after a last line break holds no character, so it is touched only by the caret standing in it.
    return ranges.indices.filter { index in
      let paragraph = ranges[index]
      return NSIntersectionRange(paragraph, touched).length > 0
        || (paragraph.length == 0 && paragraph.location == start)
    }
  }

  /// The lines the selection stands in, as the view holds them.
  private func touchedLines() -> [DocumentLine] {
    let lines = heldLines()
    return touchedIndexes().compactMap { $0 < lines.count ? lines[$0] : nil }
  }

  /// Whether the caret stands on an empty last line, or in an empty field, which no character holds facts for: the facts a block change gave it, else the line's before it, else a paragraph's; none where the caret stands elsewhere.
  private func emptyLastLineFacts() -> LineFacts? {
    let string = textView.textStorage.string as NSString
    let selected = textView.selectedRange
    let atEnd = selected.length == 0 && selected.location == string.length
    guard atEnd, string.length == 0 || string.character(at: string.length - 1) == 0x0A else { return nil }
    if let pendingLine, pendingLine.at == string.length { return pendingLine.facts }
    return heldLines().last?.facts ?? LineFacts(block: -1, kind: DocumentKind.paragraph.rawValue)
  }

  /// Turns an empty last line into a block before anything is typed on it: a task's box is laid at once, which then holds the line's facts; any other block is kept as pending facts the words typed next take, and the caret's look is the block's.
  private func turnEmptyLastLine(into kind: DocumentKind, level: Int?, current: LineFacts) {
    let storage = textView.textStorage
    let at = storage.length
    let off = current.drawnKind == kind && current.level == level
    let target = off ? DocumentKind.paragraph : kind
    let key = (heldLines().map(\.facts.block).max() ?? 0) + 1
    let facts = LineFacts(
      block: key,
      kind: target.rawValue,
      level: target == .heading ? level : nil,
      start: target == .orderedList ? 1 : nil,
      checked: target == .taskList ? false : nil
    )
    let attributes = pendingAttributes(facts)

    guard target == .taskList else {
      pendingLine = (at, facts)
      textView.typingAttributes = attributes
      updateBar()
      return
    }

    let box = NSMutableAttributedString(attachment: TaskBoxAttachment(checked: false, look: look))
    box.append(NSAttributedString(string: " "))
    box.addAttributes(attributes, range: NSRange(location: 0, length: box.length))
    quiet = true
    storage.insert(box, at: at)
    textView.selectedRange = NSRange(location: at + box.length, length: 0)
    quiet = false
    placeholderLabel.isHidden = true
    edited()
  }

  /// The attributes the words typed on an empty last line take from the block chosen for it, its lists those the lines above it leave open.
  private func pendingAttributes(_ facts: LineFacts) -> [NSAttributedString.Key: Any] {
    var attributes = wordAttributes(facts.itemKind, facts.level, [], nil)
    attributes[lineKey] = facts
    attributes[.paragraphStyle] = paragraphStyle(facts)
    if let mark = lastLineMark(facts) { attributes[itemMarkKey] = ItemMarkValue(mark, color: look.placeholder) }
    return attributes
  }

  /// Draws again the marks of the list an edit stands in, each item numbered among its run, since a key, a paste, a Return or a pill laid over an item's words changes the run while the words around keep the marks they were drawn with: every paragraph of the edit's block, from the block's first, its mark laid where it differs and taken off a line that is no item.
  private func refreshMarks(around edit: NSRange) {
    let storage = textView.textStorage
    let string = storage.string as NSString
    guard string.length > 0 else { return }
    let end = min(NSMaxRange(edit), string.length)
    var paragraph = string.paragraphRange(for: NSRange(location: min(edit.location, string.length - 1), length: 0))
    let before = paragraph.location > 0 ? heldFacts(string.paragraphRange(for: NSRange(location: paragraph.location - 1, length: 0))) : nil
    guard let block = (heldFacts(paragraph) ?? before)?.block else { return }

    // Note that the run is counted from its block's first line, which the walk back finds.
    while paragraph.location > 0 {
      let previous = string.paragraphRange(for: NSRange(location: paragraph.location - 1, length: 0))
      guard heldFacts(previous)?.block == block else { break }
      paragraph = previous
    }

    var nesting: ListNesting?
    var carried: LineFacts?
    quiet = true
    storage.beginEditing()

    while paragraph.length > 0 {
      guard let facts = heldFacts(paragraph) ?? carried, facts.block == block || paragraph.location < end else { break }
      carried = facts
      let mark = itemMark(facts, in: &nesting)
      var held = NSRange()
      let drawn = storage.attribute(itemMarkKey, at: paragraph.location, longestEffectiveRange: &held, in: paragraph) as? ItemMarkValue

      if let mark {
        if drawn?.mark != mark || held != paragraph {
          storage.addAttribute(itemMarkKey, value: ItemMarkValue(mark, color: look.placeholder), range: paragraph)
        }
      } else if drawn != nil {
        storage.removeAttribute(itemMarkKey, range: paragraph)
      }

      guard NSMaxRange(paragraph) < string.length else { break }
      paragraph = string.paragraphRange(for: NSRange(location: NSMaxRange(paragraph), length: 0))
    }

    storage.endEditing()
    quiet = false
  }

  /// The mark the last line draws with `facts`, the lines above it counted first, so an item at the words' end takes the number after the item before it.
  private func lastLineMark(_ facts: LineFacts) -> ItemMark? {
    var nesting: ListNesting?
    for line in heldLines().dropLast() { _ = itemMark(line.facts, in: &nesting) }
    return itemMark(facts, in: &nesting)
  }

  /// Keeps the block chosen for the empty last line on that line as edits elsewhere move it, and lets it go once an edit takes the line away.
  private func keepPendingLine() {
    guard let pendingLine else { return }
    let string = textView.textStorage.string as NSString
    let stands = string.length == 0 || string.character(at: string.length - 1) == 0x0A
    self.pendingLine = stands ? (string.length, pendingLine.facts) : nil
  }

  /// Where a point of the words stands as a line and a place in that line's words, a task's box and its space not counted, so a block change that lays or takes away a box keeps the caret on the same words.
  private func linePlace(of location: Int) -> (line: Int, offset: Int) {
    let storage = textView.textStorage
    let ranges = paragraphRanges()
    let index = ranges.lastIndex { $0.location <= location } ?? 0
    guard index < ranges.count else { return (0, location) }
    let start = ranges[index].location
    let boxed = start < storage.length && storage.attribute(.attachment, at: start, effectiveRange: nil) is TaskBoxAttachment
    return (index, max(0, location - start - (boxed ? 2 : 0)))
  }

  /// The point of the words a line and a place in its words stand at, past a task's box.
  private func location(of place: (line: Int, offset: Int)) -> Int {
    let storage = textView.textStorage
    let ranges = paragraphRanges()
    guard place.line < ranges.count else { return storage.length }
    let paragraph = ranges[place.line]
    let boxed = paragraph.location < storage.length
      && storage.attribute(.attachment, at: paragraph.location, effectiveRange: nil) is TaskBoxAttachment
    let start = paragraph.location + (boxed ? 2 : 0)
    let ends = NSMaxRange(paragraph) > paragraph.location && NSMaxRange(paragraph) <= storage.length
      && (storage.string as NSString).character(at: NSMaxRange(paragraph) - 1) == 0x0A
    return min(start + place.offset, NSMaxRange(paragraph) - (ends ? 1 : 0))
  }

  /// Turns the selection's lines into a block, each made in the field, or back into paragraphs where they all stand as it already; a code line, a rule, and a card are left as they stand. The caret stays on the same words, and where the words are unchanged, as all but a to-do list's box leave them, one Undo takes the change back.
  private func turnLines(into kind: DocumentKind, level: Int?) {
    if let current = emptyLastLineFacts() {
      turnEmptyLastLine(into: kind, level: level, current: current)
      return
    }

    let previous = heldLines()
    var lines = previous
    let indexes = touchedIndexes().filter { $0 < lines.count && turnable.contains(lines[$0].facts.drawnKind) }
    guard !indexes.isEmpty else { return }
    let off = indexes.allSatisfy { lines[$0].facts.drawnKind == kind && lines[$0].facts.level == level }
    let target = off ? DocumentKind.paragraph : kind
    var key = (lines.map(\.facts.block).max() ?? 0) + 1

    for index in indexes {
      // Note that a line already a task keeps its box as it stands, and only a line made a task starts unchecked.
      let held = lines[index].facts
      let checked = target == .taskList ? (held.itemKind == .taskList ? held.checked ?? false : false) : nil
      lines[index] = DocumentLine(
        facts: LineFacts(
          block: key,
          kind: target.rawValue,
          level: target == .heading ? level : nil,
          start: target == .orderedList ? 1 : nil,
          checked: checked
        ),
        runs: lines[index].runs
      )
      // Note that a list's lines share one key, so they are one list, while a heading's or a paragraph's each stand alone.
      if [.paragraph, .heading, .quote].contains(target) { key += 1 }
    }

    let boxesMove = indexes.contains { (previous[$0].facts.itemKind == .taskList) != (lines[$0].facts.itemKind == .taskList) }
    relay(lines, from: previous, keepUndo: !boxesMove)
  }

  /// The paragraph the selection starts in, read alone rather than the whole document, as a keystroke asks of it: its line's facts, whether its words are empty, and whether the caret stands at their start, past a task's box; an empty last line holds the facts of the line break before it.
  private func caretParagraph() -> (facts: LineFacts, empty: Bool, atStart: Bool, before: LineFacts?)? {
    let storage = textView.textStorage
    let string = storage.string as NSString
    let caret = min(textView.selectedRange.location, string.length)
    let paragraph = caretLine(caret)
    let lineBefore = paragraph.location > 0 ? string.paragraphRange(for: NSRange(location: paragraph.location - 1, length: 0)).location : nil
    let lineBeforeRange = lineBefore.map { string.paragraphRange(for: NSRange(location: $0, length: 0)) }
    let beforeFacts = lineBeforeRange.flatMap(heldFacts)
    let pending = paragraph.length == 0 ? pendingLine.flatMap { $0.at == caret ? $0.facts : nil } : nil
    guard let facts = pending ?? (paragraph.length > 0 ? heldFacts(paragraph) : nil) ?? beforeFacts else { return nil }
    let ends = NSMaxRange(paragraph) > paragraph.location && string.character(at: NSMaxRange(paragraph) - 1) == 0x0A
    let boxed = paragraph.length > 0 && storage.attribute(.attachment, at: paragraph.location, effectiveRange: nil) is TaskBoxAttachment
    let words = paragraph.location + (boxed ? 2 : 0)
    let end = NSMaxRange(paragraph) - (ends ? 1 : 0)
    // Note that the line before is read as `heldLine` reads a line, by the first facts its words hold, since a line break or words typed may hold none.
    let before = beforeFacts
    // Note that a line holding only spaces reads as empty, as it stands to the eye, since a Return before a space the keyboard laid after a word carries the space onto the line it opens.
    let blank = end <= words || string.substring(with: NSRange(location: words, length: end - words)).trimmingCharacters(in: .whitespaces).isEmpty
    // Note that an empty last line's facts are its line before's, which it carries on.
    return (facts, blank, caret == words, paragraph.length > 0 ? before : facts)
  }

  /// The paragraph a caret at `caret` stands in: the empty line after a last line break where it stands past it, which `paragraphRange` reads as the line before, as `paragraphRanges` lists it.
  private func caretLine(_ caret: Int) -> NSRange {
    let string = textView.textStorage.string as NSString
    let atEmptyEnd = caret == string.length && (string.length == 0 || string.character(at: string.length - 1) == 0x0A)
    return atEmptyEnd ? NSRange(location: caret, length: 0) : string.paragraphRange(for: NSRange(location: caret, length: 0))
  }

  /// The facts the words of a paragraph hold, the first that holds any, as `heldLine` reads its line's.
  private func heldFacts(_ paragraph: NSRange) -> LineFacts? {
    var held: LineFacts?
    textView.textStorage.enumerateAttribute(lineKey, in: paragraph) { value, _, stop in
      guard let value = value as? LineFacts else { return }
      held = value
      stop.pointee = true
    }
    return held
  }

  /// The nested list item the caret stands in with nothing selected, whether its words are empty and whether the caret stands at their start; none elsewhere.
  private func caretNestedLine() -> (empty: Bool, atStart: Bool)? {
    guard textView.selectedRange.length == 0, let line = caretParagraph(), line.facts.nesting > 0 else { return nil }
    return (line.empty, line.atStart)
  }

  /// How deep each line may stand: one under the list item before it in its block, and at its block's own depth where none stands before it.
  private func deepest(_ index: Int, in lines: [DocumentLine]) -> Int {
    guard index > 0, lines[index - 1].facts.block == lines[index].facts.block, lines[index - 1].facts.isListItem
    else { return 0 }
    return lines[index - 1].facts.nesting + 1
  }

  /// Whether the caret's list item could move a step deeper, under the item before it, and a step back out, read from its paragraph and the one before alone.
  private func shiftable() -> (deeper: Bool, shallower: Bool) {
    guard let line = caretParagraph(), line.facts.isListItem else { return (false, false) }
    let before = line.before.flatMap { $0.block == line.facts.block && $0.isListItem ? $0 : nil }
    return (before.map { line.facts.nesting <= $0.nesting } ?? false, line.facts.nesting > 0)
  }

  /// Moves the selection's list items a step deeper or back out, as Tab and Shift-Tab do in Notes and Notion, each with the items nested under it: an item stands at most one deeper than the item before it in its list and never shallower than its list's own items; nested, it keeps its own list, and back at its list's own depth it takes its list's kind. The caret stays on the same words, and where no task's box comes or goes, one Undo takes the move back.
  private func shiftLines(by step: Int) {
    let previous = heldLines()
    var lines = previous
    let touched = touchedIndexes().filter { $0 < lines.count && lines[$0].facts.isListItem }
    var moved = Set<Int>()

    for index in touched where !moved.contains(index) {
      let held = lines[index].facts
      let depth = held.nesting
      let shift = max(0, min(depth + step, deepest(index, in: lines))) - depth
      guard shift != 0 else { continue }
      var end = index + 1
      while end < lines.count, lines[end].facts.block == held.block, lines[end].facts.nesting > depth { end += 1 }

      for each in index..<end {
        lines[each] = DocumentLine(facts: lines[each].facts.at(depth: lines[each].facts.nesting + shift), runs: lines[each].runs)
        moved.insert(each)
      }
    }

    guard !moved.isEmpty else { return }

    let boxesMove = moved.contains { (previous[$0].facts.itemKind == .taskList) != (lines[$0].facts.itemKind == .taskList) }
    // Note that the empty line after a last line break holds no character to keep its facts on, so moved, its facts are the ones the words typed next take, as a block chosen for it is; a box it gains or loses is drawn, which gives it characters of its own.
    let last = lines.count - 1
    let emptyLastMoved = moved.contains(last) && emptyLastLineFacts() != nil && !boxesMove

    if emptyLastMoved, moved.count == 1 {
      holdLastLine(lines[last].facts)
      return
    }

    relay(lines, from: previous, keepUndo: !boxesMove)
    // Note that an empty last item moved with the item above it keeps its own new depth, which the drawing, holding no character for it, would read from the item above.
    if emptyLastMoved { holdLastLine(lines[last].facts) }
  }

  /// Keeps `facts` for the empty last line as the ones the words typed next take, and tells JavaScript, as an edit is told, so an answer from before it is not drawn over it and a save holds it.
  private func holdLastLine(_ facts: LineFacts) {
    pendingLine = (textView.textStorage.length, facts)
    textView.typingAttributes = pendingAttributes(facts)
    changes += 1
    tell()
    updateBar()
  }

  /// Draws block changes of the field's own, keeping the caret on the same words, and where the words stay the same, registers the lines before as the change's undo, whose redo is the lines after.
  private func relay(_ lines: [DocumentLine], from previous: [DocumentLine], keepUndo: Bool) {
    let selected = textView.selectedRange
    let start = linePlace(of: selected.location)
    let end = linePlace(of: NSMaxRange(selected))
    redraw(lines, keepUndo: keepUndo)
    let from = location(of: start)
    let to = max(location(of: end), from)
    textView.selectedRange = NSRange(location: from, length: to - from)

    if keepUndo {
      textView.undoManager?.registerUndo(withTarget: self) { view in
        view.relay(previous, from: view.heldLines(), keepUndo: true)
      }
    }

    edited()
  }

  /// Asks JavaScript for the address of the selected words' link, keeping the words it is asked for.
  private func askLink() {
    let selected = textView.selectedRange
    guard selected.length > 0 else { return }
    linkRange = selected
    linkWords = (textView.textStorage.string as NSString).substring(with: selected)
    let address = textView.textStorage.attribute(linkKey, at: selected.location, effectiveRange: nil) as? String
    onLinkAsk(["address": address ?? ""])
  }

  /// Lays the address JavaScript was given on the words its link was asked for, or takes their link off where it is empty.
  func setLink(_ address: String) {
    let storage = textView.textStorage
    guard let range = linkRange, NSMaxRange(range) <= storage.length else { return }
    let asked = linkWords
    linkRange = nil
    linkWords = nil
    // Note that the address is laid only where the words it was asked for still stand, since the document may have been handed anew while the alert stood.
    guard (storage.string as NSString).substring(with: range) == asked else { return }
    let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)

    quiet = true
    storage.beginEditing()
    if trimmed.isEmpty {
      storage.removeAttribute(linkKey, range: range)
    } else {
      storage.addAttribute(linkKey, value: trimmed, range: range)
    }
    restyleWords(in: range)
    storage.endEditing()
    quiet = false
    edited()
  }

  /// What a format act's change does, as a change typed does: counts it and tells JavaScript, and marks the bar again.
  private func edited() {
    refreshMarks(around: textView.selectedRange)
    changes += 1
    tell()
    tellCaret()
    updateBar()
  }

  /// The marks' and the link's chords, the desktop's own (`@repo/settings`' `WRITING_SHORTCUTS`), which a hardware keyboard answers while the field has the caret.
  override var keyCommands: [UIKeyCommand]? {
    guard textView.isFirstResponder, let formats else { return nil }
    let chords: [String: (String, UIKeyModifierFlags)] = [
      MarkStyle.strong.rawValue: ("b", .command),
      MarkStyle.emphasis.rawValue: ("i", .command),
      MarkStyle.strike.rawValue: ("x", [.command, .shift]),
      MarkStyle.code.rawValue: ("e", .command),
      "link": ("k", .command),
    ]

    let marks: [UIKeyCommand] = (formats.marks + [formats.link].compactMap { $0 }).compactMap { record in
      guard let chord = chords[record.act] else { return nil }
      let command = UIKeyCommand(
        title: record.title,
        action: #selector(chorded(_:)),
        input: chord.0,
        modifierFlags: chord.1,
        propertyList: record.act
      )
      command.wantsPriorityOverSystemBehavior = true
      return command
    }

    // Note that Tab and Shift-Tab move a list's items only while the caret stands in one, so elsewhere Tab moves on to the next field as the system's does.
    guard caretParagraph()?.facts.isListItem == true else { return marks }
    let shifts = [(formats.indent, UIKeyModifierFlags()), (formats.outdent, UIKeyModifierFlags.shift)]
      .compactMap { pair -> UIKeyCommand? in
        guard let record = pair.0 else { return nil }
        let flags = pair.1
        let command = UIKeyCommand(
          title: record.title,
          action: #selector(chorded(_:)),
          input: "\t",
          modifierFlags: flags,
          propertyList: record.act
        )
        command.wantsPriorityOverSystemBehavior = true
        return command
      }

    return marks + shifts
  }

  @objc private func chorded(_ command: UIKeyCommand) {
    guard let act = command.propertyList as? String else { return }
    perform(act)
  }

  // MARK: Mentions

  /// Tells JavaScript the caret's line before and after it, each attachment the object character, so the `@` word it stands in opens a mention offer, as the message box tells its own.
  private func tellCaret() {
    let string = textView.textStorage.string as NSString
    let selected = textView.selectedRange
    let caret = min(selected.location, string.length)
    let end = min(NSMaxRange(selected), string.length)
    let line = string.paragraphRange(for: NSRange(location: caret, length: 0))
    let lineEnd = NSMaxRange(line) > line.location && NSMaxRange(line) <= string.length
      && string.character(at: NSMaxRange(line) - 1) == 0x0A ? NSMaxRange(line) - 1 : NSMaxRange(line)
    let afterEnd = max(lineEnd, end)

    onCaret([
      "before": string.substring(with: NSRange(location: line.location, length: caret - line.location)),
      "after": string.substring(with: NSRange(location: end, length: afterEnd - end)),
      "caret": caret,
      "selected": selected.length > 0,
    ])
  }

  /// The range a pick replaces: the `@` word where it still stands where JavaScript read it, else the nearest such words before the caret on its line, else the caret.
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

  /// Writes words in the range a pick names through the text view's own editing, so undo takes them back, each pill then laid on its object character, and all of it given its line's block and plain looks, the caret after it.
  private func replacePicked(_ range: NSRange, with words: String, pills: [Pill]) {
    let storage = textView.textStorage
    guard editable, NSMaxRange(range) <= storage.length,
      let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let replaced = textView.textRange(from: start, to: end)
    else { return }
    // Note that the line's facts are read before the words go, from what the range stands in, or the line break that ends it.
    let factsAt = min(range.location, max(storage.length - 1, 0))
    let facts = storage.length > 0 ? storage.attribute(lineKey, at: factsAt, effectiveRange: nil) as? LineFacts : nil
    let paragraph = storage.length > 0 ? storage.attribute(.paragraphStyle, at: factsAt, effectiveRange: nil) : nil
    let laid = NSRange(location: range.location, length: (words as NSString).length)

    quiet = true
    textView.replace(replaced, withText: words)
    typed = nil
    storage.beginEditing()
    var attributes = wordAttributes(facts?.drawnKind ?? .paragraph, facts?.level, [], nil)
    if let facts { attributes[lineKey] = facts }
    if let paragraph { attributes[.paragraphStyle] = paragraph }
    storage.setAttributes(attributes, range: laid)
    for (index, pill) in pills.enumerated() {
      let character = NSRange(location: laid.location + index * 2, length: 1)
      storage.addAttribute(.attachment, value: PillAttachment(pill: pill, look: look), range: character)
    }
    storage.endEditing()
    quiet = false
    textView.selectedRange = NSRange(location: NSMaxRange(laid), length: 0)
    placeholderLabel.isHidden = storage.length > 0
    edited()
  }

  /// Puts the pills in place of the `@` word a pick names, or at the caret, each followed by a space, as the message box puts them.
  func insertPills(_ pills: [Pill], over word: Word?) {
    guard !pills.isEmpty else { return }
    replacePicked(pickRange(over: word), with: Array(repeating: "\u{FFFC} ", count: pills.count).joined(), pills: pills)
  }

  /// Writes plain words in place of the `@` word a pick names, such as `@people:` as a kind is picked to narrow it.
  func rewriteWord(_ text: String, over word: Word?) {
    replacePicked(pickRange(over: word), with: text, pills: [])
  }

  // MARK: Telling JavaScript

  /// The lines the view holds: each paragraph's block, read from its words or, for an empty one, from the line break before it, and its runs, a task's box read as its line's checked rather than as words.
  private func heldLines() -> [DocumentLine] {
    let storage = textView.textStorage
    let string = storage.string as NSString
    guard string.length > 0 else { return [] }
    var lines: [DocumentLine] = []
    var location = 0

    while location < string.length {
      let paragraph = string.paragraphRange(for: NSRange(location: location, length: 0))
      let ends = NSMaxRange(paragraph) > paragraph.location
        && string.character(at: NSMaxRange(paragraph) - 1) == 0x0A
      let content = NSRange(location: paragraph.location, length: paragraph.length - (ends ? 1 : 0))
      lines.append(heldLine(content, in: paragraph, after: lines.last?.facts))
      location = NSMaxRange(paragraph)
    }

    // Note that a Return typed at the words' end leaves an empty last line, which carries on the block of the line before it.
    if string.character(at: string.length - 1) == 0x0A {
      let end = NSRange(location: string.length, length: 0)
      let pending = pendingLine.flatMap { $0.at == string.length ? $0.facts : nil }
      lines.append(heldLine(end, in: end, after: pending ?? lines.last?.facts))
    }

    return lines
  }

  /// The line in a range: its block's facts, and its runs. The facts are the first its paragraph holds, its line break included; a paragraph holding none, such as one a Return in a list opened, whose words UIKit types with none of the field's attributes, carries on the line before it, as a Return carries a list on, which the model makes a paragraph of its own after a one-line block.
  private func heldLine(_ content: NSRange, in paragraph: NSRange, after before: LineFacts?) -> DocumentLine {
    let storage = textView.textStorage
    let string = storage.string as NSString
    var held: LineFacts?
    storage.enumerateAttribute(lineKey, in: paragraph) { value, _, stop in
      guard let value = value as? LineFacts else { return }
      held = value
      stop.pointee = true
    }
    var facts = held ?? before ?? LineFacts(block: -1, kind: DocumentKind.paragraph.rawValue)
    // Note that a task is checked only by its own box, so a line a Return opened in a checked task starts unchecked.
    if facts.itemKind == .taskList { facts = facts.with(checked: false) }
    var runs: [DocumentRun] = []

    storage.enumerateAttributes(in: content) { attributes, range, _ in
      if let box = attributes[.attachment] as? TaskBoxAttachment {
        facts = facts.with(checked: box.checked)
        return
      }

      if let pill = attributes[.attachment] as? PillAttachment {
        runs.append(.pill(pill.pill))
        return
      }

      if let block = attributes[.attachment] as? BlockAttachment {
        if let card = block.card { runs.append(.card(card)) }
        return
      }

      var text = string.substring(with: range)
      // Note that the space after a task's box is the box's, no word of the line.
      if facts.itemKind == .taskList, range.location == content.location + 1, runs.isEmpty, text.hasPrefix(" ") {
        text.removeFirst()
      }
      if text.isEmpty { return }
      let marks = attributes[markStylesKey] as? [String] ?? []
      let link = attributes[linkKey] as? String

      if case .words(let before, let beforeMarks, let beforeLink)? = runs.last, beforeMarks == marks, beforeLink == link {
        runs[runs.count - 1] = .words(before + text, marks: marks, link: link)
      } else {
        runs.append(.words(text, marks: marks, link: link))
      }
    }

    return DocumentLine(facts: facts, runs: runs)
  }

  /// Tells JavaScript the lines, and how many changes have been typed.
  private func tell() {
    onLines(["lines": heldLines().map(\.told), "changes": changes])
  }
}

extension LineFacts {
  /// The same facts with a task's box as it stands.
  func with(checked: Bool) -> LineFacts {
    LineFacts(
      block: block,
      kind: kind,
      level: level,
      start: start,
      language: language,
      locked: locked,
      checked: checked,
      from: from,
      depth: depth,
      marker: marker
    )
  }

  /// The same item at another depth: nested, it keeps its own list, the block's where it stood at the block's own depth; brought to its block's own depth, it takes its block's list; a task keeps its box, and an item made a task starts unchecked.
  func at(depth next: Int) -> LineFacts {
    let marker = next == 0 ? nil : ListMarker(itemKind)?.rawValue
    let drawn = next == 0 ? drawnKind : (marker.flatMap(ListMarker.init(rawValue:)) ?? .bullet).kind
    return LineFacts(
      block: block,
      kind: kind,
      level: level,
      start: start,
      language: language,
      locked: locked,
      checked: drawn == .taskList ? checked ?? false : nil,
      from: from,
      depth: next == 0 ? nil : next,
      marker: marker
    )
  }
}

// MARK: - Laying out each paragraph

extension DocumentFieldView: NSTextLayoutManagerDelegate {
  func textLayoutManager(
    _ textLayoutManager: NSTextLayoutManager,
    textLayoutFragmentFor location: NSTextLocation,
    in textElement: NSTextElement
  ) -> NSTextLayoutFragment {
    ItemMarkFragment(textElement: textElement, range: textElement.elementRange)
  }
}
