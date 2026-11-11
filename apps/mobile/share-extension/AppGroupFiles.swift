// AppGroupFiles.swift -- the share extension's side of the files it shares with the app through their App Group: the snapshot it reads and the draft it keeps.
//
// The app writes the snapshot, with where Start is sent, whenever it changes, and
// opens New task on the draft the next time it comes forward, then removes
// it (`src/share-sheet.ts`, `@repo/features/ios-share-wire`). The group is
// read from this bundle's Info.plist (`VespinAppGroup`), never spelled here.
// The snapshot is read loosely: a key it lacks or a value of another kind
// reads as nothing offered, never a failure.

import Foundation

/// One workspace the sheet offers, and the repositories a task in it may start in, the one it starts in first.
struct ShareWorkspace: Identifiable, Hashable {
  let id: String
  let name: String
  let repositories: [String]
}

/// What the app left for the sheet: the account, the workspace the phone works in, every workspace offered, and where Start is sent.
struct ShareSnapshot {
  let accountId: String
  let chosenWorkspaceId: String?
  let workspaces: [ShareWorkspace]
  /// None from an app before Start was sent, where the sheet only keeps drafts.
  let service: ShareService?
}

/// What the sheet keeps for New task.
struct ShareDraft {
  let accountId: String
  let prompt: String
  let workspaceId: String?
  let repository: String?
}

enum AppGroupFiles {
  private static let snapshotFile = "share-snapshot.json"
  private static let draftFile = "share-draft.json"
  private static let groupKey = "VespinAppGroup"

  /// The snapshot the app wrote, or none where it never wrote one or the account signed out.
  static func snapshot() -> ShareSnapshot? {
    guard let url = file(snapshotFile), let data = try? Data(contentsOf: url),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let accountId = json["accountId"] as? String
    else { return nil }
    let workspaces = (json["workspaces"] as? [[String: Any]] ?? []).compactMap { entry -> ShareWorkspace? in
      guard let id = entry["id"] as? String, let name = entry["name"] as? String else { return nil }
      return ShareWorkspace(id: id, name: name, repositories: entry["repositories"] as? [String] ?? [])
    }
    return ShareSnapshot(
      accountId: accountId, chosenWorkspaceId: json["chosenWorkspaceId"] as? String,
      workspaces: workspaces, service: service(json["service"]))
  }

  /// Where Start is sent, from the snapshot's `service`, or none where it reads as no address.
  private static func service(_ value: Any?) -> ShareService? {
    guard let json = value as? [String: Any], let origin = (json["origin"] as? String).flatMap({ URL(string: $0) }),
      origin.scheme == "https" || origin.host == "localhost"
    else { return nil }
    return ShareService(origin: origin, headers: json["headers"] as? [String: String] ?? [:])
  }

  /// Keeps `draft` for New task, in place of any kept before; whether it was kept.
  static func keep(_ draft: ShareDraft) -> Bool {
    guard let url = file(draftFile) else { return false }
    var json: [String: Any] = [
      "accountId": draft.accountId, "prompt": draft.prompt,
      "keptAt": (Date().timeIntervalSince1970 * 1000).rounded(),
    ]
    if let workspaceId = draft.workspaceId { json["workspaceId"] = workspaceId }
    if let repository = draft.repository { json["repository"] = repository }
    guard let data = try? JSONSerialization.data(withJSONObject: json) else { return false }
    return (try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil
  }

  /// The file named, in the group's container, or none where this build reaches no container.
  private static func file(_ name: String) -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: groupKey) as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent(name)
  }
}
