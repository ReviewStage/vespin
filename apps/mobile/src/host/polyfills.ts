/**
 * polyfills.ts -- what Hermes lacks of the web platform the host stands on, each filled in once here as the app starts, before anything of the host loads.
 *
 * React Native and Expo already stand up most of the platform the host was
 * written against: `URL` with `canParse`, `fetch`, `Response`, `Headers`,
 * `TextEncoder`, `WebSocket`, `AbortController`, `structuredClone`,
 * `queueMicrotask`, `WeakRef`, and `FinalizationRegistry` are all there.
 * What a Release build on the simulator found missing is filled in below,
 * each with why the host needs it, and nothing else: `MessageChannel` is
 * missing too, and the act port runs over `in-process-channel.ts` instead.
 */

// The device's zone, read from Hermes's own `Intl.DateTimeFormat` before
// FormatJS's replaces it below, so this import stands first.
import { SYSTEM_TIME_ZONE } from "./system-time-zone.js";
// `Intl.PluralRules` and `Intl.ListFormat`: Hermes has neither, and the
// host's words make them at module load (`@repo/features/words.ts`), so a
// bundle without them cannot even evaluate. FormatJS fills them in, with
// `Intl.Locale` and `Intl.getCanonicalLocales` they stand on, for English,
// the one locale the words name. Each `polyfill` entry installs only where
// the runtime lacks the API.
import "@formatjs/intl-getcanonicallocales/polyfill.js";
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-listformat/polyfill.js";
import "@formatjs/intl-listformat/locale-data/en.js";
// `Intl.Segmenter`: Hermes lacks it, and a task section's emoji is told
// from a word by its graphemes (`@repo/features/task-section-wire.ts`).
import "@formatjs/intl-segmenter/polyfill.js";
// `Intl.DateTimeFormat`: Hermes has one, but two faults in it break every
// date the host counts in the reader's zone (`@repo/features/date-mention.ts`'s
// Today and Tomorrow, through Effect's `DateTime.makeZoned`). Its
// `formatToParts` types each part by the part's index into the pattern's
// letters rather than by the letters that drew it, so the offset Effect reads
// from the `timeZoneName` part is some other field; and it names the device's
// zone as `NSTimeZone` does, `GMT` for UTC, which Effect reads as an offset
// with none written. FormatJS's replacement is forced over it, with every
// zone's rules, since the reader's zone is known only on the device.
import "@formatjs/intl-datetimeformat/polyfill-force.js";
import "@formatjs/intl-datetimeformat/locale-data/en.js";
import "@formatjs/intl-datetimeformat/add-all-tz.js";
import type { DateTimeFormatConstructor as FormatJsDateTimeFormat } from "@formatjs/intl-datetimeformat";
import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from "expo-crypto";

/** The minutes in an hour, which a zone's offset is counted in. */
const MINUTES_PER_HOUR = 60;

/**
 * The `Etc/GMT` zone of the device clock's offset now, whose sign POSIX
 * writes reversed (`Etc/GMT-1` is an hour ahead of UTC), or UTC where the
 * offset is no whole number of hours, which no `Etc` zone names.
 */
function offsetTimeZone(): string {
  const behind = new Date().getTimezoneOffset();
  if (behind === 0 || behind % MINUTES_PER_HOUR !== 0) return "UTC";
  const hours = behind / MINUTES_PER_HOUR;
  return `Etc/GMT${hours > 0 ? "+" : "-"}${Math.abs(hours)}`;
}

// FormatJS's `Intl.DateTimeFormat` starts in UTC, so it is handed the zone
// Hermes read: its IANA name, or, where `NSTimeZone` gave `GMT` or a bare
// offset such as `GMT+0100`, which FormatJS cannot place, the offset's zone.
// SAFETY: `Intl.DateTimeFormat` is FormatJS's from the forced polyfill above, which adds `__setDefaultTimeZone`.
const zonedFormat = Intl.DateTimeFormat as unknown as FormatJsDateTimeFormat;
try {
  zonedFormat.__setDefaultTimeZone(
    SYSTEM_TIME_ZONE.startsWith("GMT") ? offsetTimeZone() : SYSTEM_TIME_ZONE,
  );
} catch {
  zonedFormat.__setDefaultTimeZone(offsetTimeZone());
}

