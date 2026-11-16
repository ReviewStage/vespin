import type { SecretCipher } from "@repo/host";
import type { EffectDesktopService } from "@repo/host/desktop-service";
import { Effect } from "effect";
import { safeStorage } from "electron";

export interface KeychainService extends EffectDesktopService {
  /** The one cipher the host encrypts a credential with, and the one place `safeStorage` is named. */
  readonly cipher: SecretCipher;
}

/**
 * This machine's own credential protection, as the seam the host takes.
 * Nothing here asks whether the Keychain will answer: every member of the
 * cipher reaches it, `isAvailable` included, so asking is a Keychain read and
 * the permission dialog that comes with one. The store asks at most once per
 * run, and only from a path that already holds a credential to protect.
 */
export function createKeychainService(): KeychainService {
  return {
    name: "keychain",
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plainText) => safeStorage.encryptString(plainText),
      decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText)),
      // Note that the base64 is Node's own, because the entity store seals its whole file every 30 seconds and a JavaScript base64 of 20 MB allocates about 400 MB each time.
      sealText: (plainText) => safeStorage.encryptString(plainText).toString("base64"),
      openText: (sealedText) => safeStorage.decryptString(Buffer.from(sealedText, "base64")),
    },
    start: () => Effect.void,
    stop: () => Effect.void,
  };
}
