// RowMenu.swift -- a row's long press menu, its preview, and its swipes, and a section header's menu, built by SwiftUI from the plain tree a row hands over (`packages/ui-native/src/row-menu-model.ts`, `row-preview-model.ts`), so a list's rows hold no views of a menu nobody opened.
//
// The tree arrives as JSON in one string. The menu's items and its preview
// are read from it only inside SwiftUI's `contextMenu` closures, which run as
// a long press opens the menu, and a press sends back the place of the item
// pressed, its group or edge first, then its place in each menu within; the
// handlers stay in JavaScript, which walks its own groups to the one pressed.

import ExpoModulesCore
import GameController
import SwiftUI
import UIKit

// MARK: - The tree

/// How a node's icon is drawn: a glyph, a person's photo from a file on this device, or an integration's mark (`MENU_ICON`).
private enum MenuIconKind: String, Decodable {
  case glyph, photo, mark, emoji
}

/// A node's icon (`MenuIcon`).
private struct MenuIconData: Decodable {
  let kind: MenuIconKind
  let asset: String?
  let system: String?
  let color: String?
  let under: UnderGlyph?
  let photo: String?
  let size: Double?
  let emoji: String?
  let corner: Double?

  struct UnderGlyph: Decodable {
    let asset: String
    let opacity: Double
  }
}

/// What a node is: an act, a choice the system checks, or a menu of more nodes (`MENU_NODE`).
private enum MenuNodeKind: String, Decodable {
  case act, choice, menu
}

/// One node of a row's menu or swipes (`MenuNode`).
private struct MenuNodeData: Decodable {
  let kind: MenuNodeKind
  let label: String
  let detail: String?
  let icon: MenuIconData?
  let destructive: Bool?
  let disabled: Bool?
  let tint: String?
  let on: Bool?
  let nodes: [MenuNodeData]?
  let heard: String?
}

/// A row's menu: what heads it, where anything does, its groups, set apart by dividers, and the preview it lifts, where it has one.
private struct RowMenuData: Decodable {
  let title: String?
  let groups: [[MenuNodeData]]
  let preview: PreviewTreeData?
}

/// The swipes from one edge (`SwipeEdgeTree`).
private struct SwipeEdgeData: Decodable {
  let full: Bool
  let nodes: [MenuNodeData]
}

/// A tree read from its JSON, or nothing where it reads as no tree, which draws as no menu rather than failing the row.
private func readTree<Tree: Decodable>(_ json: String, as type: Tree.Type) -> Tree? {
  guard let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(type, from: data)
}

/// What a press sends: the place of the item pressed.
private typealias PressPlace = ([Int]) -> Void

// MARK: - Colors

extension Color {
  /// A color written `#rrggbb` or `#rrggbbaa`, as the brand's table writes them; clear where it reads as neither.
  init(vespinHex hex: String) {
    self.init(uiColor: UIColor(vespinHex: hex))
  }
}

extension UIColor {
  /// A color written `#rrggbb` or `#rrggbbaa`; clear where it reads as neither.
  convenience init(vespinHex hex: String) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else {
      self.init(white: 0, alpha: 0)
      return
    }
    let rgba = digits.count == 8 ? value : (value << 8) | 0xff
    self.init(
      red: CGFloat((rgba >> 24) & 0xff) / 255,
      green: CGFloat((rgba >> 16) & 0xff) / 255,
      blue: CGFloat((rgba >> 8) & 0xff) / 255,
      alpha: CGFloat(rgba & 0xff) / 255
    )
  }
}

// MARK: - Menu items

/// A glyph's image: from the asset catalog, or an SF Symbol.
private func glyphUIImage(asset: String?, system: String?) -> UIImage? {
  if let asset { return UIImage(named: asset) }
  if let system { return UIImage(systemName: system) }
  return nil
}

