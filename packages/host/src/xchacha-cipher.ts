/**
 * xchacha-cipher.ts -- the host's secret cipher over a 256-bit key the platform keeps, as the iPhone's Keychain keeps one: XChaCha20-Poly1305 with a random nonce written in front of each sealing, sealed by the platform's native sealer where it has one and in JavaScript otherwise, to the same bytes either way.
 *
 * The format is `@noble/ciphers`' `managedNonce(xchacha20poly1305)`: a
 * 24-byte random nonce, then the ciphertext, then the 16-byte Poly1305 tag,
 * with no associated data. The files on phones were sealed in that format
 * by JavaScript alone, so a native sealer must write it byte for byte and
 * open what JavaScript sealed, and JavaScript must open what it sealed.
 *
 * A native sealer takes text and answers the sealed bytes already in base64,
 * and the reverse (`sealText`, `openText`), so neither the cipher nor the
 * base64 of a kept file runs in JavaScript, where Hermes takes about 0.8 s
 * a megabyte for the two. The bytes members stay in JavaScript, since what
 * they seal, the account's tokens, is small.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToUtf8, managedNonce, utf8ToBytes } from "@noble/ciphers/utils.js";
import { Base64 } from "effect/encoding";
import type { SecretCipher } from "./settings-store.js";

/** The key as the platform keeps it. */
export interface CipherKeys {
  /** The key held; throws where none was ever made, the platform refuses it, or it does not read. */
  held(): Uint8Array;
  /** The key to seal with: the one held, or a new one kept first. */
  sealing(): Uint8Array;
}

/** The platform's own sealing in this format, under a key handed in as base64; each throws where it cannot seal or the text does not open. */
export interface NativeSealer {
  /** `plainText` sealed under `key`, as base64. */
  seal(key: string, plainText: string): string;
  /** The text `sealedText`, base64 of a sealing, holds under `key`. */
  open(key: string, sealedText: string): string;
}

const sealer = managedNonce(xchacha20poly1305);

/** The cipher over `keys`, sealing kept text through `native` where the platform has it. */
export function xchachaCipher(keys: CipherKeys, native: NativeSealer | undefined): SecretCipher {
  const cipher: SecretCipher = {
    isAvailable: () => {
      try {
        keys.sealing();

        return true;
      } catch {
        return false;
      }
    },
    encrypt: (plainText) => sealer(keys.sealing()).encrypt(utf8ToBytes(plainText)),
    decrypt: (cipherText) => bytesToUtf8(sealer(keys.held()).decrypt(cipherText)),
  };

  if (native === undefined) return cipher;

  return {
    ...cipher,
    sealText: (plainText) => native.seal(Base64.encode(keys.sealing()), plainText),
    openText: (sealedText) => native.open(Base64.encode(keys.held()), sealedText),
  };
}
