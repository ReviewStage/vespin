/**
 * intros.ts -- the one-card intros a page opens with the first time an account visits it, and which of them the account has seen.
 *
 * Which intros the account has seen is the account's
 * (`APP_SETTING_SCHEMA.introsSeen`), so a card dismissed on one device never
 * stands again on another. It is stored as the JSON list of the intros'
 * ids, because a setting holds one plain value. A dismissal is never taken
 * back, so the list only grows: the service stores the union of what it
 * holds and what a write sends, and a device writes the union of its own
 * list and the one it last synced, so two devices dismissing two cards
 * lose neither.
 *
 * Note that the stored list keeps an id this build does not know, a newer
 * build's intro, and the guard takes it, because refusing the list would
 * refuse the whole part to the older build; only the reader
 * (`introsSeenFrom`) passes it over, so a newer build's intro costs an
 * older one nothing.
 *
 * Accounts made before the intros shipped already know these pages, so the
 * service answers the launch's intros as seen, beside any it dismissed, for
 * an account made before `INTROS_SHIPPED_AT` (`introsSeenAnswered`). It
 * writes nothing for it, so no row is backfilled, and the client never
 * decides it, since it never learns when the account was made.
 */

import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/** Each page that opens with an intro, by the id its dismissal is stored under. */
export const INTRO = {
  AUTOMATIONS: "automations",
  INBOX: "inbox",
  TASK_OVERVIEW: "task_overview",
  BROWSER: "browser",
} as const;

export type Intro = (typeof INTRO)[keyof typeof INTRO];

const INTRO_LIST: readonly Intro[] = Object.values(INTRO);

/** The intros that shipped together, which an account made before they shipped reads as seen. */
const LAUNCH_INTROS: readonly Intro[] = [
  INTRO.AUTOMATIONS,
  INTRO.INBOX,
  INTRO.TASK_OVERVIEW,
  INTRO.BROWSER,
];

/** The day the launch's intros shipped, midnight in Eastern time: an account made before it skips them. */
export const INTROS_SHIPPED_AT = new Date("2026-11-13T05:00:00Z");

/** The most ids a stored list holds, well past every intro there will be. */
const INTROS_SEEN_MAX = 64;

/** The longest id a stored list holds, well past any intro's. */
const INTRO_ID_MAX_CHARS = 64;

const introsSeenJson = Schema.fromJsonString(
  Schema.Array(Schema.String.check(Schema.isMaxLength(INTRO_ID_MAX_CHARS))).check(
    Schema.isMaxLength(INTROS_SEEN_MAX),
  ),
);

const decodeIntros = Schema.decodeUnknownOption(introsSeenJson);

const encodeIntros = Schema.encodeSync(introsSeenJson);

/** Every id a stored list holds, a newer build's among them; none where it holds no list. */
function storedIds(value: UnparsedWireValue): readonly string[] {
  return Option.getOrElse(decodeIntros(value), () => []);
}

/** Whether `id` names an intro this build draws. */
function isIntro(id: string): id is Intro {
  return INTRO_LIST.some((intro) => intro === id);
}

/** Guards a list arriving from storage or the wire, as its JSON: any ids, this build's or a newer one's. */
export function isIntrosSeenJson(value: UnparsedWireValue): value is string {
  return Option.isSome(decodeIntros(value));
}

/** The intros a stored list names that this build draws, each once; none where it holds no list. */
export function introsSeenFrom(value: UnparsedWireValue): readonly Intro[] {
  return [...new Set(storedIds(value).filter(isIntro))];
}

/**
 * The union of two stored lists, as stored: each id once, in order, kept to
 * the list's bound; nothing where neither names an id, so a device that has
 * seen none writes none.
 */
export function introsSeenUnion(
  one: UnparsedWireValue,
  other: UnparsedWireValue,
): string | undefined {
  const ids = [...new Set([...storedIds(one), ...storedIds(other)])].sort();

  return ids.length === 0 ? undefined : encodeIntros(ids.slice(0, INTROS_SEEN_MAX));
}

/** A stored list with `intro` added, as a device writes it once Got it is pressed. */
export function introsSeenWith(stored: UnparsedWireValue, intro: Intro): string {
  // SAFETY: a list of one id is never empty, so the union always names one.
  return introsSeenUnion(stored, encodeIntros([intro])) as string;
}

/**
 * The list the service answers for an account: what it stored, with the
 * launch's intros as seen where it was made before they shipped. Note that
 * they are added to what it stored rather than standing only while it
 * stored none, so an account that dismisses a later intro is not shown the
 * launch's.
 */
export function introsSeenAnswered(
  stored: UnparsedWireValue,
  accountCreatedAt: Date | undefined,
): string | undefined {
  const launched = accountCreatedAt !== undefined && accountCreatedAt < INTROS_SHIPPED_AT;

  return introsSeenUnion(stored, launched ? encodeIntros(LAUNCH_INTROS) : undefined);
}