/// A glyph in a system menu, as `@expo/ui`'s patched image draws one (`GlyphImage`): in its own color drawn into the image, kept as it is, with a faint glyph under it where it has one, since a menu templates any other icon in its ink; a template otherwise.
private func glyphIcon(_ icon: MenuIconData) -> Image? {
  guard let color = icon.color else {
    if let asset = icon.asset { return Image(asset) }
    if let system = icon.system { return Image(systemName: system) }
    return nil
  }
  let ink = UIColor(vespinHex: color)
  guard let tinted = glyphUIImage(asset: icon.asset, system: icon.system)?.withTintColor(ink, renderingMode: .alwaysOriginal) else {
    return nil
  }
  guard let under = icon.under, let faintGlyph = UIImage(named: under.asset) else {
    return Image(uiImage: tinted)
  }
  let faint = faintGlyph.withTintColor(ink.withAlphaComponent(under.opacity), renderingMode: .alwaysOriginal)
  let size = CGSize(width: max(tinted.size.width, faint.size.width), height: max(tinted.size.height, faint.size.height))
  // Note that both stand centered in one image, the faint glyph under the lit one, since a menu holds one image per item.
  let layered = UIGraphicsImageRenderer(size: size).image { _ in
    for image in [faint, tinted] {
      image.draw(at: CGPoint(x: (size.width - image.size.width) / 2, y: (size.height - image.size.height) / 2))
    }
  }
  return Image(uiImage: layered.withRenderingMode(.alwaysOriginal))
}

/// A person's photo in a system menu, drawn into its circle at its size and kept as it is (`MenuPhoto`). Note that it reads only a file on this device, never the network, since a menu is built at once.
private func photoIcon(_ icon: MenuIconData) -> Image? {
  guard let side = icon.size, side > 0,
        let path = icon.photo, let url = URL(string: path), url.isFileURL,
        let photo = UIImage(contentsOfFile: url.path),
        photo.size.width > 0, photo.size.height > 0 else {
    return nil
  }
  let size = CGSize(width: side, height: side)
  let round = UIGraphicsImageRenderer(size: size).image { _ in
    // Note that a photo with a corner stands on a rounded square, as a repository's owner picture does, and any other in its circle.
    let frame = CGRect(origin: .zero, size: size)
    (icon.corner.map { UIBezierPath(roundedRect: frame, cornerRadius: side * $0) } ?? UIBezierPath(ovalIn: frame)).addClip()
    // Note that the photo fills the circle, its longer side cropped about its center.
    let scale = max(side / photo.size.width, side / photo.size.height)
    let drawn = CGSize(width: photo.size.width * scale, height: photo.size.height * scale)
    photo.draw(in: CGRect(origin: CGPoint(x: (side - drawn.width) / 2, y: (side - drawn.height) / 2), size: drawn))
  }
  return Image(uiImage: round.withRenderingMode(.alwaysOriginal))
}

/// An emoji in a system menu, drawn into a square at its size and kept as it is, as `@expo/ui`'s patched image draws one (`emojiContent`), so a menu keeps its colors and lines its words up with its glyphs' items.
private func emojiIcon(_ icon: MenuIconData) -> Image? {
  guard let side = icon.size, side > 0, let emoji = icon.emoji, !emoji.isEmpty else { return nil }
  let size = CGSize(width: side, height: side)
  // Note that the emoji is set a little under the square's side, since its line stands taller than its face.
  let words = NSAttributedString(string: emoji, attributes: [.font: UIFont.systemFont(ofSize: side * 0.8)])
  let face = words.size()
  let drawn = UIGraphicsImageRenderer(size: size).image { _ in
    words.draw(at: CGPoint(x: (side - face.width) / 2, y: (side - face.height) / 2))
  }
  return Image(uiImage: drawn.withRenderingMode(.alwaysOriginal))
}

