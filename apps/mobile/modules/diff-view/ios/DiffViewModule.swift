// DiffViewModule.swift -- a changed file's diff drawn natively: a collection view of one recycled row per line of the diff, its hunk headers among them, each row its line numbers on the old side and the new and its words in the monospaced face, tinted as GitHub tints an added or a removed line.
//
// `@repo/ui-native`'s `DiffView` hands this view the diff as columns
// (`diff-view-model.ts`): the rows' kinds as one letter each, their line
// numbers on each side (0 where a row stands on none), and their words, a
// row to a line, every tab already spelled as spaces. Columns cross the
// bridge as four values whatever the diff's length, where an object per row
// would cross as thousands.
//
// Nothing here lays words out to measure them. The face is monospaced, so a
// row's width is its count of characters times one advance, and with words
// wrapped its height is the number of lines that count fills at the room the
// row has, times the face's line height (`DiffGeometry`). The whole diff's
// geometry is one array of each row's top, worked out in one pass over
// integers as the diff or the view's width changes, so opening a diff of
// thousands of lines costs no text layout at all, and finding the rows a
// scroll shows is a binary search. Only the rows on screen are drawn, each a
// recycled cell. Note that a character wider than one column, such as an
// emoji or a CJK letter, draws a little past the count; the cell clips it
// rather than measuring every row.
//
// With words unwrapped the rows keep one line each and the diff scrolls
// sideways as one block, its scroll locked to the direction it starts in, so
// a swipe down a long line never drifts sideways. The time from a diff
// handed to its first frame is logged as a signpost interval and a line of
// the device's log ("DiffView first frame"), which the Mac's timing lane
// reads.

import ExpoModulesCore
import os
import UIKit

public final class DiffViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DiffView")

    View(DiffView.self) {
      Prop("rows") { (view: DiffView, rows: RowsRecord) in
        view.take(DiffRows(rows))
      }

      Prop("look") { (view: DiffView, look: LookRecord) in
        view.look = DiffLook(look)
      }
    }
  }
}

// MARK: - What JavaScript hands

/// The diff's rows as columns (`diff-view-model.ts`'s `DiffColumns`).
struct RowsRecord: Record {
  @Field var kinds: String = ""
  @Field var oldLines: [Int] = []
  @Field var newLines: [Int] = []
  @Field var text: String = ""
}

/// How the diff is drawn: its type size, whether its words wrap, and the theme's inks, an added and a removed line's grounds tinted from the complete and danger tones.
struct LookRecord: Record {
  @Field var fontSize: Double = 13
  @Field var wrap: Bool = true
  @Field var text: UIColor? = nil
  @Field var muted: UIColor? = nil
  @Field var ground: UIColor? = nil
  @Field var added: UIColor? = nil
  @Field var removed: UIColor? = nil
  @Field var hunk: UIColor? = nil
}

// MARK: - The diff as the view holds it

/// What a row is, by the letter `diff-view-model.ts`'s `DRAWN_ROW` hands it as.
enum RowKind: UInt8 {
  case hunk = 104  // "h"
  case context = 99  // "c"
  case added = 97  // "a"
  case removed = 114  // "r"
  case note = 110  // "n"
}

/// The diff's rows: each one's kind, its line numbers (0 for none), its words, and their count of columns.
struct DiffRows {
  let kinds: [RowKind]
  let oldLines: [Int]
  let newLines: [Int]
  let lines: [Substring]
  let columns: [Int]
  /// The longest row, in columns, which an unwrapped diff is as wide as.
  let widest: Int
  /// The most digits a line number spells, which the gutter is as wide as.
  let digits: Int

  static let empty = DiffRows(RowsRecord())

  init(_ record: RowsRecord) {
    let lines = record.text.split(separator: "\n", omittingEmptySubsequences: false)
    let kinds = record.kinds.utf8.map { RowKind(rawValue: $0) ?? .context }
    // Note that the columns are taken at their shortest, so a record whose columns disagree never reads past one.
    let count = min(kinds.count, lines.count, record.oldLines.count, record.newLines.count)
    let columns = lines.prefix(count).map { $0.count }
    let highest = max(record.oldLines.prefix(count).max() ?? 0, record.newLines.prefix(count).max() ?? 0)

    self.kinds = Array(kinds.prefix(count))
    self.oldLines = Array(record.oldLines.prefix(count))
    self.newLines = Array(record.newLines.prefix(count))
    self.lines = Array(lines.prefix(count))
    self.columns = columns
    self.widest = columns.max() ?? 0
    self.digits = max(String(highest).count, 1)
  }

  var count: Int { kinds.count }
}

/// How the diff is drawn, with the theme's inks, or the system's where none was handed.
struct DiffLook {
  let font: UIFont
  let wrap: Bool
  let text: UIColor
  let muted: UIColor
  let ground: UIColor
  let added: UIColor
  let removed: UIColor
  let hunk: UIColor

  static let standard = DiffLook(LookRecord())

