// DocumentTable.swift -- a table a document's field does not edit, drawn across its line as the description's read rows draw it: inside a rounded hairline, its header on the well, each column as wide as its widest cell within the read rows' bounds, scrolling sideways where it is wider than the line.
//
// The table is one character in its line, an attachment whose view TextKit 2
// lays out with the words, as the field's cards stand, and it is written
// back as the source it was handed, untouched. Its grid is measured once for
// each text size, every cell's words drawn at their own width held to the
// column's bounds (`markdown.tsx`'s `COLUMN_WIDTH`), so the line the
// attachment stands in knows its height before any view is made.

import ExpoModulesCore
import UIKit

// MARK: - What JavaScript hands

/// A run of a cell: words with their looks and the address they link to.
struct TableRunRecord: Record {
  @Field var text: String = ""
  @Field var marks: [String] = []
  @Field var link: String? = nil
}

struct TableCellRecord: Record {
  @Field var runs: [TableRunRecord] = []
}

struct TableRowRecord: Record {
  @Field var cells: [TableCellRecord] = []
}

/// A table: the source it is written back as, each column's alignment, and its rows, the header first.
struct TableRecord: Record {
  @Field var source: String = ""
  @Field var align: [String] = []
  @Field var rows: [TableRowRecord] = []
}

/// The read rows' table, in points: a column's bounds before the reader's text size scales them, a cell's room around its words, and the box's corner.
private enum TableSpace {
  static let leastColumn: CGFloat = 48
  static let mostColumn: CGFloat = 260
  static let cellAcross: CGFloat = 10
  static let cellDown: CGFloat = 6
  static let radius: CGFloat = 10
}

/// A cell's words, the subheadline's face, as the read rows' cells read.
private func cellFont() -> UIFont {
  .preferredFont(forTextStyle: .subheadline)
}

// MARK: - The table

/// A run of a cell as the view holds it.
struct TableRun: Equatable {
  let text: String
  let marks: [String]
  let link: String?
}

/// A table as a line holds it: the source it is written back as, each column's alignment as JavaScript names it, and its rows' cells' runs, the header first.
struct TableModel: Equatable {
  let source: String
  let align: [String]
  let rows: [[[TableRun]]]

  init(_ record: TableRecord) {
    source = record.source
    align = record.align
    rows = record.rows.map { row in
      row.cells.map { cell in cell.runs.map { TableRun(text: $0.text, marks: $0.marks, link: $0.link) } }
    }
  }
}

/// A column's alignment as JavaScript names it (`COLUMN_ALIGN`).
private func cellAlignment(_ align: String) -> NSTextAlignment {
  switch align {
  case "center": return .center
  case "end": return .right
  default: return .natural
  }
}

/// A table's cells as they are drawn, in the field's look, and the grid they were last measured into.
final class TableGrid {
  let align: [NSTextAlignment]
  let rows: [[NSAttributedString]]
  private var measured: (size: UIContentSizeCategory, columns: [CGFloat], rows: [CGFloat])?

  init(_ table: TableModel, look: Look) {
    align = table.align.map(cellAlignment)
    rows = table.rows.enumerated().map { at, row in
      row.map { cellWords($0, header: at == 0, look: look) }
    }
  }

  /// Each column's width and each row's height at the reader's text size, measured once for each size.
  func grid() -> (columns: [CGFloat], rows: [CGFloat]) {
    let size = UIApplication.shared.preferredContentSizeCategory
    if let measured, measured.size == size { return (measured.columns, measured.rows) }

    let scale = UIFontMetrics(forTextStyle: .subheadline).scaledValue(for: 1)
    let least = TableSpace.leastColumn * scale
    let most = TableSpace.mostColumn * scale
    let count = rows.map(\.count).max() ?? 0
    var columns = [CGFloat](repeating: least, count: count)

    for row in rows {
      for (at, words) in row.enumerated() {
        let wide = ceil(words.boundingRect(with: CGSize(width: most, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).width)
        columns[at] = min(most, max(columns[at], wide + TableSpace.cellAcross * 2))
      }
    }

    let heights = rows.map { row in
      row.enumerated().reduce(CGFloat(0)) { tallest, cell in
        let inner = columns[cell.offset] - TableSpace.cellAcross * 2
        let tall = ceil(cell.element.boundingRect(with: CGSize(width: inner, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).height)
        return max(tallest, tall + TableSpace.cellDown * 2)
      }
    }

    measured = (size, columns, heights)
    return (columns, heights)
  }

  /// How tall the table stands, its hairline box included.
  func height() -> CGFloat {
    ceil(grid().rows.reduce(0, +)) + 1
  }
}

/// A cell's words with their looks, a header's in its weight, as the read rows' cell draws them.
private func cellWords(_ runs: [TableRun], header: Bool, look: Look) -> NSAttributedString {
  let words = NSMutableAttributedString()
  let base = cellFont()

  for run in runs {
    let marks = Set(run.marks)
    var traits: UIFontDescriptor.SymbolicTraits = []
    if marks.contains("strong") || header { traits.insert(.traitBold) }
    if marks.contains("emphasis") { traits.insert(.traitItalic) }
    var font = base.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: base.pointSize) } ?? base
    if marks.contains("code") { font = .monospacedSystemFont(ofSize: base.pointSize * 0.94, weight: header ? .semibold : .regular) }
    var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: look.text]
    if marks.contains("strike") { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if run.link != nil { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    words.append(NSAttributedString(string: run.text, attributes: attributes))
  }

  return words
}

// MARK: - The attachment

/// A table drawn as its grid, as one character across its line.
final class TableAttachment: NSTextAttachment {
  let table: TableModel
  let grid: TableGrid
  let look: Look