/// A catalog mark, such as a model's harness, fit in a square of its size, as `@expo/ui`'s patched image draws one (`assetSize`), a template mark such as Cursor's cube staying a template so it takes the menu's ink; the mark as the catalog keeps it where it has no size.
private func markIcon(_ icon: MenuIconData) -> Image? {
  guard let name = icon.asset else { return nil }
  guard let side = icon.size, side > 0, let asset = UIImage(named: name),
        asset.size.width > 0, asset.size.height > 0 else {
    return Image(name)
  }
  let scale = min(side / asset.size.width, side / asset.size.height)
  let drawn = CGSize(width: asset.size.width * scale, height: asset.size.height * scale)
  let fitted = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
    asset.draw(in: CGRect(origin: CGPoint(x: (side - drawn.width) / 2, y: (side - drawn.height) / 2), size: drawn))
  }
  return Image(uiImage: fitted.withRenderingMode(asset.renderingMode == .alwaysTemplate ? .alwaysTemplate : .alwaysOriginal))
}

/// A node's icon as an image, or nothing for a node of words alone.
private func iconImage(_ icon: MenuIconData?) -> Image? {
  guard let icon else { return nil }
  switch icon.kind {
  case .glyph: return glyphIcon(icon)
  case .photo: return photoIcon(icon)
  case .mark: return markIcon(icon)
  case .emoji: return emojiIcon(icon)
  }
}

/// What a node's button or toggle holds: its words over what it says under them beside its icon, which a system menu draws as its title and subtitle; or its words beside its icon, as a `Label`; or its words alone.
@ViewBuilder
private func nodeLabel(_ node: MenuNodeData) -> some View {
  let icon = iconImage(node.icon)
  if let detail = node.detail {
    Text(node.label)
    Text(detail)
    if let icon { icon }
  } else if let icon {
    Label { Text(node.label) } icon: { icon }
  } else {
    Text(node.label)
  }
}

/// One node as SwiftUI's own menu item: an act's button, red through the destructive role, otherwise in its tint, dimmed where it takes no press; a choice's toggle, which the system checks; or a menu of its nodes, in its tint. Note that it returns `AnyView`, because a menu holds nodes of its own kind.
private func menuNode(_ node: MenuNodeData, at place: [Int], press: @escaping PressPlace) -> AnyView {
  switch node.kind {
  case .act:
    let destructive = node.destructive == true
    return AnyView(
      Button(role: destructive ? .destructive : nil) {
        press(place)
      } label: {
        nodeLabel(node)
      }
      .tint(destructive ? nil : node.tint.map { Color(vespinHex: $0) })
      .disabled(node.disabled == true)
    )
  case .choice:
    let on = node.on == true
    return AnyView(
      Toggle(isOn: Binding(get: { on }, set: { _ in press(place) })) {
        nodeLabel(node)
      }
    )
  case .menu:
    let nodes = node.nodes ?? []
    return AnyView(
      Menu {
        ForEach(Array(nodes.enumerated()), id: \.offset) { index, inner in
          menuNode(inner, at: place + [index], press: press)
        }
      } label: {
        nodeLabel(node)
      }
      .tint(node.tint.map { Color(vespinHex: $0) })
    )
  }
}

/// A row's menu items, read from its tree as the menu opens: each group after a divider but the first, under the menu's title where it has one, as Messages heads a held message's menu by its time.
private struct RowMenuItems: View {
  let json: String
  let press: PressPlace

  var body: some View {
    let tree = readTree(json, as: RowMenuData.self)
    if let title = tree?.title {
      Section(title) { groupItems(tree?.groups ?? []) }
    } else {
      groupItems(tree?.groups ?? [])
    }
  }

  private func groupItems(_ groups: [[MenuNodeData]]) -> some View {
    ForEach(Array(groups.enumerated()), id: \.offset) { group, nodes in
      if group > 0 { Divider() }
      ForEach(Array(nodes.enumerated()), id: \.offset) { index, node in
        menuNode(node, at: [group, index], press: press)
      }
    }
  }
}

/// A row's preview, read from its tree as the menu opens.
private struct RowMenuPreview: View {
  let json: String

  var body: some View {
    if let tree = readTree(json, as: RowMenuData.self)?.preview {
      PreviewCard(tree: tree)
    }
  }
}

