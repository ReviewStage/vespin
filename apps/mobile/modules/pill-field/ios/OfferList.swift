// OfferList.swift -- what an `@` being typed offers, drawn by the pill field itself: the system's List in UIKit's own popover over the field, built once and kept, opened on the keystroke that types the `@` from a tree JavaScript handed over ahead of time, so no JavaScript stands between the key and the list (`packages/ui-native/src/offer-tree.ts`).
//
// The tree arrives as JSON in one string, the words it answers named in it.
// The list shows the newest tree it was handed, never an empty frame while
// the next is on its way; a press on a row goes back to JavaScript only
// when the tree shown answers the words the field now holds, else it waits
// for the tree that does, so no row older than the words is ever written.

import Combine
import SwiftUI
import UIKit

// MARK: - The tree

/// A glyph by its catalog's name or the system's.
struct OfferGlyphData: Decodable, Equatable {
  let asset: String?
  let system: String?
}

/// A row's mark, as `row-preview-model.ts`'s `suggestionMark` writes it: a glyph in its ink, an agent's tile, or a person's face.
struct OfferMarkData: Decodable, Equatable {
  let kind: String
  let asset: String?
  let system: String?
  let ink: String?
  let size: Double?
  let corner: Double?
  let well: String?
  let mark: TileMark?
  let glyph: TileGlyph?
  let hue: String?
  let letter: String?
  let letterSize: Double?
  let letterInk: String?
  let picture: String?

  struct TileMark: Decodable, Equatable {
    let asset: String
    let side: Double
  }

  struct TileGlyph: Decodable, Equatable {
    let asset: String?
    let system: String?
    let size: Double
  }
}

/// One row: its words, its mark, and whether a press narrows the list rather than naming it.
struct OfferRowData: Decodable, Equatable {
  let id: String
  let title: String
  let detail: String?
  let opens: Bool
  let mark: OfferMarkData
}

/// A group of rows under its header; a narrowed list's one group has none, its way back naming it.
struct OfferGroupData: Decodable, Equatable {
  let title: String?
  let rows: [OfferRowData]
}

/// A narrowed list's way back: the kind's words and mark.
struct OfferCrumbData: Decodable, Equatable {
  let title: String
  let mark: OfferMarkData
}

/// The inks the list draws in, the theme's, handed with each tree.
struct OfferInksData: Decodable, Equatable {
  let text: String
  let muted: String
  let selected: String
}

/// What an `@` word offers (`OfferTree`): the words it answers, its groups, its way back, what stands where nothing is offered, and its glyphs and inks.
struct OfferTreeData: Decodable, Equatable {
  let query: String
  let groups: [OfferGroupData]
  let crumb: OfferCrumbData?
  let empty: String?
  let chevron: OfferGlyphData
  let back: OfferGlyphData
  let inks: OfferInksData

  /// How many rows it holds across its groups, which a hardware keyboard's arrows step through.
  var rowCount: Int { groups.reduce(0) { $0 + $1.rows.count } }

  /// The group and row at a place counted across its groups.
  func place(_ flat: Int) -> (group: Int, row: Int)? {
    var left = flat
    for (group, each) in groups.enumerated() {
      if left < each.rows.count { return (group, left) }
      left -= each.rows.count
    }
    return nil
  }

  /// Where a row stands counted across its groups.
  func flat(group: Int, row: Int) -> Int {
    groups.prefix(group).reduce(0) { $0 + $1.rows.count } + row
  }

  /// The place of the row with this id, its group's first.
  func find(_ id: String) -> (group: Int, row: Int)? {
    for (group, each) in groups.enumerated() {
      if let row = each.rows.firstIndex(where: { $0.id == id }) { return (group, row) }
    }
    return nil
  }
}

/// A tree read from its JSON, or none where it reads as none.
func readOfferTree(_ json: String?) -> OfferTreeData? {
  guard let json, !json.isEmpty, let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(OfferTreeData.self, from: data)
}

// MARK: - The list's state

/// What the list shows: the tree, the row a hardware keyboard's arrows have chosen, its rows' height as the list measures it, and where its presses go.
final class OfferModel: ObservableObject {
  @Published var tree: OfferTreeData?
  @Published var chosen: Int?
  @Published var contentHeight: CGFloat = 0
  var onPick: ((Int, Int) -> Void)?
  var onBack: (() -> Void)?
}

// MARK: - The list

