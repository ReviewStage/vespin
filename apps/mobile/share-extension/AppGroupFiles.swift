// AppGroupFiles.swift -- the share extension's side of the files it shares with the app through their App Group: the snapshot it reads and the draft it keeps.
//
// The app writes the snapshot whenever it changes, and opens the share page
// again on the draft the next time it comes forward, then removes it
// (`src/share-sheet.ts`, `@repo/features/ios-share-wire`). The page reads the
// snapshot's text and writes the draft's: this file only moves bytes, so the
// shape of both stays in one place, `ios-share-wire.ts`. The group is read
// from this bundle's Info.plist (`VespinAppGroup`), never spelled here.

import Foundation

enum AppGroupFiles {
  private static let snapshotFile = "share-snapshot.json"
  private static let draftFile = "share-draft.json"
  /// The files a draft's pictures are kept in, in order (`SHARE_DRAFT_PICTURE_FILES`), which the draft names and the app reads by these names alone.
  private static let pictureFiles = (1...SharedItems.maxPictures).map { "share-draft-picture-\($0).jpg" }
  private static let groupKey = "VespinAppGroup"

  /// The snapshot's text as the app wrote it, or none where it never wrote one or the account signed out.
  static func snapshot() -> String? {
    guard let url = file(snapshotFile), let data = try? Data(contentsOf: url) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  /// Keeps `json` as the draft for the app and each of `pictures`, in order, as its picture files, in place of any kept before; whether all of it was kept.
  static func keep(_ json: String, pictures: [Data]) -> Bool {
    guard let url = file(draftFile), pictures.count <= pictureFiles.count else { return false }
    for name in pictureFiles { if let old = file(name) { try? FileManager.default.removeItem(at: old) } }
    for (picture, name) in zip(pictures, pictureFiles) {
      guard let kept = file(name), (try? picture.write(to: kept, options: protection)) != nil
      else { return false }
    }
    return (try? Data(json.utf8).write(to: url, options: protection)) != nil
  }

  /// How each kept file is written: whole or not at all, and readable once the phone has been unlocked since it started.
  private static let protection: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]

  /// The file named, in the group's container, or none where this build reaches no container.
  private static func file(_ name: String) -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: groupKey) as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent(name)
  }
}
