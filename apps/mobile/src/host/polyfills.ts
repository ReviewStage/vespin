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

// The `Intl` Hermes lacks, filled in by FormatJS as its React Native guide
// orders them (https://formatjs.github.io/docs/guides/react-native-hermes),
// each for English, the one locale the host's words name. Each `polyfill`
// entry installs only where its own check finds the runtime lacking.
//
// `Intl.PluralRules` and `Intl.ListFormat`: Hermes has neither, and the
// host's words make them at module load (`@repo/features/words.ts`), so a
// bundle without them cannot even evaluate. They stand on `Intl.Locale` and
// `Intl.getCanonicalLocales`.
import "@formatjs/intl-getcanonicallocales/polyfill.js";
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
// `Intl.NumberFormat` and `Intl.DateTimeFormat`: Hermes's on iOS have no
// `formatToParts` for numbers and no `formatRange` for dates, so FormatJS
// replaces both. Every day the host counts in the reader's zone
// (`@repo/features/date-mention.ts`'s Today and Tomorrow, through Effect's
// `DateTime.makeZoned`) reads a date's parts with its seconds' fraction,
// which FormatJS's date formatter writes through `NumberFormat`'s parts.
// The zone data is every zone's, since the reader's is known only on the
// device.
import "@formatjs/intl-numberformat/polyfill.js";
import "@formatjs/intl-numberformat/locale-data/en.js";
import "@formatjs/intl-datetimeformat/polyfill.js";
import "@formatjs/intl-datetimeformat/locale-data/en.js";
import "@formatjs/intl-datetimeformat/add-all-tz.js";
import "@formatjs/intl-listformat/polyfill.js";
import "@formatjs/intl-listformat/locale-data/en.js";
// `Intl.Segmenter`: Hermes lacks it, and a task section's emoji is told
// from a word by its graphemes (`@repo/features/task-section-wire.ts`).
import "@formatjs/intl-segmenter/polyfill.js";
import type { DateTimeFormatConstructor as FormatJsDateTimeFormat } from "@formatjs/intl-datetimeformat";
import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from "expo-crypto";
import { getCalendars } from "expo-localization";

/** The device's zone, as `expo-localization` names it; null where it names none. */
function deviceTimeZone(): string | null {
  return getCalendars()[0]?.timeZone ?? null;
}

// FormatJS's `Intl.DateTimeFormat` knows no zone of its own and starts in
// UTC, so it is handed the device's. Note that a zone it cannot place, such as
// `GMT`, the name iOS gives a clock set to UTC, leaves it in UTC.
if ("polyfilled" in Intl.DateTimeFormat) {
  // SAFETY: a polyfilled `Intl.DateTimeFormat` is FormatJS's, which adds `__setDefaultTimeZone`.
  const formatJs = Intl.DateTimeFormat as unknown as FormatJsDateTimeFormat;
  const zone = deviceTimeZone();
  try {
    if (zone !== null) formatJs.__setDefaultTimeZone(zone);
  } catch {
    // The zone is one FormatJS cannot place, and UTC stands.
  }
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
