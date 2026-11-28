// SharedItems.swift -- what another app shared, read for the share page: its words, its web link and the page's title, and its pictures as JPEG files.
//
// An item may carry its words as the item's own content text, as a plain
// text attachment, or both, and its link as a URL attachment, one provider
// offering both a link and its caption; each is read, in that order. A file
// URL is not a web link, so it is left out. The page lays these into its
// field (`@repo/features/ios-share-extension`'s `sharedField`), which drops
// the same words twice and a link the words already hold.
//
// A picture is read as the page sends it, a JPEG within the service's bounds
// for a message's files (`AGENT_BOUNDS`, `@repo/features/agent-wire`):
// scaled down as it is decoded, so a large photo never stands whole in the
// extension's small memory, then encoded smaller until it fits. The
// pictures are kept in order while they fit together, and the rest are
// counted as left out. Each is decoded upright at its scaled size, one at a
// time, and the JPEG is written from those pixels alone, so none of the
// source's metadata (its GPS, EXIF or TIFF) leaves the phone. Each is written
// to a file of its own under the extension's temporary folder, which the
// page draws its pill from and reads as it sends, and which goes with the
// sheet.

import Foundation
import ImageIO
import UniformTypeIdentifiers

enum SharedItems {
  /// The service's bounds on a message's files (`AGENT_BOUNDS`): one image's bytes, and all of them together.
  private static let maxImageBytes = 1_500_000
  private static let maxBytes = 3_000_000
  /// The most pictures the sheet takes, one per draft picture file (`SHARE_DRAFT_PICTURE_FILES`) and the activation rule's count.
  static let maxPictures = 4
  /// Each try at a JPEG that fits: its longest side in pixels and its quality, the first that fits kept.
  private static let encodings: [(side: Int, quality: Double)] = [(2048, 0.7), (1600, 0.6), (1200, 0.5)]
  /// The folder the pictures are written to, which the sheet's end removes.
  private static let folder = FileManager.default.temporaryDirectory
    .appendingPathComponent("shared-pictures", isDirectory: true)

  /// What `items` share, for the page: `texts`, `links`, the page's `title`, the `pictures`' file addresses, and how many pictures were `leftOut`.
  static func read(_ items: [NSExtensionItem]) async -> [String: Any] {
    var texts: [String] = []
    var links: [String] = []
    var title: String?
    for item in items {
      if let content = item.attributedContentText?.string { texts.append(content) }
      if title == nil, let named = item.attributedTitle?.string, !named.isEmpty { title = named }
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
    let (pictures, leftOut) = await pictures(of: items)
    var read: [String: Any] = ["texts": texts, "links": links, "pictures": pictures, "leftOut": leftOut]
    if let title { read["title"] = title }
    return read
  }

  /// The pictures `items` share, each as a JPEG file that fits, in order while they fit together, and how many did not.
  private static func pictures(of items: [NSExtensionItem]) async -> ([String], Int) {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var kept: [String] = []
    var leftOut = 0
    var bytes = 0
    for provider in items.flatMap({ $0.attachments ?? [] })
    where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      guard !Task.isCancelled, kept.count < maxPictures,
        let data = await data(from: provider, as: .image),
        let source = CGImageSourceCreateWithData(data as CFData, nil),
        let jpeg = jpeg(source), bytes + jpeg.count <= maxBytes
      else {
        leftOut += 1
        continue
      }
      let file = folder.appendingPathComponent("\(UUID().uuidString).jpg")
      guard (try? jpeg.write(to: file, options: [.atomic, .completeFileProtection])) != nil else {
        leftOut += 1
        continue
      }
      bytes += jpeg.count
      // Note that the page is handed the file's address, which the pill field draws its thumbnail from.
      kept.append(file.absoluteString)
    }
    return (kept, leftOut)
  }

  /// The bytes of a picture this sheet wrote, by its file's address, or none for any other file, so the page reads nothing else of the extension's.
  static func picture(_ address: String) -> Data? {
    guard let named = URL(string: address), named.isFileURL else { return nil }
    let file = named.standardizedFileURL
    guard file.deletingLastPathComponent().path == folder.standardizedFileURL.path else { return nil }
    return try? Data(contentsOf: file)
  }

  /// Removes every picture this sheet wrote.
  static func removePictures() {
    try? FileManager.default.removeItem(at: folder)
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
}
