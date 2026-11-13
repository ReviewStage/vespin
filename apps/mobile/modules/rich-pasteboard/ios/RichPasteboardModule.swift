// RichPasteboardModule.swift -- a copy of a draft's body as one pasteboard item holding its HTML, the rich text the system reads from it, and the plain words the app hands beside it, as the desktop writes HTML and plain words together.
//
// expo-clipboard's HTML input takes the plain words from the system's reading
// of the HTML, which keeps a link's label and drops its address, so a draft
// pasted where only plain text lands (Messages, a terminal) loses its links.
// Here the plain words are the app's own (`@repo/features/draft-text`'s
// `draftCopy`), a link's address after its label. The HTML is kept as the app
// wrote it, which Slack reads with its links and marks, and its rich text is
// the system's reading of it, which Mail and Notes paste. Note that the
// reading goes through WebKit, which runs on the main thread alone, and that
// HTML the system cannot read still leaves the HTML and the plain words on
// the pasteboard rather than an empty one.

import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// The HTML given as rich text, as the system reads it; none where it cannot.
private func richText(_ html: String) -> Data? {
  guard
    let read = try? NSAttributedString(
      data: Data(html.utf8),
      options: [
        .documentType: NSAttributedString.DocumentType.html,
        .characterEncoding: String.Encoding.utf8.rawValue,
      ],
      documentAttributes: nil
    )
  else { return nil }
  return try? read.data(
    from: NSRange(location: 0, length: read.length),
    documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
  )
}

public final class RichPasteboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RichPasteboard")

    AsyncFunction("copy") { (html: String, text: String) -> Void in
      var item: [String: Any] = [
        UTType.html.identifier: html,
        UTType.utf8PlainText.identifier: text,
      ]
      if let rtf = richText(html) { item[UTType.rtf.identifier] = rtf }
      UIPasteboard.general.setItems([item])
    }.runOnQueue(.main)
  }
}