  init(_ record: LookRecord) {
    font = UIFont.monospacedSystemFont(ofSize: CGFloat(record.fontSize), weight: .regular)
    wrap = record.wrap
    text = record.text ?? .label
    muted = record.muted ?? .secondaryLabel
    ground = record.ground ?? .systemBackground
    added = record.added ?? .systemGreen
    removed = record.removed ?? .systemRed
    hunk = record.hunk ?? .systemBlue
  }

  /// The ground a row of `kind` stands on, an added or a removed line's tinted from its tone, as GitHub tints them.
  func ground(of kind: RowKind) -> UIColor {
    switch kind {
    case .added: return added.withAlphaComponent(0.14)
    case .removed: return removed.withAlphaComponent(0.14)
    case .hunk: return hunk.withAlphaComponent(0.10)
    case .context, .note: return ground
    }
  }

  /// The gutter's ground beside a row of `kind`, a shade stronger than the row's own.
  func gutter(of kind: RowKind) -> UIColor {
    switch kind {
    case .added: return added.withAlphaComponent(0.24)
    case .removed: return removed.withAlphaComponent(0.24)
    case .hunk: return hunk.withAlphaComponent(0.10)
    case .context, .note: return ground
    }
  }
}

// MARK: - Geometry

/// The diff's geometry at one width: one advance of the face, its line height, the gutter's width, and each row's top, worked out from counts of columns alone.
struct DiffGeometry {
  static let inset: CGFloat = 8
  static let gutterGap: CGFloat = 6

  let advance: CGFloat
  let lineHeight: CGFloat
  let gutterWidth: CGFloat
  let contentWidth: CGFloat
  /// Each row's top, and the whole diff's height last, so row `i` spans `tops[i]..<tops[i + 1]`.
  let tops: [CGFloat]

  static let none = DiffGeometry(advance: 0, lineHeight: 0, gutterWidth: 0, contentWidth: 0, tops: [0])

  init(advance: CGFloat, lineHeight: CGFloat, gutterWidth: CGFloat, contentWidth: CGFloat, tops: [CGFloat]) {
    self.advance = advance
    self.lineHeight = lineHeight
    self.gutterWidth = gutterWidth
    self.contentWidth = contentWidth
    self.tops = tops
  }

  init(rows: DiffRows, look: DiffLook, width: CGFloat) {
    let advance = ceil(("0" as NSString).size(withAttributes: [.font: look.font]).width)
    let lineHeight = ceil(look.font.lineHeight) + 2
    // Two columns of numbers, the old side's and the new's, as the desktop's unified diff numbers a line.
    let gutterWidth = CGFloat(rows.digits * 2) * advance + DiffGeometry.gutterGap * 3
    let room = max(width - gutterWidth - DiffGeometry.inset * 2, advance)
    let perLine = max(Int(room / advance), 1)
    var tops = [CGFloat]()
    tops.reserveCapacity(rows.count + 1)
    var top: CGFloat = 0

    for row in 0..<rows.count {
      tops.append(top)
      let wrapped = look.wrap && rows.kinds[row] != .hunk ? (rows.columns[row] + perLine - 1) / perLine : 1
      top += CGFloat(max(wrapped, 1)) * lineHeight
    }

    tops.append(top)
    let unwrapped = gutterWidth + CGFloat(rows.widest) * advance + DiffGeometry.inset * 2
    self.init(
      advance: advance,
      lineHeight: lineHeight,
      gutterWidth: gutterWidth,
      contentWidth: look.wrap ? width : max(width, unwrapped),
      tops: tops
    )
  }

  /// The first row whose span reaches below `y`, by binary search over the tops.
  func firstRow(below y: CGFloat) -> Int {
    var low = 0
    var high = tops.count - 1

    while low < high {
      let middle = (low + high) / 2
      if tops[middle + 1] <= y { low = middle + 1 } else { high = middle }
    }

    return low
  }
}

// MARK: - Layout

/// The collection view's layout: each row at its top from the geometry, as wide as the content, the rows a rect shows found by binary search.
final class DiffLayout: UICollectionViewLayout {
  var geometry = DiffGeometry.none

  override var collectionViewContentSize: CGSize {
    CGSize(width: geometry.contentWidth, height: geometry.tops.last ?? 0)
  }

  override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
    let rows = geometry.tops.count - 1
    guard rows > 0 else { return [] }
    var shown = [UICollectionViewLayoutAttributes]()
    var row = geometry.firstRow(below: rect.minY)

    while row < rows, geometry.tops[row] < rect.maxY {
      if let attributes = layoutAttributesForItem(at: IndexPath(item: row, section: 0)) { shown.append(attributes) }
      row += 1
    }

    return shown
  }

  override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
    let row = indexPath.item
    guard row < geometry.tops.count - 1 else { return nil }
    let attributes = UICollectionViewLayoutAttributes(forCellWith: indexPath)
    attributes.frame = CGRect(
      x: 0,
      y: geometry.tops[row],
      width: geometry.contentWidth,
      height: geometry.tops[row + 1] - geometry.tops[row]
    )

    return attributes
  }

  override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
    // Note that only a change of width moves the rows; a scroll never does.
    newBounds.width != collectionView?.bounds.width
  }
}

