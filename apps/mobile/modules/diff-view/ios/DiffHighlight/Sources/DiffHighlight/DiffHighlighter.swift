// DiffHighlighter.swift -- a diff's rows colored by tree-sitter: each side of the diff parsed whole in its language, the grammar's own highlight query run over it, and each row handed the runs of color that fall on it.
//
// A diff's rows stand on two sides: a removed row on the old side, an added
// row on the new, and a row of context on both. Each side is put together as
// one text, its rows in order, and parsed in the file's language, so a row
// is colored as the code around it reads rather than as a line alone; a gap
// between hunks leaves the parse a little wrong there, which tree-sitter
// recovers from. The grammar's own `highlights.scm` names each node it
// colors (`keyword`, `string`, `function.method`); those names are read into
// the few styles a GitHub theme colors (`SyntaxStyle`), and every other name
// is left plain. Where captures overlap, the one spanning less is drawn over
// the one spanning more, and of two over the same text the later pattern
// wins, as the grammars' queries are written: generic patterns first, the
// specific after them.
//
// Nothing here draws. The runs are offsets in UTF-16 units into each row's
// own words, which a view lays over its text; a row of a side whose language
// is unknown, or a hunk's header, has none. Coloring a side is all CPU and
// touches no UI, so a view runs it off the main thread.

import Foundation
import SwiftTreeSitter
import TreeSitterBash
import TreeSitterCSS
import TreeSitterGo
import TreeSitterHTML
import TreeSitterJavaScript
import TreeSitterJSON
import TreeSitterMarkdown
import TreeSitterPython
import TreeSitterRust
import TreeSitterSql
import TreeSitterSwift
import TreeSitterTSX
import TreeSitterTypeScript
import TreeSitterYAML

// MARK: - Languages

/// The languages a diff is colored in, the ones Vespin's repositories hold most; every other file is drawn plain.
public enum DiffLanguage: String, CaseIterable, Sendable {
  case bash, css, go, html, javascript, json, markdown, python, rust, sql, swift, tsx, typescript, yaml

  /// The language a file's path names by its extension, or none for a file drawn plain.
  public init?(path: String) {
    let name = (path as NSString).lastPathComponent.lowercased()
    let ext = (name as NSString).pathExtension

    guard let language = DiffLanguage.byExtension[ext] else { return nil }
    self = language
  }

  private static let byExtension: [String: DiffLanguage] = [
    "sh": .bash, "bash": .bash, "zsh": .bash,
    "css": .css,
    "go": .go,
    "html": .html, "htm": .html,
    "js": .javascript, "mjs": .javascript, "cjs": .javascript, "jsx": .javascript,
    "json": .json,
    "md": .markdown, "markdown": .markdown,
    "py": .python,
    "rs": .rust,
    "sql": .sql,
    "swift": .swift,
    "tsx": .tsx,
    "ts": .typescript, "mts": .typescript, "cts": .typescript,
    "yml": .yaml, "yaml": .yaml,
  ]

  /// The grammar the language is parsed with.
  var grammar: Language {
    switch self {
    case .bash: return Language(language: tree_sitter_bash())
    case .css: return Language(language: tree_sitter_css())
    case .go: return Language(language: tree_sitter_go())
    case .html: return Language(language: tree_sitter_html())
    case .javascript: return Language(language: tree_sitter_javascript())
    case .json: return Language(language: tree_sitter_json())
    case .markdown: return Language(language: tree_sitter_markdown())
    case .python: return Language(language: tree_sitter_python())
    case .rust: return Language(language: tree_sitter_rust())
    case .sql: return Language(language: tree_sitter_sql())
    case .swift: return Language(language: tree_sitter_swift())
    case .tsx: return Language(language: tree_sitter_tsx())
    case .typescript: return Language(language: tree_sitter_typescript())
    case .yaml: return Language(language: tree_sitter_yaml())
    }
  }

  /// The query files the language's highlights are read from, in order: TypeScript's builds on JavaScript's, and JSX adds its own, as their grammars' own queries are meant to be read.
  var queryFiles: [String] {
    switch self {
    case .javascript: return ["javascript", "jsx"]
    case .typescript: return ["javascript", "typescript"]
    case .tsx: return ["javascript", "jsx", "typescript"]
    default: return [rawValue]
    }
  }
}

// MARK: - Styles

/// The styles a diff's words are colored in, the ones GitHub's light and dark themes color code with; the view holds each one's color.
public enum SyntaxStyle: UInt8, CaseIterable, Sendable {
  case keyword, string, comment, function, type, constant, property, tag, heading

  /// The style a highlight query's capture names, read by its first component and a few of its second, or none for a name drawn plain, such as `variable` or `punctuation`.
  public init?(capture name: String) {
    let parts = name.split(separator: ".")

    guard let first = parts.first else { return nil }

    switch first {
    case "keyword", "conditional", "repeat", "include", "exception", "storageclass":
      self = .keyword
    case "string", "character", "escape":
      self = .string
    case "comment":
      self = .comment
    case "function", "method", "constructor":
      self = .function
    case "type":
      self = parts.count > 1 && parts[1] == "builtin" ? .keyword : .type
    case "number", "boolean", "constant", "float":
      self = .constant
    case "property", "attribute", "field":
      self = .property
    case "tag":
      self = .tag
    case "text", "markup":
      guard let second = parts.dropFirst().first else { return nil }

      switch second {
      case "title", "heading": self = .heading
      case "literal", "raw", "uri", "link": self = .string
      default: return nil
      }
    case "variable":
      guard parts.count > 1, parts[1] == "builtin" else { return nil }
      self = .constant
    default:
      return nil
    }
  }
}

