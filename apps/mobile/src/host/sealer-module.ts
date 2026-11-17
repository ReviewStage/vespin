/**
 * sealer-module.ts -- the app's sealer (`modules/sealer/`) as JavaScript reads it: text sealed under a key and answered as base64, and the reverse, in CryptoKit, and the XChaCha draft's test vectors run through that code for a launch's seal check.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import type { NativeSealer } from "@repo/host/xchacha-cipher";
import { type NativeModule, requireNativeModule } from "expo";

declare class SealerModule extends NativeModule implements NativeSealer {
  seal(key: string, plainText: string): string;
  open(key: string, sealedText: string): string;
  /** One line for each of the draft's test vectors: `PASS` or `FAIL`, then its name. */
  vectorLines(): string[];
}

/** The module. */
export const sealerModule = requireNativeModule<SealerModule>("Sealer");
