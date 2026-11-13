// NativeInteractionsModule.swift -- the SwiftUI modifiers @expo/ui lacks, registered with its modifier registry so `@repo/ui-native` can hand them to any view: the keyboard focus's ring left off a list, a row dragged out as its link, pictures dropped from Photos or Files, and a link dropped on a place.
//
// Each modifier is a `Record` built from the parameters JavaScript gives
// (`packages/ui-native/src/interactions.ts`), as @expo/ui's own are, and one
// that answers sends its event under its own type's name, which is how
// @expo/ui hands a modifier's event to the listener given beside it. A view
// handed a modifier this build does not register draws as it would without
// it, so the JavaScript stands whether or not this module is built in.

import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The names the modifiers are registered under, which `interactions.ts` names too.
private enum ModifierName {
  static let focusEffectDisabled = "vespinFocusEffectDisabled"
  static let dragLink = "vespinDragLink"
  static let dropPictures = "vespinDropPictures"
  static let dropLink = "vespinDropLink"
  static let all = [focusEffectDisabled, dragLink, dropPictures, dropLink]
}

/// How a dropped picture is kept for JavaScript to read: a JPEG at the quality the photo picker reads one at (`use-attached-pictures.ts`).
private let droppedPictureQuality: CGFloat = 0.7

public final class NativeInteractionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeInteractions")

    // Note that the modifiers are registered as the module is made, before any view draws, as the registry asks.
    OnCreate {
      ViewModifierRegistry.register(ModifierName.focusEffectDisabled) { params, appContext, _ in
        return try FocusEffectDisabledModifier(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register(ModifierName.dragLink) { params, appContext, _ in
        return try DragLinkModifier(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register(ModifierName.dropPictures) { params, appContext, eventDispatcher in
        return try DropPicturesModifier(from: params, appContext: appContext, eventDispatcher: eventDispatcher)
      }
      ViewModifierRegistry.register(ModifierName.dropLink) { params, appContext, eventDispatcher in
        return try DropLinkModifier(from: params, appContext: appContext, eventDispatcher: eventDispatcher)
      }
    }

    OnDestroy {
      ModifierName.all.forEach { ViewModifierRegistry.unregister($0) }
    }
  }
}

// MARK: - Focus

/// A view drawn with no keyboard focus effect, such as a sidebar whose selected row already stands on its own fill.
///
/// Note that an iPad with a keyboard or a pointer otherwise rings the
/// selected row of a `List` that keeps a selection, a ring as wide as the
/// row and drawn over its fill, which iPadOS's own sidebars (Mail, Files)
/// don't draw. The selection itself still moves with the arrow keys, and the
/// row's fill shows where it stands.
///
/// Note that a list's own `focusEffectDisabled()` doesn't reach the cells
/// iPadOS 26 and 27 ring (seen on both simulators), so each row takes it too,
/// and `unfocusable` also takes the row out of keyboard focus, where the
/// effect alone still leaves the ring.
internal struct FocusEffectDisabledModifier: ViewModifier, Record {
  @Field var unfocusable: Bool = false

  func body(content: Content) -> some View {
    if unfocusable {
      content.focusEffectDisabled().focusable(false)
    } else {
      content.focusEffectDisabled()
    }
  }
}

// MARK: - Drag

/// A view dragged out as its link, which another app takes as a URL and a place in this one reads back (`DropLinkModifier`).
internal struct DragLinkModifier: ViewModifier, Record {
  @Field var url: String = ""

  func body(content: Content) -> some View {
    if let link = URL(string: url), !url.isEmpty {
      content.onDrag { NSItemProvider(object: link as NSURL) }
    } else {
      content
    }
  }
}

// MARK: - Drop

/// The files kept from one drop, by the place each was dropped in, written from the item providers' own queues.
private final class DroppedFiles: @unchecked Sendable {
  private let lock = NSLock()
  private var kept: [Int: String] = [:]

  func keep(_ uri: String, at index: Int) {
    lock.lock()
    kept[index] = uri
    lock.unlock()
  }

  func inOrder() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return kept.keys.sorted().compactMap { kept[$0] }
  }
}

/// A dropped picture kept as a JPEG under the app's temporary folder, or nothing where it could not be read as a picture.
private func keepPicture(at url: URL) -> URL? {
  guard let image = UIImage(contentsOfFile: url.path),
        let jpeg = image.jpegData(compressionQuality: droppedPictureQuality) else {
    return nil
  }
  let kept = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString)
    .appendingPathExtension("jpg")
  do {
    try jpeg.write(to: kept)
    return kept
  } catch {
    return nil
  }
}

/// Pictures dropped on a view, from Photos, Files, or another app: each kept as a JPEG, then handed to JavaScript together as file addresses, in the order they were dropped, with how many were dropped, so one that could not be kept is said rather than lost.
internal struct DropPicturesModifier: ViewModifier, Record {
  var eventDispatcher: EventDispatcher?

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    content.onDrop(of: [UTType.image], isTargeted: nil) { providers in
      let pictures = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
      if pictures.isEmpty {
        return false
      }
      let dispatcher = eventDispatcher
      let files = DroppedFiles()
      let group = DispatchGroup()
      for (index, provider) in pictures.enumerated() {
        group.enter()
        // Note that the file a provider hands over is deleted once its handler returns, so it is copied before then.
        _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
          if let url, let kept = keepPicture(at: url) {
            files.keep(kept.absoluteString, at: index)
          }
          group.leave()
        }
      }
      let dropped = pictures.count
      group.notify(queue: .main) {
        // Note that the event is typed, since a literal mixing a list and a count infers no type of its own.
        let event: [String: Any] = ["uris": files.inOrder(), "dropped": dropped]
        dispatcher?([ModifierName.dropPictures: event])
      }
      return true
    }
  }
}

/// A link dropped on a view, such as a task's row dragged onto a section, handed to JavaScript as its address.
internal struct DropLinkModifier: ViewModifier, Record {
  var eventDispatcher: EventDispatcher?

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    content.onDrop(of: [UTType.url], isTargeted: nil) { providers in
      guard let provider = providers.first(where: { $0.canLoadObject(ofClass: NSURL.self) }) else {
        return false
      }
      let dispatcher = eventDispatcher
      _ = provider.loadObject(ofClass: NSURL.self) { reading, _ in
        guard let link = (reading as? NSURL)?.absoluteString else {
          return
        }
        DispatchQueue.main.async {
          dispatcher?([ModifierName.dropLink: ["url": link]])
        }
      }
      return true
    }
  }
}
