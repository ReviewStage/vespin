// InboxWidget.swift -- the Inbox widget: how many threads wait on the member in the chosen workspace, and the newest of them, on the Home Screen and the Lock Screen.
//
// It draws only the snapshot the app keeps in the App Group
// (`InboxWidgetSnapshot.swift`), which the app writes whenever its Inbox
// moves and the Notification Service Extension moves on a push, each then
// asking WidgetKit to draw it again, so its timeline holds one entry and
// never asks on its own. The small and Lock Screen sizes open the Inbox; the
// medium's rows each open their thread, and the rest of it the Inbox, by the
// app's own `vespin://` routes. Copper (`Attention`) marks only what wants
// the member: the count while any waits, and each ask's glyph. Rows are
// privacy-sensitive, so iOS redacts them on a locked phone as the member's
// settings say. The colors are the brand's, written into this target's
// asset catalog by `app.config.ts`, with Lucide's Split for a decide, as the
// app's Inbox row draws it. Every size has a preview at the end of the file.

import SwiftUI
import WidgetKit

struct InboxWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: InboxWidgetSnapshot.kind, provider: InboxTimeline()) { entry in
      InboxWidgetView(snapshot: entry.snapshot)
    }
    .configurationDisplayName("Inbox")
    .description("What's waiting on you in Vespin.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

// MARK: - Timeline

struct InboxEntry: TimelineEntry {
  let date: Date
  /// The snapshot kept, or none while no account is signed in.
  let snapshot: InboxWidgetSnapshot?
}

/// One entry, the snapshot as it stands; the app and the push reload the widget whenever it moves.
struct InboxTimeline: TimelineProvider {
  func placeholder(in context: Context) -> InboxEntry {
    InboxEntry(date: .now, snapshot: .sample)
  }

  // The widget gallery draws the member's own Inbox, or the sample before the app wrote one.
  func getSnapshot(in context: Context, completion: @escaping (InboxEntry) -> Void) {
    let kept = InboxWidgetSnapshot.read()
    completion(InboxEntry(date: .now, snapshot: context.isPreview ? kept ?? .sample : kept))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<InboxEntry>) -> Void) {
    let entry = InboxEntry(date: .now, snapshot: InboxWidgetSnapshot.read())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

// MARK: - Sizes

struct InboxWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let snapshot: InboxWidgetSnapshot?

  var body: some View {
    content
      .widgetURL(InboxRoute.inbox)
      .containerBackground(for: .widget) { background }
  }

  @ViewBuilder private var content: some View {
    switch family {
    case .systemMedium: MediumInbox(snapshot: snapshot)
    case .accessoryCircular: CircularInbox(snapshot: snapshot)
    case .accessoryRectangular: RectangularInbox(snapshot: snapshot)
    case .accessoryInline:
      Label { Text(snapshot?.countText ?? "Vespin") } icon: { Image("Inbox") }
    default: SmallInbox(snapshot: snapshot)
    }
  }

  /// The brand's ground on the Home Screen, the system's own behind the Lock Screen's circle, and none beside.
  @ViewBuilder private var background: some View {
    switch family {
    case .systemSmall, .systemMedium: Color("Ground")
    case .accessoryCircular: AccessoryWidgetBackground()
    default: Color.clear
    }
  }
}

/// The small size: the count, what it counts, and the newest thread's title.
struct SmallInbox: View {
  let snapshot: InboxWidgetSnapshot?

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      InboxHeading(snapshot: snapshot, inline: false)
      Spacer(minLength: 4)
      if let snapshot {
        CountFigure(waiting: snapshot.waiting)
        Text("waiting on you")
          .font(.caption)
          .foregroundStyle(Color("TextMuted"))
          .lineLimit(1)
        if let row = snapshot.rows.first {
          InboxRowLine(row: row, compact: true).padding(.top, 4)
        }
      } else {
        SignedOutLine()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// The medium size: the heading and the count over up to three threads, each opening its own.
struct MediumInbox: View {
  let snapshot: InboxWidgetSnapshot?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        InboxHeading(snapshot: snapshot, inline: true)
        Spacer(minLength: 8)
        if let snapshot, snapshot.waiting > 0 {
          Text(snapshot.countText)
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(Color("Attention"))
            .widgetAccentable()
            .lineLimit(1)
        }
      }
      if let snapshot {
        if snapshot.waiting == 0 {
          Spacer(minLength: 0)
          Text("Nothing waiting on you")
            .font(.subheadline)
            .foregroundStyle(Color("TextMuted"))
            .frame(maxWidth: .infinity)
        }
        ForEach(snapshot.rows) { row in
          Link(destination: InboxRoute.thread(row.id)) {
            InboxRowLine(row: row, compact: false)
          }
        }
      } else {
        Spacer(minLength: 0)
        SignedOutLine().frame(maxWidth: .infinity)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// The Lock Screen's circle: the Inbox's glyph over the count.
struct CircularInbox: View {
  let snapshot: InboxWidgetSnapshot?

  var body: some View {
    VStack(spacing: 0) {
      Image("Inbox").font(.caption)
      Text(snapshot.map { "\($0.waiting)" } ?? "–")
        .font(.title2.weight(.semibold))
        .monospacedDigit()
        .widgetAccentable()
        .minimumScaleFactor(0.6)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(snapshot?.countText ?? "Vespin")
  }
}

/// The Lock Screen's rectangle: the count, and the newest thread's title under it.
struct RectangularInbox: View {
  let snapshot: InboxWidgetSnapshot?

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Label { Text(snapshot?.countText ?? "Vespin") } icon: { Image("Inbox") }
        .font(.headline)
        .widgetAccentable()
        .lineLimit(1)
      if let row = snapshot?.rows.first {
        Text(row.title).font(.caption).lineLimit(2).privacySensitive()
      } else if let snapshot {
        Text(snapshot.workspace).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Parts

/// "Inbox", with the chosen workspace's name small under it, or beside it on one line.
struct InboxHeading: View {
  let snapshot: InboxWidgetSnapshot?
  let inline: Bool

  var body: some View {
    let layout = inline
      ? AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 6))
      : AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
    layout {
      Label { Text("Inbox") } icon: { Image("Inbox") }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Color("Text"))
        .lineLimit(1)
      if let workspace = snapshot?.workspace, !workspace.isEmpty {
        Text(workspace)
          .font(.caption2)
          .foregroundStyle(Color("TextMuted"))
          .lineLimit(1)
      }
    }
  }
}

/// The count, large, in copper while anything waits.
struct CountFigure: View {
  let waiting: Int

  var body: some View {
    Text("\(waiting)")
      .font(.largeTitle.weight(.semibold))
      .monospacedDigit()
      .foregroundStyle(Color(waiting > 0 ? "Attention" : "TextMuted"))
      .widgetAccentable()
      .contentTransition(.numericText())
  }
}

/// One thread: the ask's glyph and its title, and, on a medium row, its task's name trailing on the same line.
struct InboxRowLine: View {
  let row: InboxWidgetSnapshot.Row
  let compact: Bool

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      AskGlyph(ask: row.ask).frame(width: 14)
      Text(row.title)
        .font(compact ? .caption.weight(.medium) : .subheadline.weight(.medium))
        .foregroundStyle(Color("Text"))
        .lineLimit(compact ? 2 : 1)
        .layoutPriority(1)
      Spacer(minLength: 4)
      if !compact, !row.task.isEmpty {
        Text(row.task).font(.caption).foregroundStyle(Color("TextMuted")).lineLimit(1)
      }
    }
    .privacySensitive()
  }
}

/// The glyph the app's Inbox row leads an ask with, in copper; a notice leads with none.
struct AskGlyph: View {
  let ask: String?

  var body: some View {
    Group {
      switch ask {
      case "decide": Image("Split")
      case "do": Image("SquareCheck")
      case "answer": Image("PenLine")
      default: Color.clear.frame(width: 1, height: 1)
      }
    }
    .font(.caption)
    .foregroundStyle(Color("Attention"))
    .widgetAccentable()
  }
}

/// What the widget says while no account is signed in on the phone.
struct SignedOutLine: View {
  var body: some View {
    Text("Open Vespin to sign in")
      .font(.caption)
      .foregroundStyle(Color("TextMuted"))
      .lineLimit(2)
  }
}

// MARK: - Words and routes

extension InboxWidgetSnapshot {
  /// The count in words, as the Lock Screen says it.
  var countText: String { waiting > 0 ? "\(waiting) waiting on you" : "Nothing waiting on you" }
}

/// The app's routes the widget opens: the Inbox, and a thread on it.
enum InboxRoute {
  static let inbox = URL(string: "vespin://inbox")!

  static func thread(_ id: String) -> URL {
    var components = URLComponents()
    components.scheme = "vespin"
    components.host = "inbox"
    components.path = "/\(id)"
    return components.url ?? inbox
  }
}

// MARK: - Previews

extension InboxWidgetSnapshot {
  /// What the gallery and the previews draw before the app wrote a snapshot.
  static let sample = InboxWidgetSnapshot(
    workspace: "Acme",
    waiting: 3,
    wholeAccount: true,
    ids: ["s1", "s2", "s3"],
    rows: [
      .init(id: "s1", title: "Ship the flag today?", task: "Fix the token refresh", ask: "decide"),
      .init(id: "s2", title: "Add the Sentry secret", task: "Resend expired invites", ask: "do"),
      .init(id: "s3", title: "Opened the pull request", task: "Add Live Activities", ask: nil),
    ])
  fileprivate static let clear = InboxWidgetSnapshot(
    workspace: "Acme", waiting: 0, wholeAccount: true, ids: [], rows: [])
}

#Preview("Small", as: .systemSmall) {
  InboxWidget()
} timeline: {
  InboxEntry(date: .now, snapshot: .sample)
  InboxEntry(date: .now, snapshot: .clear)
  InboxEntry(date: .now, snapshot: nil)
}

#Preview("Medium", as: .systemMedium) {
  InboxWidget()
} timeline: {
  InboxEntry(date: .now, snapshot: .sample)
  InboxEntry(date: .now, snapshot: .clear)
}

#Preview("Circular", as: .accessoryCircular) {
  InboxWidget()
} timeline: {
  InboxEntry(date: .now, snapshot: .sample)
}

#Preview("Rectangular", as: .accessoryRectangular) {
  InboxWidget()
} timeline: {
  InboxEntry(date: .now, snapshot: .sample)
}

#Preview("Inline", as: .accessoryInline) {
  InboxWidget()
} timeline: {
  InboxEntry(date: .now, snapshot: .sample)
}