// MARK: - Modifiers

/// A row's long press menu, SwiftUI's own, built from its tree only as a long press opens it, and the preview it lifts where `previewed`; a press sends the place of the item pressed (`rowMenu` in `interactions.ts`).
///
/// Note that the tree is read inside the menu's closures, never as the row
/// draws, so a row that's drawn and redrawn pays for one string, and nothing
/// of its menu stands until it's asked for.
internal struct RowMenuModifier: ViewModifier, Record {
  static let name = "vespinRowMenu"

  @Field var menu: String = ""
  @Field var previewed: Bool = false
  var eventDispatcher: EventDispatcher?

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    let json = menu
    let dispatcher = eventDispatcher
    let press: PressPlace = { place in dispatcher?([Self.name: ["path": place]]) }
    if previewed {
      content.contextMenu {
        RowMenuItems(json: json, press: press)
      } preview: {
        RowMenuPreview(json: json)
      }
    } else {
      content.contextMenu {
        RowMenuItems(json: json, press: press)
      }
    }
  }
}

/// A section header's menu, SwiftUI's own menu button around the header, its items built from the header's tree as the menu opens: a tap folds the section where `folds`, its primary action, and a long press opens the menu, as Reminders' and Files' headers do; a header that folds nothing opens the menu on a tap. A press sends the place of the item pressed, and the fold sends `fold` (`headerMenu` in `interactions.ts`).
///
/// Note that it is a menu button rather than a context menu, because
/// SwiftUI's context menu on a list's section header never opened, its long
/// press lost to the fold's button or dropped (#10405).
internal struct HeaderMenuModifier: ViewModifier, Record {
  static let name = "vespinHeaderMenu"

  @Field var menu: String = ""
  @Field var folds: Bool = false
  var eventDispatcher: EventDispatcher?

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    let json = menu
    let dispatcher = eventDispatcher
    let press: PressPlace = { place in dispatcher?([Self.name: ["path": place]]) }
    if folds {
      Menu {
        RowMenuItems(json: json, press: press)
      } label: {
        content
      } primaryAction: {
        dispatcher?([Self.name: ["fold": true]])
      }
    } else {
      Menu {
        RowMenuItems(json: json, press: press)
      } label: {
        content
      }
    }
  }
}

/// A row's swipes from either edge, SwiftUI's own swipe actions, each a node of its tree filled by its tint, a full swipe running the first where its edge allows it; a press sends its place, its edge first, trailing then leading (`rowSwipes` in `interactions.ts`).
internal struct RowSwipesModifier: ViewModifier, Record {
  static let name = "vespinRowSwipes"

  @Field var swipes: String = ""
  var eventDispatcher: EventDispatcher?

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    let edges = readTree(swipes, as: [SwipeEdgeData].self) ?? []
    let dispatcher = eventDispatcher
    let press: PressPlace = { place in dispatcher?([Self.name: ["path": place]]) }
    content
      .modifier(SwipeEdge(edge: .trailing, place: 0, data: edges.first, press: press))
      .modifier(SwipeEdge(edge: .leading, place: 1, data: edges.count > 1 ? edges[1] : nil, press: press))
  }
}

/// The swipes from one edge, or none where it has none.
private struct SwipeEdge: ViewModifier {
  let edge: HorizontalEdge
  let place: Int
  let data: SwipeEdgeData?
  let press: PressPlace

  func body(content: Content) -> some View {
    if let data, !data.nodes.isEmpty {
      content.swipeActions(edge: edge, allowsFullSwipe: data.full) {
        ForEach(Array(data.nodes.enumerated()), id: \.offset) { index, node in
          menuNode(node, at: [place, index], press: press)
        }
      }
    } else {
      content
    }
  }
}

// MARK: - VoiceOver

/// One of a row's VoiceOver Actions: what it's heard as, and the place of the menu item it presses.
private struct HeardAct {
  let name: String
  let place: [Int]
}

