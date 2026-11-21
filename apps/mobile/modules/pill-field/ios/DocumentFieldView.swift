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
  @Field var from: Int? = nil
  @Field var runs: [DocumentRunRecord] = []
}

/// The document's lines, and how many of the view's changes JavaScript had heard as it handed them.
struct DocumentValueRecord: Record {
  @Field var lines: [DocumentLineRecord] = []
  @Field var seen: Int = 0
}

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

  init(_ record: DocumentLineRecord) {
    block = record.block
    kind = record.kind
    level = record.level
    start = record.start
    language = record.language
    locked = record.locked
    checked = record.checked
    from = record.from
  }

  init(
    block: Int,
    kind: String,
    level: Int? = nil,
    start: Int? = nil,
    language: String? = nil,
    locked: String? = nil,
    checked: Bool? = nil,
    from: Int? = nil
  ) {
    self.block = block
    self.kind = kind
    self.level = level
    self.start = start
    self.language = language
    self.locked = locked
    self.checked = checked
    self.from = from
  }

  var drawnKind: DocumentKind { DocumentKind(rawValue: kind) ?? .paragraph }

  /// Whether two lines draw alike: everything but which block they belong to and where it came from.
  func drawsAs(_ other: LineFacts) -> Bool {
    kind == other.kind && level == other.level && start == other.start && language == other.language
      && locked == other.locked && checked == other.checked
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

/// How far a list's, a task's and a quote's lines stand in from the edge.
private enum DocumentSpace {
  static let indent: CGFloat = 24
  static let quoteIndent: CGFloat = 14
  static let blockGap: CGFloat = 10
  static let itemGap: CGFloat = 4
  static let cardHeight: CGFloat = 52
  static let cardRadius: CGFloat = 10
  static let cardPadding: CGFloat = 12
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

  private let textView = UITextView(usingTextLayoutManager: true)
  private let placeholderLabel = UILabel()

  /// How many changes have been typed, which a handing must have heard to be taken.
  private var changes = 0

  /// Whether an edit of the view's own is under way, which tells JavaScript nothing.
  private var quiet = false

  /// The words an edit typed, where they stand once it lands, whose block and looks are carried on to them.
  private var typed: NSRange?

  var look = Look() {
    didSet {
      guard look != oldValue else { return }
      placeholderLabel.textColor = look.placeholder
      textView.tintColor = look.tint
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

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.delegate = self
    textView.backgroundColor = .clear
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

    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: DocumentFieldView, _: UITraitCollection) in
      view.redraw(view.heldLines())
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
    let line = ceil(bodyFont().lineHeight)
    placeholderLabel.frame = CGRect(
      x: textView.textContainerInset.left,
      y: textView.textContainerInset.top,
      width: bounds.width - textView.textContainerInset.left - textView.textContainerInset.right,
      height: line
    )
  }

  @objc private func keyboardMoved(_ notification: Notification) {
    guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
      let window
    else { return }
    let mine = convert(bounds, to: window)
    let covered = max(0, mine.maxY - frame.minY)
    textView.contentInset.bottom = covered
    textView.verticalScrollIndicatorInsets.bottom = covered
    if textView.isFirstResponder { textView.scrollRangeToVisible(textView.selectedRange) }
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
    textView.becomeFirstResponder()
  }

  func blur() {
    textView.resignFirstResponder()
  }

  // MARK: The text view's delegate

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    typed = NSRange(location: range.location, length: (text as NSString).length)
    return true
  }

  func textViewDidChange(_ textView: UITextView) {
    guard !quiet else { return }
    if let typed {
      carryOn(to: typed)
      boxNewTask(after: typed)
    }
    typed = nil
    changes += 1
    placeholderLabel.isHidden = textView.textStorage.length > 0
    tell()
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onFocusChange(["focused": true])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    onFocusChange(["focused": false])
  }

  // MARK: Drawing

  /// Draws the lines anew, keeping the caret where it stood, as near as the new words allow.
  private func redraw(_ lines: [DocumentLine]) {
    let selected = textView.selectedRange
    quiet = true
    textView.attributedText = drawn(lines)
    textView.undoManager?.removeAllActions()
    let length = textView.textStorage.length
    var location = min(selected.location, length)
    // Note that a caret standing before a task's box goes after it, so the words typed next are the task's.
    if selected.length == 0, location < length,
      textView.textStorage.attribute(.attachment, at: location, effectiveRange: nil) is TaskBoxAttachment {
      location = min(location + 2, length)
    }
    textView.selectedRange = NSRange(location: location, length: min(selected.length, length - location))
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
  }

  /// The lines drawn: each a paragraph in its block's look, a task led by its box, a rule and a card as one character across the line, and a line break after every line but the last.
  private func drawn(_ lines: [DocumentLine]) -> NSAttributedString {
    let built = NSMutableAttributedString()
    // Note that a list's lines share one list, so its markers count on from one item to the next rather than each starting again.
    var lists: [Int: NSTextList] = [:]

    for (index, line) in lines.enumerated() {
      let piece = NSMutableAttributedString()
      let kind = line.facts.drawnKind

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
      let list = textList(line.facts, in: &lists)
      piece.addAttribute(.paragraphStyle, value: paragraphStyle(line.facts, list: list), range: whole)
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

  /// The list a list's line stands in, one per block, made the first time a block's line asks for it; none for a line in no list.
  private func textList(_ facts: LineFacts, in lists: inout [Int: NSTextList]) -> NSTextList? {
    if let made = lists[facts.block] { return made }

    let list: NSTextList
    switch facts.drawnKind {
    case .bulletList:
      list = NSTextList(markerFormat: .disc, options: 0)
    case .orderedList:
      list = NSTextList(markerFormat: NSTextList.MarkerFormat(rawValue: "{decimal}."), options: 0)
      list.startingItemNumber = facts.start ?? 1
    default:
      return nil
    }

    lists[facts.block] = list
    return list
  }

  /// A line's paragraph: its list's marker and indent, a quote's indent, and the room between blocks.
  private func paragraphStyle(_ facts: LineFacts, list: NSTextList?) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.paragraphSpacing = DocumentSpace.blockGap
    if let list { style.textLists = [list] }

    switch facts.drawnKind {
    case .bulletList:
      style.headIndent = DocumentSpace.indent
      style.firstLineHeadIndent = DocumentSpace.indent
      style.paragraphSpacing = DocumentSpace.itemGap
    case .orderedList:
      style.headIndent = DocumentSpace.indent
      style.firstLineHeadIndent = DocumentSpace.indent
      style.paragraphSpacing = DocumentSpace.itemGap
    case .taskList:
      style.paragraphSpacing = DocumentSpace.itemGap
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

  /// Lays the block and looks the words around a typed piece carry on the piece, since UIKit types with no attribute of the field's own: its block from the next character, which stands in its paragraph (a word, or the line break that ends it), else the one before; its looks and address from the character before where it stands in the same paragraph, as typing after bold words types bold.
  private func carryOn(to piece: NSRange) {
    let storage = textView.textStorage
    let string = storage.string as NSString
    guard piece.length > 0, NSMaxRange(piece) <= storage.length else { return }
    let after = NSMaxRange(piece) < storage.length ? NSMaxRange(piece) : nil
    let before = piece.location > 0 ? piece.location - 1 : nil
    let blockFrom = after ?? before
    let looksFrom = before.flatMap { string.character(at: $0) == 0x0A ? nil : $0 } ?? after

    quiet = true
    storage.beginEditing()

    if let blockFrom, let facts = storage.attribute(lineKey, at: blockFrom, effectiveRange: nil) {
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

    storage.endEditing()
    quiet = false
  }

  /// Leads a task line a Return opened with its own unchecked box, the caret after it, as a checklist's Return does in Notes and Notion: the line after a typed line break, where its block is a task list and no box leads it.
  private func boxNewTask(after piece: NSRange) {
    let storage = textView.textStorage
    let string = storage.string as NSString
    let start = NSMaxRange(piece)
    guard piece.length > 0, start <= storage.length, string.character(at: start - 1) == 0x0A else { return }
    let factsAt = start < storage.length ? start : start - 1
    guard let facts = storage.attribute(lineKey, at: factsAt, effectiveRange: nil) as? LineFacts,
      facts.drawnKind == .taskList
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
      lines.append(heldLine(end, in: end, after: lines.last?.facts))
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
    if facts.drawnKind == .taskList { facts = facts.with(checked: false) }
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
      if facts.drawnKind == .taskList, range.location == content.location + 1, runs.isEmpty, text.hasPrefix(" ") {
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
      from: from
    )
  }
}
