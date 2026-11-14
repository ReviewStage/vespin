/**
 * xchacha-cipher.test.ts -- the JavaScript cipher keeps the format the phones' files and tokens were sealed in: it opens a sealing `@noble/ciphers` made before the native sealer existed and one the native sealer made, and what it seals opens through `@noble/ciphers` as it stood.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToUtf8, managedNonce } from "@noble/ciphers/utils.js";
import { Result } from "effect";
import { Base64 } from "effect/encoding";
import { expect, it } from "vitest";
import { xchachaCipher } from "./xchacha-cipher.js";

/** The key of draft-irtf-cfrg-xchacha-03's AEAD test vector (A.3.1), bytes 0x80 to 0x9f. */
const KEY = Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index);

const TEXT = '{"accountId":"7d3f","reads":{"tasks":[{"name":"Ünïcödé ✓ 🚀 kept"}]}}';

/** `TEXT` sealed under `KEY`, as base64, by each sealer the phones have run. */
const SEALED = {
  // `managedNonce(xchacha20poly1305)` of @noble/ciphers 2.3.0, as every build before the native sealer sealed.
  NOBLE:
    "fAuFEJdZYwpK2FHqz4hfw7rYcgZwhtBzcMI1FZj8Yv6EYlo8j8TYAvzzLyrnhUHqw89QgtUh2BpWx89XEXoFwQmYZpe1zMkm63qOqdrX14d5dh6uFZX/EMykluEiwqY3ZRqeXBhIeO8bp4FC6N/8lMkYq+kj",
  // The app's native sealer (`apps/mobile/modules/sealer/ios/XChaChaPoly.swift`), run on swift-crypto.
  NATIVE:
    "C3Pxn3WL9ch3Yo8jUgtNFXP6PwXeVWP1bMK2F2uQAfogRq9OOgcAOYMQBQGf0S/ttGndv/1Bx4km2SiWVxwrC6yjGQH8hmznu6WoZsOrSQVMuYb9+1XskGQRwqxeE7gB2Gtqvl1ovPiRyjIFW4hOVA9zml6n",
} as const;

/** The JavaScript cipher, as a build without the native sealer stands it, over `KEY`. */
const cipher = xchachaCipher({ held: () => KEY, sealing: () => KEY }, undefined);

it.each(Object.entries(SEALED))("opens what %s sealed", (_, sealed) => {
  expect(cipher.decrypt(Result.getOrThrow(Base64.decode(sealed)))).toBe(TEXT);
});

it("seals what @noble/ciphers' managed nonce opens", () => {
  expect(bytesToUtf8(managedNonce(xchacha20poly1305)(KEY).decrypt(cipher.encrypt(TEXT)))).toBe(
    TEXT,
  );
});
