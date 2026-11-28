// DiffHighlighterTests.swift -- a diff's rows colored by their grammar: every language's query compiles against its grammar, a row takes the colors of the side it stands on, and a file whose language is unknown stays plain.

import XCTest

@testable import DiffHighlight

final class DiffHighlighterTests: XCTestCase {
  private let highlighter = DiffHighlighter.packaged()

  /// The words a row's runs of `style` cover.
  private func words(_ runs: [ColorRun], of style: SyntaxStyle, in text: String) -> [String] {
    let units = Array(text.utf16)

    return runs.filter { $0.style == style }.map {
      String(decoding: units[$0.start..<($0.start + $0.length)], as: UTF16.self)
    }
  }

  // Note that the regression this catches is a grammar bumped past its vendored query, whose node names then fail to compile, leaving that language plain.
  func testEveryLanguageQueryCompilesAndColorsSomething() {
    let samples: [DiffLanguage: String] = [
      .bash: "if true; then echo \"hi\"; fi",
      .css: "a { color: red; }",
      .go: "func main() { return }",
      .html: "<div class=\"a\">hi</div>",
      .javascript: "const a = \"hi\";",
      .json: "{\"a\": 1}",
      .markdown: "# Title",
      .python: "def f():\n    return \"hi\"",
      .rust: "fn main() { let a = 1; }",
      .swift: "func f() -> String { return \"hi\" }",
      .tsx: "const a: number = <div>hi</div>;",
      .typescript: "const a: number = 1;",
      .yaml: "a: \"hi\"",
    ]

    for language in DiffLanguage.allCases {
      let text = samples[language] ?? ""
      let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map {
        DiffLine(text: String($0), side: .new)
      }
      let colored = highlighter.runs(for: lines, in: language).flatMap { $0 }

      XCTAssertFalse(colored.isEmpty, "\(language) colored nothing")
    }
  }

  // Note that the regression this catches is a removed row colored from the new side, where it does not stand, or a context row colored twice.
  func testARowTakesTheColorsOfTheSideItStandsOn() {
    let lines = [
      DiffLine(text: "def greet():", side: .both),
      DiffLine(text: "    return \"old\"", side: .old),
      DiffLine(text: "    return 42", side: .new),
    ]

    let runs = highlighter.runs(for: lines, in: .python)

    XCTAssertEqual(words(runs[0], of: .keyword, in: lines[0].text), ["def"])
    XCTAssertEqual(words(runs[0], of: .function, in: lines[0].text), ["greet"])
    XCTAssertEqual(words(runs[1], of: .string, in: lines[1].text), ["\"old\""])
    XCTAssertEqual(words(runs[2], of: .constant, in: lines[2].text), ["42"])
  }

  func testAHunkHeaderStaysPlain() {
    let lines = [
      DiffLine(text: "@@ -1,1 +1,1 @@ def f():", side: .neither),
      DiffLine(text: "x = 1", side: .both),
    ]

    XCTAssertEqual(highlighter.runs(for: lines, in: .python)[0], [])
  }

  func testALanguageIsNamedByItsFileExtension() {
    XCTAssertEqual(DiffLanguage(path: "apps/web/src/page.tsx"), .tsx)
    XCTAssertEqual(DiffLanguage(path: ".github/workflows/ci.yml"), .yaml)
    XCTAssertEqual(DiffLanguage(path: "ios/Module.swift"), .swift)
    XCTAssertNil(DiffLanguage(path: "Makefile"))
    XCTAssertNil(DiffLanguage(path: "src/main.kt"))
  }

  // Note that this prints how long a 5,000-row diff takes to color, which the Mac job reports beside the view's first frame; it asserts nothing about time.
  func testColorsALongDiffAndSaysHowLong() {
    // The rows of the Inbox fixture's generated table, as the app's timing flow opens it.
    let lines =
      [DiffLine(text: "export const INVITE_MESSAGES = {", side: .new)]
      + (0..<4_998).map { DiffLine(text: "  invite\($0): \"Invitation \($0) is waiting for you\",", side: .new) }
      + [DiffLine(text: "} as const;", side: .new)]
    let started = Date()
    let runs = highlighter.runs(for: lines, in: .typescript)

    print(String(format: "DiffHighlight 5000 rows: %.1f ms", Date().timeIntervalSince(started) * 1000))
    XCTAssertEqual(runs.count, 5_000)
  }
}