/// A run of one style over a row's words, in UTF-16 units from the row's start.
public struct ColorRun: Equatable, Sendable {
  public let start: Int
  public let length: Int
  public let style: SyntaxStyle

  public init(start: Int, length: Int, style: SyntaxStyle) {
    self.start = start
    self.length = length
    self.style = style
  }
}

/// One row of a diff as the highlighter takes it: its words, and the sides it stands on.
public struct DiffLine: Sendable {
  public enum Side: Sendable { case old, new, both, neither }

  public let text: String
  public let side: Side

  public init(text: String, side: Side) {
    self.text = text
    self.side = side
  }
}

// MARK: - The highlighter

/// Colors a diff's rows, each language's query compiled once and kept, a side at a time; safe to call from any one queue at a time.
public final class DiffHighlighter: @unchecked Sendable {
  private let queryText: (String) -> String?
  private var queries: [DiffLanguage: Query] = [:]
  private let lock = NSLock()

  /// A highlighter whose query files, by name without `.scm`, are read through `queryText`.
  public init(queryText: @escaping (String) -> String?) {
    self.queryText = queryText
  }

  /// Each row's runs of color, in the rows' order; none for every row where the language's query could not be read.
  public func runs(for lines: [DiffLine], in language: DiffLanguage) -> [[ColorRun]] {
    var runs = [[ColorRun]](repeating: [], count: lines.count)

    guard let query = query(for: language) else { return runs }

    // Note that a row of context stands on both sides and takes its colors from the new one, as the diff draws it there; the old side colors its removed rows alone.
    let old = lines.indices.filter { lines[$0].side == .old || lines[$0].side == .both }
    let new = lines.indices.filter { lines[$0].side == .new || lines[$0].side == .both }

    if old.contains(where: { lines[$0].side == .old }) {
      for (row, rowRuns) in colorSide(old.map { lines[$0].text }, language: language, query: query)
      where lines[old[row]].side == .old {
        runs[old[row]] = rowRuns
      }
    }

    if !new.isEmpty {
      for (row, rowRuns) in colorSide(new.map { lines[$0].text }, language: language, query: query) {
        runs[new[row]] = rowRuns
      }
    }

    return runs
  }

  /// The language's highlight query, compiled the first time it is asked for, or none where its files could not be read or compiled.
  private func query(for language: DiffLanguage) -> Query? {
    lock.lock()
    defer { lock.unlock() }

    if let held = queries[language] { return held }

    let text = language.queryFiles.compactMap(queryText).joined(separator: "\n")

    guard !text.isEmpty, let compiled = try? Query(language: language.grammar, data: Data(text.utf8)) else {
      return nil
    }

    queries[language] = compiled

    return compiled
  }

  /// One side's rows colored: the rows joined into one text, parsed, the query's captures painted onto it, and each row's runs read back off it, by the row's place among `texts`.
  private func colorSide(_ texts: [String], language: DiffLanguage, query: Query) -> [(Int, [ColorRun])] {
    var starts = [Int]()
    starts.reserveCapacity(texts.count)
    var length = 0

    for text in texts {
      starts.append(length)
      length += text.utf16.count + 1
    }

    let source = texts.joined(separator: "\n")
    let parser = Parser()

    guard (try? parser.setLanguage(language.grammar)) != nil, let tree = parser.parse(source) else { return [] }

    let context = Predicate.Context(string: source)
    var painted = [(range: NSRange, pattern: Int, style: SyntaxStyle)]()

    for match in query.execute(in: tree) where match.allowed(in: context) {
      for capture in match.captures {
        guard let name = capture.name, let style = SyntaxStyle(capture: name) else { continue }
        painted.append((capture.range, match.patternIndex, style))
      }
    }

    // Note that the wider captures are painted first and the narrower over them, and of two over the same text the later pattern last, so it stands.
    painted.sort { a, b in
      a.range.length != b.range.length ? a.range.length > b.range.length : a.pattern < b.pattern
    }

    var styles = [UInt8](repeating: UInt8.max, count: max(source.utf16.count, 0))

    for paint in painted {
      let lower = max(paint.range.location, 0)
      let upper = min(paint.range.location + paint.range.length, styles.count)

      guard lower < upper else { continue }
      for unit in lower..<upper { styles[unit] = paint.style.rawValue }
    }

    return texts.indices.map { row in (row, runsOf(styles, from: starts[row], length: texts[row].utf16.count)) }
  }

  /// The runs of one style each over a row's units, from `start`, `length` long.
  private func runsOf(_ styles: [UInt8], from start: Int, length: Int) -> [ColorRun] {
    var runs = [ColorRun]()
    var at = 0

    while at < length {
      let style = styles[start + at]
      var end = at + 1
      while end < length, styles[start + end] == style { end += 1 }

      if let kind = SyntaxStyle(rawValue: style) { runs.append(ColorRun(start: at, length: end - at, style: kind)) }
      at = end
    }

    return runs
  }
}

#if SWIFT_PACKAGE
  extension DiffHighlighter {
    /// A highlighter reading the queries this package carries, as its tests use it.
    public static func packaged() -> DiffHighlighter {
      DiffHighlighter { name in
        Bundle.module.url(forResource: name, withExtension: "scm", subdirectory: "queries")
          .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
      }
    }
  }
#endif
