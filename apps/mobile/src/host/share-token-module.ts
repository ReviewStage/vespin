/**
 * share-token-module.ts -- the app's share-token module (`modules/share-token/`) as JavaScript reads it: the account's current access token kept in the Keychain item the share extension reads, or removed.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, keeps no token and the share sheet keeps its
 * draft for New task instead.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";
import type { KeepShareToken } from "./share-token-account.js";

declare class ShareTokenModule extends NativeModule {
  /** Keeps `token` as the item, or removes the item for none; answers whether the Keychain took it. */
  keep(token: string | null): boolean;
}

const shareTokenModule = requireOptionalNativeModule<ShareTokenModule>("ShareToken");

/** Keeps the token given where the share sheet reads it, or removes it; nothing in a build without the module. Note that a Keychain that refuses it, as an unsigned simulator build's does, leaves the share sheet keeping drafts. */
export const keepShareToken: KeepShareToken = (token) => {
  shareTokenModule?.keep(token ?? null);
};
