// SharedItems.swift -- what another app shared, read as the words a task starts from: its text, then its web link on a line of its own.
//
// An item may carry its words as the item's own content text, as a plain
// text attachment, or both, and its link as a URL attachment, one provider
// offering both a link and its caption; each is read, in that order, and the
// same words or link twice are kept once. A
// file URL is not a web link, so it is left out.

import Foundation
import UniformTypeIdentifiers

enum SharedItems {
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
