// DocumentComments.swift -- the count of a document block's open comment threads, standing at the trailing edge of the block's first line as the description's read rows stand it, which a press opens: a button over the field's text view, never a character of its words.
//
// A count is no word of the document, so it is no attachment, which would be
// selected, copied and deleted with the words and move every place the
// field tells JavaScript; and no drawing of a layout fragment, which takes
// no press and which VoiceOver cannot reach. It is a button laid over the
// text view, scrolling with its words, at the first line of its block as
// TextKit 2 lays it out, and the block's words end short of it by their
// paragraph's tail indent, so they never run under it.

import ExpoModulesCore
import UIKit

/// A block's open comment threads as JavaScript hands them: the block, by the place it came from in the document as read, how many, and how VoiceOver hears the count.
struct CommentMarkRecord: Record {
  @Field var block: Int = 0
  @Field var count: Int = 0
  @Field var heard: String = ""
}

/// A block's count as the field holds it.
struct CommentMark: Equatable {
  let count: Int
  let heard: String
}

/// The room a count stands in at its block's trailing edge: Apple's least target across, and the gap the block's words keep from it.
enum CommentSpace {
  static let width: CGFloat = 44
  static let gap: CGFloat = 4
  static let glyphGap: CGFloat = 3

  /// How far a commented block's words end short of the line's trailing edge.
  static var tail: CGFloat { width + gap }
}

/// The counts a field stands beside its blocks: each block's count, and the button standing it, by the block.
final class CommentMarks {
  private(set) var marks: [Int: CommentMark] = [:]
  private var buttons: [Int: UIButton] = [:]

  /// The counts standing, which VoiceOver reaches beside the words.
  var shown: [UIView] {
    buttons.values.filter { !$0.isHidden }
  }

  /// Takes each block's count, answering the blocks whose words now end short of a count or no longer do.
  func take(_ records: [CommentMarkRecord]) -> Set<Int> {
    let before = Set(marks.keys)
    var next: [Int: CommentMark] = [:]
    for record in records where record.count > 0 {
      next[record.block] = CommentMark(count: record.count, heard: record.heard)
    }
    let changed = Set(next.keys).symmetricDifference(before)
    // Note that a count that changed draws its button anew, and one gone takes its button away.
    for (block, button) in buttons where next[block] != marks[block] {
      button.removeFromSuperview()
      buttons[block] = nil
    }
    marks = next
    return changed
  }

  /// Stands each count at the frame `place` answers for its block, in the text view's own space, making a button where none stands, and takes away the button of a block `place` finds no line of.
  func lay(
    in textView: UITextView,
    look: Look,
    glyph: UIImage?,
    place: (Int) -> CGRect?,
    open: @escaping (Int) -> Void
  ) {
    for (block, mark) in marks {
      guard let frame = place(block) else {
        buttons[block]?.isHidden = true
        continue
      }
      let button = buttons[block] ?? makeButton(block, mark, look: look, glyph: glyph, open: open)
      if button.superview !== textView { textView.addSubview(button) }
      buttons[block] = button
      button.isHidden = false
      button.frame = frame
    }
  }

  private func makeButton(_ block: Int, _ mark: CommentMark, look: Look, glyph: UIImage?, open: @escaping (Int) -> Void) -> UIButton {
    var configuration = UIButton.Configuration.plain()
    configuration.image = glyph?.withTintColor(look.placeholder, renderingMode: .alwaysOriginal)
    configuration.imagePadding = CommentSpace.glyphGap
    configuration.contentInsets = .zero
    configuration.baseForegroundColor = look.placeholder
    configuration.title = String(mark.count)
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var shown = attributes
      let face = UIFont.preferredFont(forTextStyle: .footnote)
      shown.font = UIFont.monospacedDigitSystemFont(ofSize: face.pointSize, weight: .regular)
      return shown
    }
    let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in open(block) })
    button.contentHorizontalAlignment = .trailing
    button.accessibilityLabel = mark.heard
    return button
  }
}