// MARK: - A row

/// One row: its line numbers in the gutter, muted, and its words, wrapped by character where the look wraps them.
final class DiffLineCell: UICollectionViewCell {
  static let reuse = "DiffLine"

  private let gutter = UILabel()
  private let words = UILabel()
  private var gutterWidth: CGFloat = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    gutter.textAlignment = .right
    gutter.numberOfLines = 1
    words.numberOfLines = 0
    words.lineBreakMode = .byCharWrapping
    contentView.clipsToBounds = true
    contentView.addSubview(gutter)
    contentView.addSubview(words)
  }

  required init?(coder: NSCoder) { nil }

  func show(row: Int, rows: DiffRows, look: DiffLook, geometry: DiffGeometry) {
    let kind = rows.kinds[row]
    let old = rows.oldLines[row]
    let new = rows.newLines[row]
    // Each side's number right-aligned in a column as wide as the diff's longest, a side the row stands on none of left blank.
    let pad = { (line: Int) -> String in
      let digits = line == 0 ? "" : String(line)
      return String(repeating: " ", count: max(rows.digits - digits.count, 0)) + digits
    }
    let numbers = kind == .hunk ? "" : "\(pad(old))  \(pad(new))"

    contentView.backgroundColor = look.ground(of: kind)
    gutter.backgroundColor = look.gutter(of: kind)
    gutter.font = look.font
    gutter.textColor = look.muted
    gutter.text = numbers
    words.font = look.font
    words.textColor = kind == .hunk ? look.muted : look.text
    words.lineBreakMode = look.wrap ? .byCharWrapping : .byClipping
    words.text = String(rows.lines[row])
    gutterWidth = geometry.gutterWidth
    // Note that a row is heard as its line numbers and its words, as a screen reader reads GitHub's.
    isAccessibilityElement = true
    accessibilityLabel = kind == .hunk ? words.text : "\(numbers.trimmingCharacters(in: .whitespaces)) \(words.text ?? "")"
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let bounds = contentView.bounds
    gutter.frame = CGRect(x: 0, y: 1, width: gutterWidth - DiffGeometry.gutterGap, height: bounds.height - 2)
    gutter.frame.size.height = min(gutter.frame.height, gutter.font.lineHeight + 2)
    words.frame = CGRect(
      x: gutterWidth + DiffGeometry.inset,
      y: 1,
      width: bounds.width - gutterWidth - DiffGeometry.inset * 2,
      height: bounds.height - 2
    )
  }
}

// MARK: - The view

/// The diff: a collection view of its rows over the layout, laid out again as its rows, its look, or its width change.
final class DiffView: ExpoView, UICollectionViewDataSource {
  private static let signposter = OSSignposter(subsystem: "dev.vespin.ios", category: "DiffView")

  private let layout = DiffLayout()
  private lazy var list = UICollectionView(frame: .zero, collectionViewLayout: layout)
  private var rows = DiffRows.empty
  private var laidWidth: CGFloat = -1
  /// A diff handed and not yet drawn: when it was handed, and its signpost interval.
  private var pending: (at: CFTimeInterval, interval: OSSignpostIntervalState)?

  var look = DiffLook.standard {
    didSet { relayout() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    list.dataSource = self
    list.register(DiffLineCell.self, forCellWithReuseIdentifier: DiffLineCell.reuse)
    list.isDirectionalLockEnabled = true
    list.alwaysBounceVertical = true
    list.contentInsetAdjustmentBehavior = .automatic
    addSubview(list)
  }

  /// Takes a diff, drawing it from its first row.
  func take(_ next: DiffRows) {
    let interval = DiffView.signposter.beginInterval("FirstFrame", "\(next.count) rows")
    pending = (CACurrentMediaTime(), interval)
    rows = next
    relayout()
  }

  private func relayout() {
    laidWidth = -1
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    list.frame = bounds
    list.backgroundColor = look.ground

    if bounds.width != laidWidth, bounds.width > 0 {
      laidWidth = bounds.width
      layout.geometry = DiffGeometry(rows: rows, look: look, width: bounds.width)
      layout.invalidateLayout()
      list.reloadData()
    }

    guard let (at, interval) = pending, bounds.width > 0 else { return }
    pending = nil
    // Note that the frame is counted as drawn once the run loop has laid the rows out and handed them to the screen.
    DispatchQueue.main.async { [rows] in
      DiffView.signposter.endInterval("FirstFrame", interval)
      NSLog("DiffView first frame: %.1f ms, %d rows", (CACurrentMediaTime() - at) * 1000, rows.count)
    }
  }

  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    layout.geometry.tops.count - 1
  }

  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(withReuseIdentifier: DiffLineCell.reuse, for: indexPath)
    (cell as? DiffLineCell)?.show(row: indexPath.item, rows: rows, look: look, geometry: layout.geometry)

    return cell
  }
}
