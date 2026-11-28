// DiffPairs.swift -- a diff's rows laid out for drawing: one row to a line in a unified diff, or the old side beside the new in a split one, each removed line paired with the added line in its place, as GitHub's split diff pairs them.
//
// A split diff stands a line of context on both halves, its old number on
// the left and its new on the right, and a run of removed lines beside the
// run of added lines that follows it, the first with the first, the shorter
// run's half left blank past its end. A row that is no line of either side,
// a hunk's header, git's note, or a review thread's card, stands across both
// halves, and ends any run before it. Nothing here draws: a view lays out
// and draws each display row from the diff's own rows, by their places.

/// One row as it is drawn: a row of the diff across the whole width, or the old side's row beside the new side's, either half blank where none stands there.
public enum DisplayRow: Equatable, Sendable {
  case single(Int)
  case pair(old: Int?, new: Int?)
}

/// The diff's rows, each standing on the sides `sides` names, laid out unified, one display row to a row, or split.
public func displayRows(sides: [DiffLine.Side], split: Bool) -> [DisplayRow] {
  guard split else { return sides.indices.map { .single($0) } }

  var shown = [DisplayRow]()
  var removed = [Int]()
  var added = [Int]()

  // Pairs the runs held so far, the first removed line beside the first added, and lets them go.
  func flush() {
    for at in 0..<max(removed.count, added.count) {
      shown.append(.pair(old: at < removed.count ? removed[at] : nil, new: at < added.count ? added[at] : nil))
    }

    removed.removeAll()
    added.removeAll()
  }

  for (row, side) in sides.enumerated() {
    switch side {
    case .old:
      // Note that a removed line after added ones starts a run of its own, since it stands below them in the diff.
      if !added.isEmpty { flush() }
      removed.append(row)
    case .new:
      added.append(row)
    case .both:
      flush()
      shown.append(.pair(old: row, new: row))
    case .neither:
      flush()
      shown.append(.single(row))
    }
  }

  flush()

  return shown
}
