// NotificationViewController.swift -- the app's Notification Content Extension: a post's Markdown drawn formatted in the expanded notification a long press opens, with a decide's options as its buttons.
//
// A banner and the Lock Screen draw the alert's plain words, which the
// service says without marks (`packages/service/src/push/inbox-pushes.ts`).
// A long press opens this view instead of the system's: the thread's title
// over the post's Markdown, as the payload's `markdown` carries it, read by
// Foundation's own parser and laid out a block to a line as the app's
// renderer stands them (headings in semibold, list items led by their bullet
// or number, a quote beside its rule, code in the well in monospace, a
// table's cells on one line), its links in the ink. A push with no
// `markdown`, as an older service's or one whose first block passed Apple's
// bound, draws the alert's body as it stands, read as plain words.
//
// A decide's options become this notification's own buttons
// (`notificationActions`), named by each option's place, 0 first, which the
// app reads back (`@repo/features/inbox-push-wire`); each opens the app,
// which sends the option. Note that they are set here rather than by
// registering a category, since iOS keeps one set of actions per category
// and picks this view by the category's name, so every decide shares
// `inbox-decide`. A reply's typed answer is the app's registered category's
// own, and a press anywhere else opens the thread. `app.config.ts` adds this
// target to the project Expo generates.

import OSLog
import SwiftUI
import UIKit
import UserNotifications
import UserNotificationsUI

/// What the view logs of its own steps: counts and sizes only, never a post's words.
private let log = Logger(subsystem: "dev.vespin.ios.NotificationContent", category: "view")

/// One block of a post as the expanded notification lays it out.
struct PostBlock: Identifiable {
  enum Kind: Equatable {
    case paragraph
    case heading
    case item(String)
    case code
    case row(header: Bool)
  }

  let id: Int
  let kind: Kind
  /// How deep in lists it stands, 0 outside any.
  let depth: Int
  let quoted: Bool
  var words: AttributedString
}

/// A post's Markdown read into blocks, with Foundation's parser's own presentation intents.
enum PostMarkdown {
  /// What a table's cells are joined by, on one line.
  private static let cellBreak = AttributedString("  ·  ")

  static func blocks(_ markdown: String) -> [PostBlock] {
    let options = AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
    guard let parsed = try? AttributedString(markdown: markdown, options: options) else {
      return [PostBlock(id: 0, kind: .paragraph, depth: 0, quoted: false, words: AttributedString(markdown))]
    }
    var blocks: [PostBlock] = []
    var lastBlock: Int?
    var lastCell: Int?
    for run in parsed.runs {
      let components = run.presentationIntent?.components ?? []
      // Note that the components stand innermost first, so a run's block is its first that is not a table's cell.
      let cell = components.first { if case .tableCell = $0.kind { return true } else { return false } }?.identity
      let block = components.first { if case .tableCell = $0.kind { return false } else { return true } }?.identity
      let words = AttributedString(parsed[run.range])
      if let block, block == lastBlock, !blocks.isEmpty {
        if let cell, cell != lastCell { blocks[blocks.count - 1].words += cellBreak }
        blocks[blocks.count - 1].words += words
      } else {
        blocks.append(
          PostBlock(
            id: blocks.count, kind: kind(of: components),
            depth: components.filter { if case .listItem = $0.kind { return true } else { return false } }.count,
            quoted: components.contains { $0.kind == .blockQuote }, words: words))
      }
      lastBlock = block
      lastCell = cell
    }
    // Note that a rule or an empty block draws no words, so it stands as nothing.
    return blocks.filter { !$0.words.characters.isEmpty }.map { block in
      guard block.kind == .code else { return block }
      var code = block
      code.words = AttributedString(String(block.words.characters).trimmingCharacters(in: .newlines))
      return code
    }
  }

  /// A block's kind by its innermost intents: a list item's mark is its own list's bullet or number.
  private static func kind(of components: [PresentationIntent.IntentType]) -> PostBlock.Kind {
    for (place, component) in components.enumerated() {
      switch component.kind {
      case .header: return .heading
      case .codeBlock: return .code
      case .tableRow(let row): return .row(header: row == 0)
      case .tableHeaderRow: return .row(header: true)
      case .listItem(let ordinal):
        let ordered = components.dropFirst(place + 1).first {
          switch $0.kind {
          case .orderedList, .unorderedList: return true
          default: return false
          }
        }?.kind == .orderedList
        return .item(ordered ? "\(ordinal)." : "•")
      default: continue
      }
    }
    return .paragraph
  }
}

