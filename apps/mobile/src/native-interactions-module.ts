/**
 * native-interactions-module.ts -- the app's interactions module (`modules/native-interactions/`) as JavaScript calls it: lowering the keyboard whatever field holds it.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, leaves the keyboard where it stands.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class NativeInteractionsModule extends NativeModule {
  /** Lowers the keyboard, resigning whatever field holds it, a SwiftUI search field among them. */
  lowerKeyboard(): Promise<void>;
}

const nativeInteractionsModule =
  requireOptionalNativeModule<NativeInteractionsModule>("NativeInteractions");

/** Lowers the keyboard, as a pick from a list of results does in Mail and Notes; nothing in a build without the module. */
export function lowerKeyboard(): void {
  // Note that nothing waits on the keyboard's going, so the promise is left to settle on its own.
  void nativeInteractionsModule?.lowerKeyboard();
}
