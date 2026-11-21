/**
 * picture-viewer-module.ts -- the app's picture viewer (`modules/picture-viewer/`) as JavaScript reads it: a picture opened full screen, grown out of the thumbnail pressed.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import { type NativeModule, requireNativeModule } from "expo";

/** One picture the viewer opens: its address, its thumbnail's place in the window, in points, and the bar's words. */
interface ShownPicture {
  /** A `file://`, `data:`, or web address, read at full size while the thumbnail's own bitmap stands in. */
  readonly uri: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly subtitle: string | null;
}

declare class PictureViewerModule extends NativeModule {
  /** Opens `pictures` full screen at `index`, a swipe stepping through the rest; answers false where UIKit would not present it. */
  show(pictures: readonly ShownPicture[], index: number): Promise<boolean>;
}

/** The module. */
export const pictureViewerModule = requireNativeModule<PictureViewerModule>("PictureViewer");
