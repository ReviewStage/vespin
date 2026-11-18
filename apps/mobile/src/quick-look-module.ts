/**
 * quick-look-module.ts -- the app's Quick Look module (`modules/quick-look/`) as JavaScript reads it: a file on the device opened full screen in the system's Quick Look.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import { type NativeModule, requireNativeModule } from "expo";

declare class QuickLookModule extends NativeModule {
  /**
   * Opens the file at `uri`, a `file://` address, in Quick Look, titled
   * `title`; answers false where Quick Look can't read it, or UIKit would
   * not present it.
   */
  preview(uri: string, title: string | null): Promise<boolean>;
}

/** The module. */
export const quickLookModule = requireNativeModule<QuickLookModule>("QuickLook");