/// A row's VoiceOver Actions, read from its menu's tree (`heardActs` before it, #10342): every act and choice the menu offers, in the menu's order, each by its `heard` words, a dimmed act left out, and a name standing twice, such as an act the menu offers in two groups, heard once, at its first place.
private func heardActs(_ groups: [[MenuNodeData]]) -> [HeardAct] {
  var named = Set<String>()
  var acts: [HeardAct] = []
  func walk(_ node: MenuNodeData, _ place: [Int]) {
    switch node.kind {
    case .act, .choice:
      guard node.disabled != true, let name = node.heard, named.insert(name).inserted else { return }
      acts.append(HeardAct(name: name, place: place))
    case .menu:
      for (index, inner) in (node.nodes ?? []).enumerated() { walk(inner, place + [index]) }
    }
  }
  for (group, nodes) in groups.enumerated() {
    for (index, node) in nodes.enumerated() { walk(node, [group, index]) }
  }
  return acts
}

/// Whether a launch on a fixture asks for the rows' Actions whatever reads them, so a run on the simulator, where no VoiceOver runs, can log and compare them (`-logHeardActs true` beside `-fixture`).
private let heardActsAsked: Bool = {
  let defaults = UserDefaults.standard
  return defaults.bool(forKey: "logHeardActs") && defaults.string(forKey: "fixture") != nil
}()

/// A row's VoiceOver Actions, the rotor's list, built from its menu's tree; a press sends the place of the menu item it runs, as the menu's own press does (`rowHeard` in `interactions.ts`).
///
/// Note that the tree is read only while something reads the Actions:
/// VoiceOver, Switch Control, or a hardware keyboard, which Full Keyboard
/// Access needs, so a row's redraw pays nothing for them otherwise. It
/// stands on the row's frame after the row is made one element, since a
/// view that ignores its children's accessibility offers its own Actions
/// alone.
internal struct RowHeardModifier: ViewModifier, Record {
  static let name = "vespinRowHeard"

  @Field var menu: String = ""
  var eventDispatcher: EventDispatcher?

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    let dispatcher = eventDispatcher
    content.modifier(HeardActions(json: menu) { place in dispatcher?([Self.name: ["path": place]]) })
  }
}

/// The Actions themselves, read from the tree only while something reads them.
private struct HeardActions: ViewModifier {
  let json: String
  let press: PressPlace
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
  @Environment(\.accessibilitySwitchControlEnabled) private var switchControl

  func body(content: Content) -> some View {
    let read = voiceOver || switchControl || GCKeyboard.coalesced != nil || heardActsAsked
    let acts = read ? heardActs(readTree(json, as: RowMenuData.self)?.groups ?? []) : []
    // Note that the Actions are handed over last first, because the Actions SwiftUI makes of them stood in reverse, Open last (seen on the iOS 27.2 simulator's accessibility tree); each still sends its own place. An empty list keeps the modifier, so the row's views stay the same as a reader turns on.
    return content.accessibilityActions {
      ForEach(Array(acts.enumerated()).reversed(), id: \.offset) { _, act in
        Button(act.name) { press(act.place) }
      }
    }
  }
}

// MARK: - Preview

/// What a preview's node is (`PREVIEW_NODE`).
private enum PreviewNodeKind: String, Decodable {
  case column, row, text, glyph, working, tile, face, rule
}

/// One node of a preview's tree (`PreviewNode`), each field read by the kinds that hold it.
private struct PreviewNodeData: Decodable {
  let kind: PreviewNodeKind
  let spacing: Double?
  let nodes: [PreviewNodeData]?
  let words: String?
  let style: String?
  let weight: String?
  let ink: String?
  let lines: Int?
  let digits: Bool?
  let fixed: Bool?
  let asset: String?
  let system: String?
  let size: Double?
  let side: Double?
  let cell: Double?
  let pitch: Double?
  let inset: Double?
  let track: [[Int]]?
  let dots: [WorkingDot]?
  let opacity: WorkingOpacity?
  let corner: Double?
  let well: String?
  let mark: TileMark?
  let glyph: TileGlyph?
  let hue: String?
  let letter: String?
  let letterSize: Double?
  let letterInk: String?
  let picture: String?

