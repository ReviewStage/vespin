// PhotoScaleModule.swift -- a picked photo drawn as a workspace's photo on the phone: its center square, upright, at a side of pixels the JavaScript names, written as a JPEG within the service's bound, as the share extension scales a shared picture through ImageIO (`share-extension/SharedItems.swift`).
//
// The photo picker hands back a file of whatever kind the library holds,
// HEIC among them, at full size; ImageIO decodes it at the size asked rather
// than whole, turns it upright, and the JPEG it writes keeps none of the
// original's metadata, its place among it. The quality steps down until the
// JPEG fits the bound, and a photo that never fits answers none.

import CoreGraphics
import ExpoModulesCore
import Foundation
import ImageIO
import UniformTypeIdentifiers

public final class PhotoScaleModule: Module {
  /// The JPEG qualities tried in turn, the first that fits the bound kept.
  private static let qualities: [Double] = [0.85, 0.7, 0.55, 0.4]

  public func definition() -> ModuleDefinition {
    Name("PhotoScale")

    // The photo at `uri` as a JPEG of its center square, `edge` pixels a side, in base64, at most `maxBytes` long; none where it cannot be read or never fits.
    AsyncFunction("squareJpeg") { (uri: String, edge: Int, maxBytes: Int) -> String? in
      // Note that the picker names a file by its `file://` address, and a bare path is read as one too.
      let url = uri.hasPrefix("file:") ? URL(string: uri) : URL(fileURLWithPath: uri)
      guard let url,
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let square = Self.square(source, edge: edge)
      else { return nil }
      for quality in Self.qualities {
        guard let jpeg = Self.jpeg(square, quality: quality) else { return nil }
        if jpeg.count <= maxBytes { return jpeg.base64EncodedString() }
      }
      return nil
    }
  }

  /// `source`'s image, upright, its shorter side drawn at `edge` pixels, cut to its center square.
  private static func square(_ source: CGImageSource, edge: Int) -> CGImage? {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0
    else { return nil }
    // Note that the thumbnail is bounded by its longer side, so it is asked at the size that draws the shorter one at `edge`, and never larger than the photo.
    let longer = max(width, height)
    let shorter = min(width, height)
    let side = min(longer, Int((Double(edge) * Double(longer) / Double(shorter)).rounded(.up)))
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: side,
    ]
    guard let scaled = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    let cut = min(scaled.width, scaled.height)
    let crop = CGRect(
      x: (scaled.width - cut) / 2, y: (scaled.height - cut) / 2, width: cut, height: cut)
    return scaled.cropping(to: crop)
  }

  /// `image` as a JPEG at `quality`, or none where ImageIO refuses it.
  private static func jpeg(_ image: CGImage, quality: Double) -> Data? {
    let out = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        out, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    return CGImageDestinationFinalize(destination) ? out as Data : nil
  }
}
