/**
 * keychain-cipher.ts -- the host's secret cipher on the iPhone: what the settings store seals the account's tokens with, and the entity store its lists, under one key the Keychain keeps, as `safeStorage` is on the Mac.
 *
 * The desktop hands its cipher straight to the Keychain
 * (`apps/desktop/src/main/services/keychain-service.ts`). The host's cipher
 * is synchronous and seals whole files, an entity store's lists among them,
 * where `expo-secure-store` keeps short strings, so the Keychain here keeps
 * one random 256-bit key (`keychain-key.ts`), made the first time something
 * is sealed, and the sealing is XChaCha20-Poly1305 under it
 * (`@repo/host/xchacha-cipher`). A kept file is sealed and opened by the
 * app's own native module (`sealer-module.ts`) in CryptoKit, since Hermes
 * took about 0.8 s a megabyte for the cipher and the base64 together; a
 * build without the module, such as Expo Go, seals in JavaScript, to the
 * same bytes. A launch's seal check (`-sealCheck true`) logs how long each
 * seal and open of the kept file took.
 *
 * A sign-out needs nothing of the key: the host deletes what it sealed, the
 * tokens and the kept lists, as it signs out.
 */

import { xchachaCipher } from "@repo/host/xchacha-cipher";
import { keychainKey } from "./keychain-key.js";
import { launchSealCheck } from "./launch-arguments.js";
import { keptFileTimed } from "./seal-check.js";
import { sealerModule } from "./sealer-module.js";

/** The Keychain item the key is kept under, in the app's own Keychain. */
const KEY_ITEM = "host-secret-key";

const cipher = xchachaCipher(keychainKey(KEY_ITEM), sealerModule);

/** The cipher the host's account source seals with. Each member reaches the Keychain, and a member it refuses throws, which the stores read as a cipher unavailable or a value that will not open. */
export const keychainCipher = launchSealCheck() ? keptFileTimed(cipher) : cipher;