  struct WorkingDot: Decodable {
    let restsOn: Int
    let tail: Bool
  }

  struct WorkingOpacity: Decodable {
    let track: Double
    let tail: Double
    let lead: Double
  }

  struct TileMark: Decodable {
    let asset: String
    let side: Double
  }

  struct TileGlyph: Decodable {
    let asset: String?
    let system: String?
    let size: Double
  }
}

/// A preview's tree: its width, its inset, its ground, and its root column (`PreviewTree`).
private struct PreviewTreeData: Decodable {
  let width: Double
  let padding: Double
  let ground: String
  let root: PreviewNodeData
}

/// A text style by the name `@expo/ui`'s `font` reads.
private func previewTextStyle(_ name: String?) -> Font.TextStyle {
  switch name {
  case "largeTitle": .largeTitle
  case "title": .title
  case "title2": .title2
  case "title3": .title3
  case "headline": .headline
  case "subheadline": .subheadline
  case "callout": .callout
  case "footnote": .footnote
  case "caption": .caption
  case "caption2": .caption2
  default: .body
  }
}

/// A font weight by its name, regular where none is given.
private func previewWeight(_ name: String?) -> Font.Weight {
  switch name {
  case "medium": .medium
  case "semibold": .semibold
  case "bold": .bold
  default: .regular
  }
}

/// A preview's card, as `PreviewCard` stood it: its root column padded to the screen's edge, at a phone's width, on the brand's ground.
private struct PreviewCard: View {
  let tree: PreviewTreeData

  var body: some View {
    PreviewNode(node: tree.root)
      .padding(tree.padding)
      .frame(width: tree.width, alignment: .topLeading)
      .background(Color(vespinHex: tree.ground))
  }
}

/// One node of a preview, drawn as the React Native marks and words drew it, with the same modifiers in the same order.
private struct PreviewNode: View {
  let node: PreviewNodeData

  var body: some View {
    switch node.kind {
    case .column:
      VStack(alignment: .leading, spacing: node.spacing.map { CGFloat($0) }) { children }
    case .row:
      HStack(alignment: .center, spacing: node.spacing.map { CGFloat($0) }) { children }
    case .text:
      words
    case .glyph:
      glyph
    case .working:
      PreviewWorkingMark(node: node)
    case .tile:
      tile
    case .face:
      PreviewFace(node: node)
    case .rule:
      Divider().foregroundStyle(Color(vespinHex: node.ink ?? ""))
    }
  }

  private var children: some View {
    ForEach(Array((node.nodes ?? []).enumerated()), id: \.offset) { _, child in
      AnyView(PreviewNode(node: child))
    }
  }

  @ViewBuilder
  private var words: some View {
    let text = Text(node.words ?? "")
      .font(Font.system(previewTextStyle(node.style)).weight(previewWeight(node.weight)))
    let digits = node.digits == true ? text.monospacedDigit() : text
    let drawn = digits
      .foregroundStyle(Color(vespinHex: node.ink ?? ""))
      .lineLimit(node.lines)
    if node.fixed == true {
      drawn.fixedSize()
    } else {
      drawn
    }
  }

  /// A glyph at a text style's size, or at its own size, in its ink, as `ToneGlyph` and `TaskStatusMark` drew it.
  @ViewBuilder
  private var glyph: some View {
    let image = node.asset.map { Image($0) } ?? Image(systemName: node.system ?? "")
    image
      .font(node.style != nil ? Font.system(previewTextStyle(node.style)) : Font.system(size: CGFloat(node.size ?? 24)))
      .foregroundStyle(Color(vespinHex: node.ink ?? ""))
      .accessibilityHidden(true)
  }

