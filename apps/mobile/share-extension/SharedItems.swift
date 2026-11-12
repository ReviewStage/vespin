// SharedItems.swift -- what another app shared, read as what a task starts from: its text, then its web link on a line of its own, and its pictures.
//
// An item may carry its words as the item's own content text, as a plain
// text attachment, or both, and its link as a URL attachment, one provider
// offering both a link and its caption; each is read, in that order, and the
// same words or link twice are kept once. A
// file URL is not a web link, so it is left out.
//
// A picture is read as Start sends it, a JPEG within the service's bounds
// for a message's files (`AGENT_BOUNDS`, `@repo/features/agent-wire`):
// scaled down as it is decoded, so a large photo never stands whole in the
// extension's small memory, then encoded smaller until it fits. The
// pictures are kept in order while they fit together, and the rest are
// counted as left out. Each is decoded upright at its scaled size, one at a
// time, and the JPEG is written from those pixels alone, so none of the
// source's metadata (its GPS, EXIF or TIFF) leaves the phone.

import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A picture shared: the JPEG Start sends, and a small copy the sheet draws.
struct SharedPicture: Identifiable {
  let id = UUID()
  let jpeg: Data
  let preview: CGImage?
}

/// The pictures shared that fit one message, and how many didn't.
struct SharedPictures {
  let kept: [SharedPicture]
  let leftOut: Int
}

enum SharedItems {
  /// The service's bounds on a message's files (`AGENT_BOUNDS`): one image's bytes, and all of them together.
  private static let maxImageBytes = 1_500_000
  private static let maxBytes = 3_000_000
  /// The most pictures the sheet takes, one per draft picture file (`SHARE_DRAFT_PICTURE_FILES`) and the activation rule's count.
  static let maxPictures = 4
  /// Each try at a JPEG that fits: its longest side in pixels and its quality, the first that fits kept.
  private static let encodings: [(side: Int, quality: Double)] = [(2048, 0.7), (1600, 0.6), (1200, 0.5)]
  /// The longest side, in pixels, of the copy the sheet draws, so a row of them costs little memory.
  private static let previewSide = 240

  /// The words `items` share, their text first and their link last; empty where they share neither.
  static func words(of items: [NSExtensionItem]) async -> String {
    var texts: [String] = []
    var links: [String] = []
    for item in items {
      if let content = item.attributedContentText?.string { texts.append(content) }
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
          let url = await load(URL.self, from: provider, as: .url), !url.isFileURL
        {
          links.append(url.absoluteString)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
          let text = await load(String.self, from: provider, as: .plainText)
        {
          texts.append(text)
        }
      }
    }
    let kept = unique(texts.map(trimmed)) + unique(links).filter { link in
      !texts.contains { $0.contains(link) }
    }
    return kept.filter { !$0.isEmpty }.joined(separator: "\n\n")
  }

  /// The pictures `items` share, each as a JPEG that fits, in order while they fit together.
  static func pictures(of items: [NSExtensionItem]) async -> SharedPictures {
    var kept: [SharedPicture] = []
    var leftOut = 0
    var bytes = 0
    for provider in items.flatMap({ $0.attachments ?? [] })
    where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      guard kept.count < maxPictures, let data = await data(from: provider, as: .image),
        let source = CGImageSourceCreateWithData(data as CFData, nil),
        let jpeg = jpeg(source), bytes + jpeg.count <= maxBytes
      else {
        leftOut += 1
        continue
      }
      bytes += jpeg.count
      kept.append(SharedPicture(jpeg: jpeg, preview: scaled(source, side: previewSide)))
    }
    return SharedPictures(kept: kept, leftOut: leftOut)
  }

  /// `source`'s image, upright, at most `side` pixels on its longest side, decoded at that size.
  private static func scaled(_ source: CGImageSource, side: Int) -> CGImage? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: side,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  /// `source`, an image of any kind iOS reads, as a JPEG within one image's bound, or none where it never fits.
  private static func jpeg(_ source: CGImageSource) -> Data? {
    for encoding in encodings {
      let out = NSMutableData()
      guard let image = scaled(source, side: encoding.side),
        let destination = CGImageDestinationCreateWithData(
          out, UTType.jpeg.identifier as CFString, 1, nil)
      else { return nil }
      let quality: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: encoding.quality]
      CGImageDestinationAddImage(destination, image, quality as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { return nil }
      if out.length <= maxImageBytes { return out as Data }
    }
    return nil
  }

  /// The provider's bytes as `type`, or none where it holds none.
  private static func data(from provider: NSItemProvider, as type: UTType) async -> Data? {
    await withCheckedContinuation { continuation in
      _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
        continuation.resume(returning: data)
      }
    }
  }

  /// The provider's item as `type`, or none where it holds none or another kind.
  private static func load<Value>(_: Value.Type, from provider: NSItemProvider, as type: UTType) async
    -> Value?
  {
    await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { item, _ in
        continuation.resume(returning: item as? Value)
      }
    }
  }

  private static func trimmed(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// `values` with each kept once, in the order first seen.
  private static func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
  }
}
