// DiffPairsTests.swift -- a split diff pairs each removed line with the added line in its place, stands context on both halves, and runs a header or a thread's card across both.

import XCTest

@testable import DiffHighlight

final class DiffPairsTests: XCTestCase {
  // Note that the regression this catches is a split diff pairing a removed line with the wrong added one, or with a line of context.
  func testPairsRemovedRunsBesideTheAddedRunsAfterThem() {
    // A header, context, two removed, one added, a thread's card, then an added line alone.
    let sides: [DiffLine.Side] = [.neither, .both, .old, .old, .new, .neither, .new]

    XCTAssertEqual(
      displayRows(sides: sides, split: true),
      [
        .single(0),
        .pair(old: 1, new: 1),
        .pair(old: 2, new: 4),
        .pair(old: 3, new: nil),
        .single(5),
        .pair(old: nil, new: 6),
      ]
    )
  }

  func testAUnifiedDiffDrawsARowToALine() {
    XCTAssertEqual(displayRows(sides: [.old, .new], split: false), [.single(0), .single(1)])
  }
}
