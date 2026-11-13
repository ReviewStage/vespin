/**
 * rich-pasteboard-module.ts -- the app's rich copy module (`modules/rich-pasteboard/`) as JavaScript reads it: HTML and the plain words beside it put on the pasteboard as one item, its rich text read from the HTML.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, answers none and its caller copies through
 * expo-clipboard's HTML input instead.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class RichPasteboardModule extends NativeModule {
  /** Puts `html`, its rich text, and `text` on the pasteboard as one item. */
  copy(html: string, text: string): Promise<void>;
}

/** The module, or none in a build without it. */
export const richPasteboardModule =
  requireOptionalNativeModule<RichPasteboardModule>("RichPasteboard");