/** The digests the web's `crypto.subtle.digest` names, as `expo-crypto` names them. */
const DIGEST_ALGORITHM: Readonly<Record<string, CryptoDigestAlgorithm>> = {
  "SHA-1": CryptoDigestAlgorithm.SHA1,
  "SHA-256": CryptoDigestAlgorithm.SHA256,
  "SHA-384": CryptoDigestAlgorithm.SHA384,
  "SHA-512": CryptoDigestAlgorithm.SHA512,
};

/** The algorithm a `digest` call names, by the name alone or as `{ name }`. */
function algorithmNamed(algorithm: AlgorithmIdentifier): CryptoDigestAlgorithm {
  const name = typeof algorithm === "string" ? algorithm : algorithm.name;
  const named = DIGEST_ALGORITHM[name.toUpperCase()];
  if (named === undefined) throw new Error(`Unrecognized digest algorithm: ${name}`);
  return named;
}

// `crypto`: React Native has no WebCrypto at all. The host draws random
// bytes for a webhook secret and a sign-in's verifier
// (`compose-automations.ts`, `@repo/credentials`'s `pkce.ts`) and hashes
// the schema of the rows it keeps with SHA-256 as its store opens
// (`entity-store.ts`); `expo-crypto`'s native module answers each, and
// nothing else of `SubtleCrypto` is stood up.
if (globalThis.crypto === undefined) {
  const subtle: Pick<SubtleCrypto, "digest"> = {
    digest: (algorithm, data) => digest(algorithmNamed(algorithm), data),
  };
  // SAFETY: the host calls `getRandomValues`, `randomUUID`, and `subtle.digest` alone of `Crypto`.
  globalThis.crypto = { getRandomValues, randomUUID, subtle } as unknown as Crypto;
}

/** The index `with` names, counted from the end where negative, or none where it names no element. */
function indexWithin(length: number, index: number): number | undefined {
  const at = index < 0 ? length + index : index;
  return at >= 0 && at < length ? at : undefined;
}

// Change array by copy (`toSorted`, `toReversed`, `toSpliced`, `with`):
// Hermes has none of the four, and the host and its features sort and
// reverse by copy throughout (`inbox-live.ts`, `task-list-live.ts`,
// `sidebar-collections.ts`, among many).
if (typeof Array.prototype.toSorted !== "function") {
  const copying: Record<string, (this: readonly unknown[], ...args: never[]) => unknown[]> = {
    toSorted(compare?: (a: unknown, b: unknown) => number) {
      return [...this].sort(compare);
    },
    toReversed() {
      return [...this].reverse();
    },
    toSpliced(start: number, deleteCount?: number, ...items: unknown[]) {
      const copy = [...this];
      if (deleteCount === undefined) copy.splice(start);
      else copy.splice(start, deleteCount, ...items);
      return copy;
    },
    with(index: number, value: unknown) {
      const at = indexWithin(this.length, index);
      if (at === undefined) throw new RangeError(`Invalid index : ${index}`);
      const copy = [...this];
      copy[at] = value;
      return copy;
    },
  };
  for (const [name, method] of Object.entries(copying)) {
    Object.defineProperty(Array.prototype, name, {
      value: method,
      writable: true,
      configurable: true,
    });
  }
}

// `Symbol.dispose` and `Symbol.asyncDispose`: Hermes has neither, and
// Effect's `ManagedRuntime` and the act port's live follows name them as
// keys, which would otherwise all be the one key `"undefined"`. Registered
// symbols, as Expo registers `Symbol.asyncIterator`.
// SAFETY: the two are read-only in the lib's declaration and absent in the runtime; this writes them once.
const symbols = Symbol as unknown as Record<"dispose" | "asyncDispose", symbol | undefined>;
symbols.dispose ??= Symbol.for("Symbol.dispose");
symbols.asyncDispose ??= Symbol.for("Symbol.asyncDispose");
