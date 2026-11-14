/**
 * sealer-module.ts -- the app's sealer (`modules/sealer/`) as JavaScript reads it: text sealed under a key and answered as base64, and the reverse, in CryptoKit, and the XChaCha draft's test vectors run through that code for a launch's seal check.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, answers none and seals in JavaScript.
 */

import type { NativeSealer } from "@repo/host/xchacha-cipher";
import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class SealerModule extends NativeModule implements NativeSealer {
  seal(key: string, plainText: string): string;
  open(key: string, sealedText: string): string;
  /** One line for each of the draft's test vectors: `PASS` or `FAIL`, then its name. */
  vectorLines(): string[];
}

/** The module, or none in a build without it. */
export const sealerModule = requireOptionalNativeModule<SealerModule>("Sealer") ?? undefined;
