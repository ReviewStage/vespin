// inbox-write-words.ts -- what a client says of an Inbox write and of its Undo: read marks, a Got it on notices, a resolve, a reminder, and a take-back the service did not take, as the panel's toasts and the iOS app's notice say them.

import { INBOX_STATUS, INBOX_TAKE_BACK, type InboxItem, type InboxStatus } from "./inbox-wire.js";
import { cardTitle } from "./plain-words.js";
import { countWords, TERM } from "./words.js";

/** What one toast says of read marks given to several items: how many the service took, and how many not. */
export function markedNote(unread: boolean, landed: number, refused: number): string {
  const state = unread ? "unread" : "read";

  if (landed === 0) return `Could not mark ${countWords(refused, TERM.INBOX_ITEM)} ${state}`;
  const kept = `${countWords(landed, TERM.INBOX_ITEM)} marked ${state}`;

  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

/** What one toast says of a Got it on several notices the service did not confirm some of: how many it took, and how many it refused or never answered, which may still have landed. */
export function acknowledgedNote(landed: number, refused: number): string {
  if (landed === 0) return `Could not confirm Got it for ${countWords(refused, TERM.INBOX_ITEM)}`;

  return `Got it: ${countWords(landed, TERM.INBOX_ITEM)}, ${refused} not confirmed`;
}

/** What a toast says of a reminder set, or cleared, that the service did not take, in the words of the act that asked (`REMIND_WORDS`). */
export const REMIND_REFUSED = {
  SET: "Could not set the reminder",
  CLEAR: "Could not clear the reminder",
} as const;

/** What the Undo of a Got it says it settled: the one notice by its title, or how many. */
export function acknowledgedWords(items: readonly InboxItem[]): string {
  const [only] = items;

  return items.length === 1 && only !== undefined
    ? `Got it: “${cardTitle(only.title)}”`
    : `Got it: ${countWords(items.length, TERM.INBOX_ITEM)}`;
}

/** What the Undo of a resolve says it settled: the one item by its title, or how many. */
export function resolvedWords(items: readonly InboxItem[]): string {
  const [only] = items;

  return items.length === 1 && only !== undefined
    ? `Resolved “${cardTitle(only.title)}”`
    : `${countWords(items.length, TERM.INBOX_ITEM)} resolved`;
}

/** What a close the service did not take says, by what had become of the item: still open, the agent having changed it; answered; or resolved. */
export const NOT_RESOLVED = {
  [INBOX_STATUS.OPEN]: "The agent changed this item before you resolved it.",
  [INBOX_STATUS.ANSWERED]: "This item was already answered.",
  [INBOX_STATUS.CLOSED]: "This item was already resolved.",
} as const satisfies Record<InboxStatus, string>;

/** What a nod the service did not take on a notice still open says: its agent changed it since it was shown. Note that it names no press, since Mark as read and Mark all as read send the same nod as Got it. */
export const NOT_ACKNOWLEDGED = "The agent changed this item first, so it is still open.";

/** How one take-back answered: taken back, refused as told to its agent or as moved on, or not reached, so it may be asked again. */
export const TOOK_BACK = {
  ...INBOX_TAKE_BACK,
  UNREACHED: "unreached",
} as const;

export type TookBack = (typeof TOOK_BACK)[keyof typeof TOOK_BACK];

/** What a settle's Undo says where the service did not take it back, in its own words: not reached, told to its agent, or moved on. */
export interface UntakenWords {
  readonly unreached: string;
  readonly told: string;
  readonly movedOn: string;
}

/** What a resolve's Undo says where the service did not take it back. */
export const RESOLVE_UNTAKEN = {
  unreached: "Could not undo resolving.",
  told: "Can't undo: the agent was already told.",
  movedOn: "Can't undo: it changed since you resolved it.",
} as const satisfies UntakenWords;

/** What a Got it's Undo says where the service did not take it back. */
export const ACKNOWLEDGE_UNTAKEN = {
  unreached: "Could not undo Got it.",
  told: "Can't undo: the agent was already told.",
  movedOn: "Can't undo: it has changed since.",
} as const satisfies UntakenWords;

/**
 * What an Undo of settles says where it did not take each back, by how each
 * answered: that it was not reached, ahead of the rest, since it may be asked
 * again; that an agent was told; or that one changed since. None where each
 * was taken back.
 */
export function untakenSaid(answers: readonly TookBack[], words: UntakenWords): string | undefined {
  if (answers.includes(TOOK_BACK.UNREACHED)) return words.unreached;

  if (answers.includes(TOOK_BACK.TOLD)) return words.told;

  return answers.includes(TOOK_BACK.MOVED_ON) ? words.movedOn : undefined;
}