/// The expanded notification: the thread's title over the post's blocks, on the brand's ground.
struct PostView: View {
  let title: String
  let blocks: [PostBlock]
  /// Whether it fills the view from its top, as shown, rather than standing at its own height, as measured.
  var fills = false

  var body: some View {
    if fills {
      post.frame(maxHeight: .infinity, alignment: .top)
    } else {
      post
    }
  }

  private var post: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !title.isEmpty {
        Text(title).font(.headline).foregroundStyle(Color("Text"))
      }
      ForEach(blocks) { BlockView(block: $0) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
    .tint(Color("Text"))
  }
}

/// One block, as the app's renderer draws its kind.
struct BlockView: View {
  let block: PostBlock

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      if block.quoted {
        Rectangle().fill(Color("Edge")).frame(width: 3)
      }
      if case .item(let mark) = block.kind {
        Text(mark).foregroundStyle(Color("TextMuted")).monospacedDigit()
      }
      words
    }
    .padding(.leading, CGFloat(max(block.depth - 1, 0)) * 16)
    .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder private var words: some View {
    switch block.kind {
    case .heading:
      Text(block.words).font(.subheadline.weight(.semibold)).foregroundStyle(Color("Text"))
    case .code:
      Text(block.words).font(.footnote.monospaced()).foregroundStyle(Color("Text"))
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color("Well"), in: RoundedRectangle(cornerRadius: 6))
    case .row(let header):
      Text(block.words).font(.subheadline.weight(header ? .semibold : .regular))
        .foregroundStyle(Color("Text"))
    default:
      Text(block.words).font(.subheadline)
        .foregroundStyle(block.quoted ? Color("TextMuted") : Color("Text"))
    }
  }
}

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
  /// The category a decide push names (`PUSH_CATEGORY.DECIDE`).
  private static let decideCategory = "inbox-decide"

  private let host = UIHostingController(rootView: PostView(title: "", blocks: [], fills: true))
  /// What the view shows, measured afresh at each width.
  private var shown = PostView(title: "", blocks: [])

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(named: "Ground")
    host.view.backgroundColor = .clear
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    log.notice("loaded at \(self.view.bounds.width, privacy: .public)×\(self.view.bounds.height, privacy: .public)")
  }

  func didReceive(_ notification: UNNotification) {
    let content = notification.request.content
    shown = PostView(title: content.title, blocks: Self.blocks(of: content))
    log.notice(
      "received \(content.categoryIdentifier, privacy: .public) with \(self.shown.blocks.count, privacy: .public) blocks, markdown \(content.userInfo["markdown"] != nil, privacy: .public)"
    )
    host.rootView = PostView(title: shown.title, blocks: shown.blocks, fills: true)
    if content.categoryIdentifier == Self.decideCategory,
      let options = content.userInfo["options"] as? [String], !options.isEmpty
    {
      extensionContext?.notificationActions = options.enumerated().map { place, label in
        UNNotificationAction(identifier: String(place), title: label, options: [.foreground])
      }
    }
    fit()
  }

  /// The post's blocks: its Markdown where the push carries it, else the alert's body as one paragraph, its words as said.
  private static func blocks(of content: UNNotificationContent) -> [PostBlock] {
    if let markdown = content.userInfo["markdown"] as? String {
      return PostMarkdown.blocks(markdown)
    }
    // Note that the body is plain text, never read as Markdown, since a bracket or star in it is a word the post said.
    return [PostBlock(id: 0, kind: .paragraph, depth: 0, quoted: false, words: AttributedString(content.body))]
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    fit()
  }

  /// Asks for the height the post takes at the view's width, so the expanded notification stands as tall as its words; iOS caps it at the screen, and the words past it are cut at the foot.
  private func fit() {
    let width = view.bounds.width
    guard width > 0 else { return }
    let measure = UIHostingController(rootView: shown)
    let height = measure.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
    guard abs(preferredContentSize.height - height) > 0.5 else { return }
    log.notice("fits \(self.shown.blocks.count, privacy: .public) blocks at \(width, privacy: .public)×\(height, privacy: .public)")
    preferredContentSize = CGSize(width: width, height: height)
  }
}
