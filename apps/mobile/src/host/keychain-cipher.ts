/**
 * keychain-cipher.ts -- the host's secret cipher on the iPhone: what the settings store seals the account's tokens with, and the entity store its lists, under one key the Keychain keeps, as `safeStorage` is on the Mac.
 *
 * The desktop hands its cipher straight to the Keychain
 * (`apps/desktop/src/main/services/keychain-service.ts`). The host's cipher
 * is synchronous and seals whole files, an entity store's lists among them,
 * where `expo-secure-store` keeps short strings, so the Keychain here keeps
 * one random 256-bit key, made the first time something is sealed, and the
 * sealing is XChaCha20-Poly1305 under it, each sealing with a random nonce
 * written in front of it (`@noble/ciphers`' `managedNonce`).
 *
 * The key is readable once the phone has been unlocked after a restart, so a
 * notification's action in the background can read the tokens and call the
 * service, and stays on this device: a backup restored on another phone
 * brings the settings file but not the key, so its tokens never open there
 * and the app starts signed out. A sign-out needs nothing of the key: the
 * host deletes what it sealed, the tokens and the kept lists, as it signs
 * out.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToUtf8, managedNonce, utf8ToBytes } from "@noble/ciphers/utils.js";
import type { SecretCipher } from "@repo/host";
import { Result } from "effect";
import { Base64 } from "effect/encoding";
import * as SecureStore from "expo-secure-store";

/** The Keychain item the key is kept under, in the app's own Keychain. */
const KEY_ITEM = "host-secret-key";

/** XChaCha20-Poly1305's key length. */
const KEY_BYTES = 32;

/** Readable after the first unlock since a restart, and never migrated to another device. */
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const sealer = managedNonce(xchacha20poly1305);

/** The key the Keychain holds, or none where none was ever made. */
function heldKey(): Uint8Array | undefined {
  const held = SecureStore.getItem(KEY_ITEM, KEYCHAIN_OPTIONS);
  if (held === null) return undefined;
  const key = Result.getOrUndefined(Base64.decode(held));
  if (key?.length !== KEY_BYTES) throw new Error("The Keychain's key does not read.");
  return key;
}

/** The key to seal with: the one held, or a new one kept in the Keychain first. */
function sealingKey(): Uint8Array {
  const held = heldKey();
  if (held !== undefined) return held;
  const made = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  SecureStore.setItem(KEY_ITEM, Base64.encode(made), KEYCHAIN_OPTIONS);
  return made;
}

/** The cipher the host's account source seals with. Each member reaches the Keychain, and a member it refuses throws, which the stores read as a cipher unavailable or a value that will not open. */
export const keychainCipher: SecretCipher = {
  isAvailable: () => {
    try {
      sealingKey();
      return true;
    } catch {
      return false;
    }
  },
  encrypt: (plainText) => sealer(sealingKey()).encrypt(utf8ToBytes(plainText)),
  decrypt: (cipherText) => {
    const key = heldKey();
    if (key === undefined) throw new Error("The Keychain holds no key to open this with.");
    return bytesToUtf8(sealer(key).decrypt(cipherText));
  },
};
