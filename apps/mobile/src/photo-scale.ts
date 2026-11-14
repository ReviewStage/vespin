/**
 * photo-scale.ts -- the app's photo-scale module (`modules/photo-scale/`), which draws a picked or dropped picture as a JPEG through ImageIO: a workspace photo's center square, or a message's picture fitted whole under its bound.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app; it is none in a build without it, such as Expo Go.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class PhotoScaleModule extends NativeModule {
  /** The photo at `uri` as a JPEG of its center square, `edge` pixels a side, in base64, at most `maxBytes` long; none where it cannot be read or never fits. */
  squareJpeg(uri: string, edge: number, maxBytes: number): Promise<string | null>;
  /** The picture at `uri` whole, upright, as a JPEG in base64, its longest side (at most 2048 px) and quality stepped down until it is at most `maxBytes` long; the smallest try where none fits; none where it cannot be read. */
  fitJpeg(uri: string, maxBytes: number): Promise<string | null>;
}

/** The module, or none in a build without it. */
export const photoScaleModule = requireOptionalNativeModule<PhotoScaleModule>("PhotoScale");
