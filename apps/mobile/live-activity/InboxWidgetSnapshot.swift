// InboxWidgetSnapshot.swift -- what the Inbox widget draws, as the app keeps it in the App Group it shares with the widget extension and the Notification Service Extension: read, and moved by an alert push while the app is closed.
//
// The app writes it whenever its Inbox moves (`src/inbox-widget/`), as the
// JSON `@repo/features/inbox-widget-model` encodes, whose keys this type
// decodes exactly, into `inbox-widget.json` at the group container's root
// (`src/app-group.ts`). The widget reads it and draws nothing else, since it
// has no account and no network. The widget extension and the Notification
// Service Extension each build this file: `app.config.ts` copies it beside
// their Swift. The group is read from each target's Info.plist
// (`VespinAppGroup`), which `app.config.ts` writes from its `APP_GROUP`, so
// it is spelled once.
//
// An alert's badge is the account's whole count, so it is the snapshot's
// count only where the chosen workspace is the account's only one
// (`wholeAccount`); elsewhere a push moves only a thread whose id the
// snapshot already holds (`ids`, every thread that waits), since nothing in
// the push says which workspace its thread is in.

import Foundation
import WidgetKit

struct InboxWidgetSnapshot: Codable, Equatable {
  /// One thread that waits on the member: its id, which a tap opens, its title, its task's name, and the ask that waits, none for a notice.
  struct Row: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var task: String
    var ask: String?
  }

  /// The chosen workspace's name.
  var workspace: String
  /// How many threads wait on the member in it.
  var waiting: Int
  /// Whether the workspace is the account's only one, so a push's badge is its count.
  var wholeAccount: Bool
  /// The ids of the threads that wait, so a push can tell this workspace's thread past the rows shown.
  var ids: [String]
  /// The newest of them, at most `maxRows`.
  var rows: [Row]

  /// The widget's kind, which a reload names; the app's module names it too (`LiveActivityModule.swift`).
  static let kind = "InboxWidget"
  /// The most rows kept: the medium widget's three.
  static let maxRows = 3
  /// The most ids kept, and the longest title in UTF-16 units, as `@repo/features/inbox-widget-model` bounds them, so the app still reads what a push wrote.
  static let maxIds = 100
  static let maxTitleUnits = 80
  /// The file's name in the group container (`APP_GROUP_FILE.INBOX_WIDGET`).
  private static let fileName = "inbox-widget.json"

  /// The file, or none in a build whose Info.plist names no group, or that holds no entitlement to it.
  private static var file: URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "VespinAppGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent(fileName)
  }

  /// The snapshot kept, or none before the app wrote one or after a sign-out.
  static func read() -> InboxWidgetSnapshot? {
    guard let file, let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode(Self.self, from: data)
  }

  /// Keeps the snapshot and has the widget draw it again, unless it is the one kept already.
  func save() {
    guard let file = Self.file, Self.read() != self, let data = try? JSONEncoder().encode(self)
    else { return }
    try? data.write(to: file, options: .atomic)
    WidgetCenter.shared.reloadTimelines(ofKind: Self.kind)
  }

  /// The snapshot once a push tells of a post on the thread `id`, which waits on the member: its row on top, saying the push's ask, and the badge as the count where it is the workspace's.
  func taking(news id: String, title: String?, ask: String?, badge: Int?) -> InboxWidgetSnapshot {
    var next = self
    if wholeAccount, let badge { next.waiting = max(0, badge) }
    let known = rows.first { $0.id == id }
    // A thread the snapshot never held may be another workspace's, unless this is the account's only one.
    guard wholeAccount || ids.contains(id) else { return next }
    let row = Row(
      id: id, title: Self.clipped(title ?? known?.title ?? ""), task: known?.task ?? "", ask: ask)
    next.ids = Array(([id] + ids.filter { $0 != id }).prefix(Self.maxIds))
    next.rows = Array(
      ([row] + rows.filter { $0.id != id }).prefix(min(Self.maxRows, next.waiting)))
    return next
  }

  /// Words cut to `maxTitleUnits` UTF-16 units, as the app's schema counts them, never splitting a character.
  private static func clipped(_ words: String) -> String {
    var units = 0
    return String(
      words.prefix { character in
        units += character.utf16.count
        return units <= maxTitleUnits
      })
  }
}
