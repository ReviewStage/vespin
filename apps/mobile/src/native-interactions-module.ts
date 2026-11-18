/**
 * native-interactions-module.ts -- the app's interactions module (`modules/native-interactions/`) as JavaScript calls it: lowering the keyboard whatever field holds it.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import { type NativeModule, requireNativeModule } from "expo";

declare class NativeInteractionsModule extends NativeModule {
  /** Lowers the keyboard, ending editing in every window, a SwiftUI search field among them; answers whether any field let go. */
  lowerKeyboard(): Promise<boolean>;
}

const nativeInteractionsModule =
  requireNativeModule<NativeInteractionsModule>("NativeInteractions");

/** Lowers the keyboard, as a pick from a list of results does in Mail and Notes. */
export function lowerKeyboard(): void {
  // Note that nothing waits on the keyboard's going, so the promise is left to settle on its own.
  void nativeInteractionsModule.lowerKeyboard();
}
