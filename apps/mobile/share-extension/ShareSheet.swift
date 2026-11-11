// ShareSheet.swift -- the app's share sheet: what was shared, as a task's words to edit, the workspace and repository it starts in, and Start.
//
// It offers what New task offers, read from the snapshot the app left
// (`AppGroupFiles.swift`): the workspace the phone works in first, and the
// repositories a task in the picked one may start in, the one it starts in
// first. Start keeps the words and picks as a draft, which the app opens New
// task on, prefilled, the next time it comes forward, since an extension can
// neither start the task with the app's host nor bring the app forward
// itself. With no snapshot, the account signed out or the app never opened,
// the sheet says to open the app instead.

import SwiftUI

/// The sheet's words, as the app's New task says them.
private enum Words {
  static let title = "New task"
  static let placeholder = "Describe the task"
  static let workspace = "Workspace"
  static let repository = "Repository"
  static let noRepository = "None"
  static let start = "Start"
  static let cancel = "Cancel"
  static let done = "Done"
  static let kept = "Open Vespin to start it. New task opens with this draft."
  static let notKept = "This draft couldn't be saved. Try again, or copy it into Vespin."
  static let signedOut = "Open Vespin and sign in to start tasks from here."
}

/// What the sheet holds while it stands: the snapshot it offers, and the words and picks being made.
@MainActor
final class ShareSheetModel: ObservableObject {
  enum Standing { case drafting, kept, notKept }

  let snapshot: ShareSnapshot?
  @Published var prompt = ""
  @Published var workspaceId: String? {
    didSet { if workspaceId != oldValue { repository = workspace?.repositories.first } }
  }
  @Published var repository: String?
  @Published private(set) var standing = Standing.drafting

  init(snapshot: ShareSnapshot?) {
    self.snapshot = snapshot
    let workspaces = snapshot?.workspaces ?? []
    let chosen = workspaces.first { $0.id == snapshot?.chosenWorkspaceId } ?? workspaces.first
    workspaceId = chosen?.id
    repository = chosen?.repositories.first
  }

  var workspace: ShareWorkspace? { snapshot?.workspaces.first { $0.id == workspaceId } }

  var words: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// Keeps the words and picks for New task.
  func start() {
    guard let snapshot, !words.isEmpty else { return }
    let draft = ShareDraft(
      accountId: snapshot.accountId, prompt: words, workspaceId: workspaceId, repository: repository)
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
      let shared = await SharedItems.words(of: items)
      if model.prompt.isEmpty { model.prompt = shared }
    }
  }

  @ViewBuilder private func draft(_ snapshot: ShareSnapshot) -> some View {
    Section {
      TextField(Words.placeholder, text: $model.prompt, axis: .vertical)
        .lineLimit(4...12)
        .disabled(model.standing == .kept)
    } footer: {
      switch model.standing {
      case .drafting: EmptyView()
      case .kept: Text(Words.kept)
      case .notKept: Text(Words.notKept).foregroundStyle(.red)
      }
    }
    if model.standing != .kept {
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
            Text(Words.noRepository).tag(String?.none)
          }
        }
      }
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if model.standing != .kept {
      ToolbarItem(placement: .cancellationAction) {
        Button(Words.cancel, action: cancel)
      }
      ToolbarItem(placement: .confirmationAction) {
        Button(Words.start, action: model.start)
          .disabled(model.snapshot == nil || model.words.isEmpty)
      }
    } else {
      ToolbarItem(placement: .confirmationAction) {
        Button(Words.done, action: finish)
      }
    }
  }
}