  init(table: TableModel, look: Look) {
    self.table = table
    grid = TableGrid(table, look: look)
    self.look = look
    super.init(data: nil, ofType: nil)
    accessibilityLabel = "Table"
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A table is never decoded.")
  }

  override func viewProvider(
    for parentView: UIView?,
    location: any NSTextLocation,
    textContainer: NSTextContainer?
  ) -> NSTextAttachmentViewProvider? {
    let provider = TableViewProvider(
      textAttachment: self,
      parentView: parentView,
      textLayoutManager: textContainer?.textLayoutManager,
      location: location
    )
    provider.tracksTextAttachmentViewBounds = true
    return provider
  }
}

/// Stands the table across its line, at its grid's height and a gap below it.
final class TableViewProvider: NSTextAttachmentViewProvider {
  override func loadView() {
    guard let attachment = textAttachment as? TableAttachment else { return }
    view = TableView(grid: attachment.grid, look: attachment.look)
  }

  override func attachmentBounds(
    for attributes: [NSAttributedString.Key: Any],
    location: any NSTextLocation,
    textContainer: NSTextContainer?,
    proposedLineFragment: CGRect,
    position: CGPoint
  ) -> CGRect {
    guard let attachment = textAttachment as? TableAttachment else { return .zero }
    let width = max(proposedLineFragment.width - 1, 1)
    let font = attributes[.font] as? UIFont ?? bodyFont()
    return CGRect(x: 0, y: font.descender, width: width, height: attachment.grid.height() + MediaSpace.gap)
  }
}

// MARK: - The view

/// The table's grid inside its rounded hairline, scrolling sideways where it is wider than its line, its header on the well and a hairline between its rows.
final class TableView: UIView {
  private let table: TableGrid
  private let look: Look
  private let box = UIView()
  private let scroller = UIScrollView()
  private var cells: [UILabel] = []
  private var rules: [UIView] = []
  private let well = UIView()

  init(grid: TableGrid, look: Look) {
    table = grid
    self.look = look
    super.init(frame: .zero)
    box.layer.borderWidth = 1 / UITraitCollection.current.displayScale
    box.layer.borderColor = look.edge.cgColor
    box.layer.cornerRadius = TableSpace.radius
    box.layer.cornerCurve = .continuous
    box.clipsToBounds = true
    scroller.showsHorizontalScrollIndicator = false
    scroller.alwaysBounceVertical = false
    well.backgroundColor = look.well
    addSubview(box)
    box.addSubview(scroller)
    scroller.addSubview(well)

    for (rowAt, row) in table.rows.enumerated() {
      if rowAt > 0 {
        let rule = UIView()
        rule.backgroundColor = look.edge
        scroller.addSubview(rule)
        rules.append(rule)
      }

      for (columnAt, words) in row.enumerated() {
        let cell = UILabel()
        cell.attributedText = words
        cell.numberOfLines = 0
        cell.textAlignment = columnAt < table.align.count ? table.align[columnAt] : .natural
        scroller.addSubview(cell)
        cells.append(cell)
      }
    }

    isAccessibilityElement = false
    accessibilityElements = cells
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("A table is never decoded.")
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    box.layer.borderColor = look.edge.cgColor
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let grid = table.grid()
    let wide = grid.columns.reduce(0, +)
    let tall = grid.rows.reduce(0, +)
    box.frame = CGRect(x: 0, y: 0, width: min(bounds.width, wide + 1), height: tall + 1)
    scroller.frame = box.bounds
    scroller.contentSize = CGSize(width: wide, height: tall)
    well.frame = CGRect(x: 0, y: 0, width: max(wide, box.bounds.width), height: grid.rows.first ?? 0)
    var y: CGFloat = 0
    var at = 0
    let hairline = 1 / max(1, traitCollection.displayScale)

    for (rowAt, row) in table.rows.enumerated() {
      let height = grid.rows[rowAt]
      if rowAt > 0 { rules[rowAt - 1].frame = CGRect(x: 0, y: y, width: max(wide, box.bounds.width), height: hairline) }
      var x: CGFloat = 0

      for columnAt in row.indices {
        let width = grid.columns[columnAt]
        // Note that a cell's words stand at its row's top, as the read rows' cells do, rather than centered down a taller row.
        let inner = width - TableSpace.cellAcross * 2
        let words = cells[at].sizeThatFits(CGSize(width: inner, height: .greatestFiniteMagnitude)).height
        cells[at].frame = CGRect(x: x + TableSpace.cellAcross, y: y + TableSpace.cellDown, width: inner, height: min(words, height - TableSpace.cellDown * 2))
        x += width
        at += 1
      }

      y += height
    }
  }
}