  /// An agent's tile, as `AgentTile` drew it: a rounded square on the well, its harness's mark on it, or the hard hat where the harness is not known.
  private var tile: some View {
    let size = CGFloat(node.size ?? 0)
    let ink = Color(vespinHex: node.ink ?? "")
    return ZStack {
      RoundedRectangle(cornerRadius: CGFloat(node.corner ?? 0))
        .foregroundStyle(Color(vespinHex: node.well ?? ""))
      if let mark = node.mark {
        Image(mark.asset)
          .resizable()
          .frame(width: CGFloat(mark.side), height: CGFloat(mark.side))
          .foregroundStyle(ink)
      } else if let glyph = node.glyph {
        (glyph.asset.map { Image($0) } ?? Image(systemName: glyph.system ?? ""))
          .font(.system(size: CGFloat(glyph.size)))
          .foregroundStyle(ink)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// A person's face, as `Avatar` drew it: their photo, read from its address, or their letter on their hue where there is none or it can't be read, never while it loads.
private struct PreviewFace: View {
  let node: PreviewNodeData

  var body: some View {
    let size = CGFloat(node.size ?? 0)
    let corner = CGFloat(node.corner ?? 0)
    ZStack {
      if let picture = node.picture, let url = URL(string: picture) {
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image):
            image
              .resizable()
              .scaledToFill()
              .frame(width: size, height: size)
              .clipShape(RoundedRectangle(cornerRadius: corner))
          case .failure:
            letter
          default:
            Color.clear
          }
        }
      } else {
        letter
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private var letter: some View {
    ZStack {
      RoundedRectangle(cornerRadius: CGFloat(node.corner ?? 0))
        .foregroundStyle(Color(vespinHex: node.hue ?? ""))
      Text(node.letter ?? "")
        .font(.system(size: CGFloat(node.letterSize ?? 0), weight: .semibold, design: .rounded))
        .foregroundStyle(Color(vespinHex: node.letterInk ?? ""))
    }
  }
}

/// The working mark, as `WorkingMark` drew it: two pixels chasing round a 3×3 grid on a 200 ms beat, each tailed by a fainter one, over the faint track; held on its resting frame where the reader reduces motion.
private struct PreviewWorkingMark: View {
  let node: PreviewNodeData
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// How long a step of the beat lasts: the panel's 200 ms (`working-beat.ts`).
  private static let beat: TimeInterval = 0.2

  var body: some View {
    if reduceMotion {
      grid(beat: 0)
    } else {
      TimelineView(.periodic(from: .now, by: Self.beat)) { context in
        grid(beat: Int(context.date.timeIntervalSinceReferenceDate / Self.beat))
      }
    }
  }

  private func grid(beat: Int) -> some View {
    let side = CGFloat(node.side ?? 0)
    let track = node.track ?? []
    let opacity = node.opacity
    return ZStack(alignment: .topLeading) {
      ForEach(Array(track.indices), id: \.self) { index in
        square(index, shade: opacity?.track ?? 0)
      }
      ForEach(Array((node.dots ?? []).enumerated()), id: \.offset) { _, dot in
        square(dot.restsOn + beat, shade: dot.tail ? opacity?.tail ?? 0 : opacity?.lead ?? 0)
      }
    }
    .frame(width: side, height: side, alignment: .topLeading)
    .accessibilityHidden(true)
  }

  private func square(_ index: Int, shade: Double) -> some View {
    let track = node.track ?? []
    let cell = CGFloat(node.cell ?? 0)
    let pitch = CGFloat(node.pitch ?? 0)
    let inset = CGFloat(node.inset ?? 0)
    let at = track.isEmpty ? [0, 0] : track[index % track.count]
    return RoundedRectangle(cornerRadius: cell / 4)
      .frame(width: cell, height: cell)
      .foregroundStyle(Color(vespinHex: node.ink ?? ""))
      .opacity(shade)
      .offset(x: inset + CGFloat(at[0]) * pitch, y: inset + CGFloat(at[1]) * pitch)
  }
}
