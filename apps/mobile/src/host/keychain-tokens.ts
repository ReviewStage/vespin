/**
 * keychain-tokens.ts -- the account's tokens kept in the iPhone's Keychain through `expo-secure-store`, as Expo documents keeping a credential, rather than sealed by the host into the settings file.
 *
 * The settings store hands the tokens' text here and keeps only who is
 * signed in in its file (`TokenVault`, `@repo/host`). The item is readable
 * after the first unlock since a restart, so a push or a Live Activity that
 * wakes the app in the background can still read it, and never leaves this
 * device. Tokens an older build sealed under the Keychain's key
 * (`keychain-cipher.ts`) are moved here by the settings store the first time
 * it reads them.
 */

import { EncryptedStorageUnavailable, type TokenVault } from "@repo/host";
import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";

/** The Keychain item the tokens are kept under, in the app's own Keychain. */
const TOKENS_ITEM = "account-tokens";

/** Readable after the first unlock since a restart, and never migrated to another device. */
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The account's tokens in the app's Keychain; a read the Keychain refuses reads as none, a write it refuses fails, and a delete it refuses is tried again by the settings store's next read while no one is signed in. */
export const keychainTokens: TokenVault = {
  read: Effect.orElseSucceed(
    Effect.tryPromise(() => SecureStore.getItemAsync(TOKENS_ITEM, KEYCHAIN_OPTIONS)),
    () => null,
  ).pipe(
    Effect.map((held) => held ?? undefined),
    // Note that the launch's first read is noted as its account phase, which `app:ready` counts.
    Effect.tap(() => Effect.sync(() => noteLaunchPhase(LAUNCH_PHASE.ACCOUNT))),
  ),
  write: (tokens) =>
    Effect.tryPromise({
      try: () => SecureStore.setItemAsync(TOKENS_ITEM, tokens, KEYCHAIN_OPTIONS),
      catch: () => new EncryptedStorageUnavailable(),
    }),
  clear: Effect.ignore(
    Effect.tryPromise(() => SecureStore.deleteItemAsync(TOKENS_ITEM, KEYCHAIN_OPTIONS)),
  ),
};
