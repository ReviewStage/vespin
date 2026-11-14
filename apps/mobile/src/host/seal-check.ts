/**
 * seal-check.ts -- the launch's seal check, `-sealCheck true`: the native sealer checked where it runs, on a simulator or a device, against the XChaCha draft's test vectors and against the JavaScript sealing every build before it wrote, both ways, under a key kept as the app keeps its own, and both timed on a megabyte; and, for the rest of the launch, each seal and open of the kept file timed.
 *
 * It runs once as the bundle loads, only where the launch asks, and logs
 * one line each, `[seal-check]` first: `PASS` or `FAIL` and the check's
 * name, the times, and the sizes. No line carries a key, a nonce, or any
 * text sealed, and the round trips seal text of the check's own in memory,
 * never the kept file. Its key is made and read through the app's own
 * Keychain path (`keychain-key.ts`) under an item of its own, so the
 * account's key is never read, and is deleted once the check is done.
 *
 * Note that the lines are logged as errors, since a Release build's React
 * Native log keeps nothing below an error, and these are read from a Release
 * build's log: `xcrun simctl spawn booted log show --last 5m --predicate
 * 'eventMessage CONTAINS "[seal-check]"'`.
 */

import type { SecretCipher } from "@repo/host";
import { xchachaCipher } from "@repo/host/xchacha-cipher";
import { Result } from "effect";
import { Base64 } from "effect/encoding";
import * as SecureStore from "expo-secure-store";
import { KEYCHAIN_OPTIONS, keychainKey } from "./keychain-key.js";
import { launchSealCheck } from "./launch-arguments.js";
import { sealerModule } from "./sealer-module.js";

/** The Keychain item the check's own key is kept under, never the account's. */
const CHECK_KEY_ITEM = "seal-check-key";

/** How much text the timings seal and open, about the kept file of 300 tasks and 900 agents. */
const TIMED_BYTES = 1024 * 1024;

/** One row of text like the kept file's, with letters outside ASCII, so the timings and round trips cross UTF-8 as the file does. */
const ROW =
  '{"id":"5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5","name":"Ünïcödé task ✓ 🚀","status":"in-progress"},';

function logLine(line: string): void {
  console.error(`[seal-check] ${line}`);
}

/** Megabytes, to two places. */
function megabytes(length: number): string {
  return (length / (1024 * 1024)).toFixed(2);
}

/** What `run` answered and how many milliseconds it took. */
function timed<A>(run: () => A): readonly [A, number] {
  const started = performance.now();
  const answer = run();

  return [answer, Math.round(performance.now() - started)];
}

/** Text of rows like the kept file's, about `bytes` long in UTF-8. */
function rows(bytes: number): string {
  const rowBytes = new TextEncoder().encode(ROW).length;

  return `[${ROW.repeat(Math.ceil(bytes / rowBytes))}null]`;
}

/** Runs `check` and logs whether it passed, a throw failing it by its words alone; answers whether it passed. */
function checked(name: string, check: () => boolean): boolean {
  let passed = false;
  let why = "";

  try {
    passed = check();
  } catch (error) {
    why = ` (${error instanceof Error ? error.message : "threw"})`;
  }

  logLine(`${passed ? "PASS" : "FAIL"} ${name}${why}`);

  return passed;
}

/** The sealing with one base64 letter in its middle changed, which still reads as base64. */
function changed(sealed: string): string {
  const at = Math.floor(sealed.length / 2);

  return `${sealed.slice(0, at)}${sealed[at] === "A" ? "B" : "A"}${sealed.slice(at + 1)}`;
}

/** The cipher `cipher` with each seal and open of the kept file logged by its size and time, and an open that failed logged as such. */
export function keptFileTimed(cipher: SecretCipher): SecretCipher {
  const { sealText, openText } = cipher;

  if (sealText === undefined || openText === undefined) return cipher;

  return {
    ...cipher,
    sealText: (plainText) => {
      const [sealed, ms] = timed(() => sealText(plainText));
      logLine(`kept file sealed natively: ${megabytes(sealed.length)} MB in ${ms} ms`);

      return sealed;
    },
    openText: (sealedText) => {
      try {
        const [plain, ms] = timed(() => openText(sealedText));
        logLine(`kept file opened natively: ${megabytes(sealedText.length)} MB in ${ms} ms`);

        return plain;
      } catch (error) {
        logLine(`FAIL kept file did not open natively: ${megabytes(sealedText.length)} MB`);
        throw error;
      }
    },
  };
}

/** The check: the vectors, the round trips both ways and a changed sealing refused, the timings, and the check's key deleted. */
function runSealCheck(): void {
  if (sealerModule === undefined) {
    logLine("FAIL the native sealer is not in this build");

    return;
  }

  const lines = sealerModule.vectorLines();
  lines.forEach(logLine);
  const keys = keychainKey(CHECK_KEY_ITEM);
  const noble = xchachaCipher(keys, undefined);
  const native = xchachaCipher(keys, sealerModule);
  const { sealText, openText } = native;
  const text = rows(4 * 1024);

  const results = [
    ...lines.map((line) => line.startsWith("PASS")),
    checked(
      "a sealing noble made, as every earlier build wrote the kept file, opens natively",
      () => openText?.(Base64.encode(noble.encrypt(text))) === text,
    ),
    checked(
      "a native sealing opens in noble, as a build without the module opens it",
      () =>
        sealText !== undefined &&
        noble.decrypt(Result.getOrThrow(Base64.decode(sealText(text)))) === text,
    ),
    checked("a changed native sealing is refused", () => {
      const sealed = changed(sealText?.(text) ?? "");

      try {
        openText?.(sealed);

        return false;
      } catch {
        return true;
      }
    }),
  ];

  const big = rows(TIMED_BYTES);
  const size = megabytes(new TextEncoder().encode(big).length);
  const [nobleSealed, nobleSeal] = timed(() => Base64.encode(noble.encrypt(big)));
  const [, nobleOpen] = timed(() => noble.decrypt(Result.getOrThrow(Base64.decode(nobleSealed))));
  const [nativeSealed, nativeSeal] = timed(() => sealText?.(big) ?? "");
  const [, nativeOpen] = timed(() => openText?.(nativeSealed));
  logLine(`${size} MB seal: noble and Base64 ${nobleSeal} ms, native ${nativeSeal} ms`);
  logLine(`${size} MB open: noble and Base64 ${nobleOpen} ms, native ${nativeOpen} ms`);

  const failed = results.filter((passed) => !passed).length;
  SecureStore.deleteItemAsync(CHECK_KEY_ITEM, KEYCHAIN_OPTIONS).then(
    () => logLine(`DONE ${results.length - failed} passed, ${failed} failed; check key deleted`),
    () =>
      logLine(
        `DONE ${results.length - failed} passed, ${failed} failed; FAIL check key not deleted`,
      ),
  );
}

if (launchSealCheck()) runSealCheck();
