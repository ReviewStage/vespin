/**
 * share-token-module.ts -- the app's share-token module (`modules/share-token/`) as JavaScript reads it: each access token the account is issued, with when to stop sending it, kept in the Keychain item the share extension reads, or removed.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import type { KeepIssuedToken } from "@repo/host/effect";
import { type NativeModule, requireNativeModule } from "expo";

declare class ShareTokenModule extends NativeModule {
  /** Keeps `token`, sent until `expiresAt` (epoch milliseconds), as the item, or removes the item for none; answers whether the Keychain took it. */
  keep(token: string | null, expiresAt: number | null): boolean;
}

const shareTokenModule = requireNativeModule<ShareTokenModule>("ShareToken");

/** Keeps the token given where the share sheet reads it, or removes it; answers whether the Keychain took it. Note that a Keychain that refuses it, as an unsigned simulator build's does, leaves the share sheet keeping drafts. */
export const keepShareToken: KeepIssuedToken = (shared) =>
  shareTokenModule.keep(shared?.token ?? null, shared?.expiresAt ?? null);
