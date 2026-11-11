// ShareSheet.swift -- the app's share sheet: what was shared, as a task's words to edit, the workspace and repository it starts in, and Start.
//
// It offers what New task offers, read from the snapshot the app left
// (`AppGroupFiles.swift`): the workspace the phone works in first, and the
// repositories a task in the picked one may start in, the one it starts in
// first. Start sends the task as New task does, under the access token the
// app keeps for it (`ShareStart.swift`), and once the task is made the sheet
// names it and posts a notification that opens it in the app
// (`ShareNotice.swift`). Where it can't, with no token, a
// stale one, or no answer, it keeps the words and picks as a draft, which the
// app opens New task on, prefilled, the next time it comes forward, since an
// extension can't bring its app forward itself. With no snapshot, the account
// signed out or the app never opened, the sheet says to open the app instead.

import SwiftUI

/// The sheet's words, as the app's New task says them.
private enum Words {
  static let title = "New task"
  static let placeholder = "Describe the task"
  static let workspace = "Workspace"
  static let repository = "Repository"
  static let start = "Start"
  static let cancel = "Cancel"
  static let done = "Done"
  static let starting = "Starting…"
  static let started = "Started. It's in Tasks in Vespin."
  static let startedNoticed = "Started. Tap its notification to open it in Vespin."
  static let agentRefused = "The task is in Vespin, but its agent didn't start. Open it in Vespin to start one."
  static let agentRefusedNoticed = "The task is in Vespin, but its agent didn't start. Tap its notification to open it and start one."
  static let kept = "Open Vespin to start it. New task opens with this draft."
  static let notKept = "This draft couldn't be saved. Try again, or copy it into Vespin."
  static let signedOut = "Open Vespin and sign in to start tasks from here."
}

/// What the sheet holds while it stands: the snapshot it offers, and the words and picks being made.
@MainActor
final class ShareSheetModel: ObservableObject {
  enum Standing {
    case drafting, starting, started, agentRefused, kept, notKept

    /// Whether the sheet is done with its words: the task made, or the draft kept for New task.
    var settled: Bool { self == .started || self == .agentRefused || self == .kept }
  }

  let snapshot: ShareSnapshot?
  @Published var prompt = ""
  @Published var workspaceId: String? {
    didSet { if workspaceId != oldValue { repository = workspace?.repositories.first } }
  }
  @Published var repository: String?
  /// True until what was shared is read into the words, while the field and Start wait on it.
  @Published var reading = true
  /// The one key every Start this sheet sends goes under, so a second press after an answer that never came is the same request.
  let idempotencyKey = UUID().uuidString
  @Published private(set) var standing = Standing.drafting
  /// The task Start made, once it made one.
  @Published private(set) var started: StartedTask?
  /// Whether the notification that opens the task was posted.
  @Published private(set) var noticed = false

  init(snapshot: ShareSnapshot?) {
    self.snapshot = snapshot
    let workspaces = snapshot?.workspaces ?? []
    let chosen = workspaces.first { $0.id == snapshot?.chosenWorkspaceId } ?? workspaces.first
    workspaceId = chosen?.id
    repository = chosen?.repositories.first
  }

  var workspace: ShareWorkspace? { snapshot?.workspaces.first { $0.id == workspaceId } }

  var words: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// Starts the task with the words and picks, or, where the service can't be reached with the app's token, keeps them for New task.
  func start() async {
    guard let snapshot, !words.isEmpty, standing != .starting else { return }
    let draft = ShareDraft(
      accountId: snapshot.accountId, prompt: words, workspaceId: workspaceId, repository: repository)
    if let service = snapshot.service, let token = ShareToken.read() {
      standing = .starting
      if case .started(let task) = await ShareStart.start(
        draft, service: service, token: token, idempotencyKey: idempotencyKey)
      {
        noticed = await ShareNotice.post(task)
        started = task
        standing = task.agentRefused ? .agentRefused : .started
        return
      }
    }
    standing = AppGroupFiles.keep(draft) ? .kept : .notKept
  }
}

struct ShareSheet: View {
  @StateObject var model: ShareSheetModel
  let items: [NSExtensionItem]
  let finish: () -> Void
  let cancel: () -> Void

  init(
    model: ShareSheetModel, items: [NSExtensionItem], finish: @escaping () -> Void,
    cancel: @escaping () -> Void
  ) {
    _model = StateObject(wrappedValue: model)
    self.items = items
    self.finish = finish
    self.cancel = cancel
  }

  var body: some View {
    NavigationStack {
      Form {
        if let snapshot = model.snapshot {
          draft(snapshot)
        } else {
          Section { Text(Words.signedOut).foregroundStyle(.secondary) }
        }
      }
      .navigationTitle(Words.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { toolbar }
    }
    .tint(Color("AccentColor"))
    .task {
      model.prompt = await SharedItems.words(of: items)
      model.reading = false
    }
  }

  @ViewBuilder private func draft(_ snapshot: ShareSnapshot) -> some View {
    if let started = model.started {
      Section {
        Label {
          Text(started.name ?? model.words).lineLimit(3)
        } icon: {
          Image(systemName: "checkmark.circle.fill").foregroundStyle(.secondary)
        }
      } footer: {
        Text(
          model.standing == .agentRefused
            ? (model.noticed ? Words.agentRefusedNoticed : Words.agentRefused)
            : (model.noticed ? Words.startedNoticed : Words.started))
      }
    } else {
      Section {
        TextField(Words.placeholder, text: $model.prompt, axis: .vertical)
          .lineLimit(4...12)
          .disabled(model.reading || model.standing == .starting || model.standing.settled)
      } footer: {
        switch model.standing {
        case .drafting, .started, .agentRefused: EmptyView()
        case .starting: Text(Words.starting)
        case .kept: Text(Words.kept)
        case .notKept: Text(Words.notKept).foregroundStyle(.red)
        }
      }
    }
    if !model.standing.settled {
      Section {
        if snapshot.workspaces.count > 1 {
          Picker(Words.workspace, selection: $model.workspaceId) {
            ForEach(snapshot.workspaces) { workspace in
              Text(workspace.name).tag(Optional(workspace.id))
            }
          }
        }
        if let repositories = model.workspace?.repositories, !repositories.isEmpty {
          Picker(Words.repository, selection: $model.repository) {
            ForEach(repositories, id: \.self) { repository in
              Text(repository).tag(Optional(repository))
            }
          }
        }
      }
      .disabled(model.standing == .starting)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if !model.standing.settled {
      ToolbarItem(placement: .cancellationAction) {
        Button(Words.cancel, action: cancel)
          .disabled(model.standing == .starting)
      }
      ToolbarItem(placement: .confirmationAction) {
        Button(Words.start) { Task { await model.start() } }
          .disabled(
            model.snapshot == nil || model.reading || model.standing == .starting
              || model.words.isEmpty)
      }
    } else {
      ToolbarItem(placement: .confirmationAction) {
        Button(Words.done, action: finish)
      }
    }
  }
}
