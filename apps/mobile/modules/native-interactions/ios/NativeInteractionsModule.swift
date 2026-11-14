// NativeInteractionsModule.swift -- the SwiftUI modifiers @expo/ui lacks, registered with its modifier registry so `@repo/ui-native` can hand them to any view: the keyboard focus's ring left off a list's row, a bar's subtitle under its title, a column's or a stack screen's, a row dragged out as its link, pictures dropped from Photos or Files, and a link dropped on a place.
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
  static let cellFocusRingOff = "vespinCellFocusRingOff"
  static let columnSubtitle = "vespinColumnSubtitle"
  static let stackSubtitle = "vespinStackSubtitle"
  static let dragLink = "vespinDragLink"
  static let dropPictures = "vespinDropPictures"
  static let dropLink = "vespinDropLink"
  static let all = [cellFocusRingOff, columnSubtitle, stackSubtitle, dragLink, dropPictures, dropLink]
}

/// How a dropped picture is kept for JavaScript to read: a JPEG at the quality the photo picker reads one at (`use-attached-pictures.ts`).
private let droppedPictureQuality: CGFloat = 0.7

public final class NativeInteractionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeInteractions")

    // Note that the modifiers are registered as the module is made, before any view draws, as the registry asks.
    OnCreate {
      ViewModifierRegistry.register(ModifierName.cellFocusRingOff) { params, appContext, _ in
        return try CellFocusRingOffModifier(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register(ModifierName.columnSubtitle) { params, appContext, _ in
        return try ColumnSubtitleModifier(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register(ModifierName.stackSubtitle) { params, appContext, _ in
        return try StackSubtitleModifier(from: params, appContext: appContext)
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

/// A row of a `List` whose cell draws no keyboard focus ring, such as a sidebar's, whose selected row already stands on its own fill.
///
/// Note that an iPad with a keyboard or a pointer otherwise rings the
/// selected row of a `List` that keeps a selection, a ring as wide as the
/// row and drawn over its fill, which iPadOS's own sidebars (Mail, Files)
/// don't draw. The selection itself still moves with the arrow keys, and the
/// row's fill shows where it stands.
///
/// Note that the ring is UIKit's, the `UICollectionViewCell`'s own
/// `focusEffect`, which SwiftUI's `focusEffectDisabled()` and
/// `focusable(false)` never reach, on the list or on its rows (seen on the
/// iOS 26.5 and 27.2 iPad simulators). So the row carries a probe view that
/// finds the cell it stands in and clears that effect, leaving the focus
/// effects of the views inside the row, such as a fold button's, as they are.
internal struct CellFocusRingOffModifier: ViewModifier, Record {
  func body(content: Content) -> some View {
    content.background(CellFocusEffectOff())
  }
}

/// The probe a row carries: an empty view that clears its cell's focus effect each time it's placed or redrawn, since a cell is reused for other rows.
private struct CellFocusEffectOff: UIViewRepresentable {
  func makeUIView(context: Context) -> CellFocusEffectProbe {
    CellFocusEffectProbe()
  }

  func updateUIView(_ view: CellFocusEffectProbe, context: Context) {
    view.clearCellFocusEffect()
  }
}

private final class CellFocusEffectProbe: UIView {
  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    clearCellFocusEffect()
  }

  /// Clears the focus effect of the nearest collection view cell above the probe; outside a list it finds none and does nothing.
  func clearCellFocusEffect() {
    var view = superview
    while let current = view, !(current is UICollectionViewCell) {
      view = current.superview
    }
    (view as? UICollectionViewCell)?.focusEffect = nil
  }
}

// MARK: - Subtitle

/// A split view column's subtitle under its title, as Mail names its filter under Inbox: SwiftUI's own bar reads `navigationSubtitle`.
///
/// Note that the modifier stands on the column whether or not it has a
/// subtitle, an empty one drawing none, because adding or removing a
/// modifier changes the column's view type and so redraws everything under
/// it, the lists a tab keeps behind the one shown among them.
internal struct ColumnSubtitleModifier: ViewModifier, Record {
  @Field var subtitle: String = ""

  func body(content: Content) -> some View {
    content.navigationSubtitle(subtitle)
  }
}

/// A compact screen's subtitle under the title of the native stack's bar it's pushed under.
///
/// Note that react-native-screens draws that bar from its screen's
/// `UINavigationItem`, which no SwiftUI modifier reaches. So the screen
/// carries a probe that finds the view controller its navigation controller
/// holds and sets that item's `subtitle` (iOS 26), clearing it as it leaves
/// only while it still reads what the probe wrote. A probe with an empty
/// subtitle that has written nothing touches nothing.
internal struct StackSubtitleModifier: ViewModifier, Record {
  @Field var subtitle: String = ""

  func body(content: Content) -> some View {
    content.background(StackSubtitleProbe(subtitle: subtitle))
  }
}

/// The probe a screen carries: an empty view that writes its subtitle to the stack's item each time it's placed or redrawn.
private struct StackSubtitleProbe: UIViewRepresentable {
  let subtitle: String

  func makeUIView(context: Context) -> StackSubtitleView {
    StackSubtitleView()
  }

  func updateUIView(_ view: StackSubtitleView, context: Context) {
    view.subtitle = subtitle
  }

  static func dismantleUIView(_ view: StackSubtitleView, coordinator: ()) {
    view.clear()
  }
}

private final class StackSubtitleView: UIView {
  /// The item this probe wrote to, and what it wrote there, so it clears only its own.
  private weak var item: UINavigationItem?
  private var written: String?

  var subtitle = "" {
    didSet { write() }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    write()
  }

  /// Clears the subtitle this probe wrote, unless something else has written over it since.
  func clear() {
    if let item, item.subtitle == written {
      item.subtitle = nil
    }
    item = nil
    written = nil
  }

  /// Sets the subtitle on the item of the nearest view controller a navigation controller holds, moving off an item it wrote to before.
  private func write() {
    guard window != nil, let held = heldController() else {
      clear()
      return
    }
    if item !== held.navigationItem { clear() }
    if subtitle.isEmpty && written == nil { return }
    let shown = subtitle.isEmpty ? nil : subtitle
    held.navigationItem.subtitle = shown
    item = held.navigationItem
    written = shown
  }

  /// The view controller above the probe whose parent is a navigation controller: the stack's screen, past the hosting controller standing inside it.
  private func heldController() -> UIViewController? {
    var responder: UIResponder? = next
    while let current = responder {
      if let controller = current as? UIViewController, controller.parent is UINavigationController {
        return controller
      }
      responder = current.next
    }
    return nil
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
