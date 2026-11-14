/**
 * keychain-key.ts -- the host cipher's 256-bit key as the Keychain keeps it, through `expo-secure-store`: read from its item, or made and kept there the first time something is sealed.
 *
 * The key is readable once the phone has been unlocked after a restart, so a
 * notification's action in the background can read the tokens and call the
 * service, and stays on this device: a backup restored on another phone
 * brings the settings file but not the key, so its tokens never open there
 * and the app starts signed out. The launch's seal check
 * (`seal-check.ts`) keeps its own key the same way under an item of its own.
 */

import type { CipherKeys } from "@repo/host/xchacha-cipher";
import { Result } from "effect";
import { Base64 } from "effect/encoding";
import * as SecureStore from "expo-secure-store";

/** XChaCha20-Poly1305's key length. */
const KEY_BYTES = 32;

/** Readable after the first unlock since a restart, and never migrated to another device. */
export const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The key `item` holds, or none where none was ever made. */
function keptKey(item: string): Uint8Array | undefined {
  const held = SecureStore.getItem(item, KEYCHAIN_OPTIONS);

  if (held === null) return undefined;
  const key = Result.getOrUndefined(Base64.decode(held));

  if (key?.length !== KEY_BYTES) throw new Error("The Keychain's key does not read.");

  return key;
}

/** The key kept under the Keychain item `item`. Each member reaches the Keychain, and one it refuses throws. */
export function keychainKey(item: string): CipherKeys {
  return {
    held: () => {
      const key = keptKey(item);

      if (key === undefined) throw new Error("The Keychain holds no key to open this with.");

      return key;
    },
    sealing: () => {
      const held = keptKey(item);

      if (held !== undefined) return held;
      const made = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
      SecureStore.setItem(item, Base64.encode(made), KEYCHAIN_OPTIONS);

      return made;
    },
  };
}