/// A color written `#rrggbb` or `#rrggbbaa`, as the brand's table writes them; clear where it reads as neither.
private func offerColor(_ hex: String?) -> Color {
  guard let hex else { return .clear }
  let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else { return .clear }
  let rgba = digits.count == 8 ? value : (value << 8) | 0xff
  return Color(
    .sRGB,
    red: Double((rgba >> 24) & 0xff) / 255,
    green: Double((rgba >> 16) & 0xff) / 255,
    blue: Double((rgba >> 8) & 0xff) / 255,
    opacity: Double(rgba & 0xff) / 255
  )
}

/// A glyph's image, from the asset catalog or the system's symbols.
private func offerImage(asset: String?, system: String?) -> Image {
  if let asset { return Image(asset) }
  return Image(systemName: system ?? "")
}

/// A row's mark, as `SuggestionMark` drew it: a glyph in its ink, an agent's tile, or a person's photo or letter.
private struct OfferMark: View {
  let mark: OfferMarkData

  var body: some View {
    let size = CGFloat(mark.size ?? 16)
    Group {
      switch mark.kind {
      case "tile":
        ZStack {
          RoundedRectangle(cornerRadius: CGFloat(mark.corner ?? 0)).foregroundStyle(offerColor(mark.well))
          if let tile = mark.mark {
            Image(tile.asset)
              .resizable()
              .frame(width: CGFloat(tile.side), height: CGFloat(tile.side))
              .foregroundStyle(offerColor(mark.ink))
          } else if let glyph = mark.glyph {
            offerImage(asset: glyph.asset, system: glyph.system)
              .font(.system(size: CGFloat(glyph.size)))
              .foregroundStyle(offerColor(mark.ink))
          }
        }
      case "face":
        OfferFace(mark: mark, size: size)
      default:
        offerImage(asset: mark.asset, system: mark.system)
          .font(.system(size: size))
          .foregroundStyle(offerColor(mark.ink))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// A person's face: their photo, or their letter on their hue where there is none or it can't be read, never while it loads.
private struct OfferFace: View {
  let mark: OfferMarkData
  let size: CGFloat

  var body: some View {
    if let picture = mark.picture, let url = URL(string: picture) {
      AsyncImage(url: url) { phase in
        switch phase {
        case .success(let image):
          image.resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
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

  private var letter: some View {
    ZStack {
      Circle().foregroundStyle(offerColor(mark.hue))
      Text(mark.letter ?? "")
        .font(.system(size: CGFloat(mark.letterSize ?? 0), weight: .semibold, design: .rounded))
        .foregroundStyle(offerColor(mark.letterInk))
    }
  }
}

/// What a narrowed list's way back is heard as, the panel's words for every kind.
private let widenWords = "All kinds"

/// How wide the column a row's mark stands centered in is, so every row's words start at one edge, as the app's rows stand theirs.
private let markColumn: CGFloat = 20

/// The list itself: the system's plain List, a Section per group under the system's header, its rows the system's buttons, a narrowed list under its way back, what stands where nothing is offered in the muted ink, and the row the arrows chose on the selected fill.
struct OfferListView: View {
  @ObservedObject var model: OfferModel
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    if let tree = model.tree {
      ScrollViewReader { proxy in
        List {
          if let crumb = tree.crumb {
            Section { back(tree, crumb) }
          }
          if tree.groups.isEmpty, let empty = tree.empty {
            Text(empty)
              .font(.subheadline)
              .foregroundStyle(offerColor(tree.inks.muted))
              .listRowBackground(Color.clear)
          }
          ForEach(Array(tree.groups.enumerated()), id: \.offset) { group, each in
            Section {
              ForEach(Array(each.rows.enumerated()), id: \.offset) { row, item in
                line(tree, item, group: group, row: row)
              }
            } header: {
              if let title = each.title {
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(offerColor(tree.inks.muted))
              }
            }
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.never)
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
          geometry.contentSize.height
        } action: { _, height in
          model.contentHeight = height
        }
        .onChange(of: model.chosen) { _, chosen in
          if let chosen { proxy.scrollTo(chosen, anchor: .center) }
        }
      }
    }
  }

  /// The way back out of a narrowed list, as the system's back reads: its chevron, the kind's mark and name, one press that widens the list again.
  private func back(_ tree: OfferTreeData, _ crumb: OfferCrumbData) -> some View {
    Button {
      model.onBack?()
    } label: {
      HStack(spacing: 4) {
        offerImage(asset: tree.back.asset, system: tree.back.system)
          .foregroundStyle(offerColor(tree.inks.muted))
        OfferMark(mark: crumb.mark)
        Text(crumb.title).font(.body.weight(.semibold)).foregroundStyle(offerColor(tree.inks.text))
      }
    }
    .listRowBackground(Color.clear)
    .accessibilityLabel(widenWords)
    .accessibilityHint(crumb.title)
  }

  /// One row: the system's button, its mark in the lead column, its name over a muted line, a kind's chevron at its end, on the selected fill where the arrows chose it.
  private func line(_ tree: OfferTreeData, _ item: OfferRowData, group: Int, row: Int) -> some View {
    let flat = tree.flat(group: group, row: row)
    let lines = typeSize.isAccessibilitySize ? nil : 1
    return Button {
      model.onPick?(group, row)
    } label: {
      HStack(spacing: 10) {
        OfferMark(mark: item.mark).frame(width: markColumn)
        VStack(alignment: .leading, spacing: 1) {
          Text(item.title).font(.body).foregroundStyle(offerColor(tree.inks.text)).lineLimit(lines)
          if let detail = item.detail {
            Text(detail).font(.subheadline).foregroundStyle(offerColor(tree.inks.muted)).lineLimit(lines)
          }
        }
        if item.opens {
          Spacer()
          offerImage(asset: tree.chevron.asset, system: tree.chevron.system)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(offerColor(tree.inks.muted))
            .accessibilityHidden(true)
        }
      }
    }
    .id(flat)
    .listRowBackground(model.chosen == flat ? offerColor(tree.inks.selected) : Color.clear)
    .accessibilityLabel(item.title)
  }
}

// MARK: - The popover

/// The most the list stands, in points, before it scrolls: about five rows and a half.
private let offerMost: CGFloat = 300

/// The least the list stands, in points: two rows, even where the window over the keyboard leaves less.
private let offerLeast: CGFloat = 100

/// What the room over the field holds besides the list: the screen's bar and a gap.
private let offerClear: CGFloat = 64

/// The list in UIKit's own popover over the field, its arrow down at it, built once the field first takes the keyboard and kept for the field's life, so an `@` only presents it. The page behind stays pressable, and the field keeps the keyboard and the words typed.
final class OfferController: NSObject, UIPopoverPresentationControllerDelegate {
  let model = OfferModel()
  /// Told as the system lets the popover go of its own, as VoiceOver's escape does.
  var onLetGo: (() -> Void)?
  private weak var anchor: UIView?
  private var heightKept: AnyCancellable?

  private lazy var host: UIHostingController<OfferListView> = {
    let host = UIHostingController(rootView: OfferListView(model: model))
    host.view.backgroundColor = .clear
    return host
  }()

  var shown: Bool { host.presentingViewController != nil }

  override init() {
    super.init()
    // Note that the popover follows the rows' height as the list measures it.
    heightKept = model.$contentHeight.dropFirst().sink { [weak self] _ in
      DispatchQueue.main.async { self?.fit() }
    }
  }

  /// Builds the list's controller and its view ahead of the first `@`, so it is never built on the keystroke.
  func prepare() {
    _ = host.view
  }

  /// Stands the list over `field`, from the view controller holding it.
  func show(over field: UIView) {
    guard !shown, let presenter = viewController(holding: field), presenter.presentedViewController == nil else { return }
    anchor = field
    host.modalPresentationStyle = .popover
    guard let popover = host.popoverPresentationController else { return }
    popover.sourceView = field
    popover.sourceRect = field.bounds
    popover.permittedArrowDirections = [.down]
    popover.delegate = self
    popover.passthroughViews = [presenter.view]
    fit()
    presenter.present(host, animated: true)
  }

  func hide() {
    guard shown else { return }
    host.dismiss(animated: true)
  }

  /// The popover's size: as wide as the field, as tall as its rows as measured, else guessed, within the room over the field.
  private func fit() {
    guard let anchor, let window = anchor.window else { return }
    let top = anchor.convert(anchor.bounds, to: window).minY
    let room = min(offerMost, max(offerLeast, top - window.safeAreaInsets.top - offerClear))
    let rows = CGFloat(model.tree?.rowCount ?? 0)
    let guessed = rows * 52 + CGFloat(model.tree?.groups.count ?? 0) * 34
    let tall = model.contentHeight > 0 ? model.contentHeight : guessed
    host.preferredContentSize = CGSize(width: anchor.bounds.width, height: min(room, max(tall, 44)))
  }

  /// The view controller a view stands in.
  private func viewController(holding view: UIView) -> UIViewController? {
    var responder: UIResponder? = view
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  func adaptivePresentationStyle(for controller: UIPresentationController, traitCollection: UITraitCollection) -> UIModalPresentationStyle {
    .none
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    onLetGo?()
  }
}
