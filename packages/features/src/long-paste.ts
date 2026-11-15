/**
 * long-paste.ts -- words pasted long enough to bury a message, which a message box takes as a text file of their own, "Pasted text 1.txt", rather than into its words.
 *
 * Every box that takes a long paste as a file takes it on this rule, so
 * the desktop, the web, and the iOS app agree on when words come as a file
 * and what it is named: words that reach either bound (`LONG_PASTE`) come
 * as a file, numbered one past the highest pasted file the box has used, so
 * a chip taken off frees no number a later paste reuses beside its
 * neighbor; words past a pasted file's bound (`PASTED_TEXT_BYTES`)
 * stay words, which the box's own bound then cuts. A box that hears its
 * pastes, the panel's editor, hands the words pasted; a field that hears
 * only its words as they change, iOS's, finds the paste as the one run of
 * words a change put in (`longPasteIn`).
 */

import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS, type AgentAttachment } from "./agent-wire.js";
import { base64Of } from "./attached-files.js";

/** How long pasted words run before they come as a file rather than into the box: either bound reached. */
const LONG_PASTE = {
  CHARS: 4_000,
  LINES: 40,
} as const;

/** The most bytes words pasted as a file may hold, past which they stay words: a text file's bound, the one place a paste's bound is named. */
export const PASTED_TEXT_BYTES = AGENT_BOUNDS.MAX_TEXT_BYTES;

/** The name a pasted file takes, numbered past every pasted file the box holds. */
const PASTED_NAME = /^Pasted text (\d+)\.txt$/u;

/** The first and last halves of a character written in two code units, which a cut between them would break. */
const HIGH_SURROGATE = { FIRST: 0xd8_00, LAST: 0xdb_ff } as const;

/** Whether pasted words run long enough to come as a file. */
function longPaste(words: string): boolean {
  if (words.length >= LONG_PASTE.CHARS) return true;
  let lines = 1;

  for (let at = words.indexOf("\n"); at !== -1; at = words.indexOf("\n", at + 1)) {
    lines += 1;

    if (lines >= LONG_PASTE.LINES) return true;
  }

  return false;
}

/** Whether the code unit at `at` opens a character written in two, so a cut must not fall right after it. */
function opensPair(words: string, at: number): boolean {
  const unit = words.charCodeAt(at);

  return unit >= HIGH_SURROGATE.FIRST && unit <= HIGH_SURROGATE.LAST;
}

/** The next pasted file's name: one past the highest the box has used. */
export function pastedName(used: Iterable<string>): string {
  let highest = 0;

  for (const name of used) {
    const number = PASTED_NAME.exec(name)?.[1];

    if (number !== undefined) highest = Math.max(highest, Number(number));
  }

  return `Pasted text ${String(highest + 1)}.txt`;
}

/**
 * Pasted words as the text file a box takes them as, named past `used`,
 * the names the box has used; none where they run short, so they paste as
 * words, or past a text file's bound, so the box's own bound cuts them.
 */
export function pastedFile(words: string, used: Iterable<string>): AgentAttachment | undefined {
  if (!longPaste(words)) return undefined;
  const bytes = new TextEncoder().encode(words);

  if (bytes.length > PASTED_TEXT_BYTES) return undefined;

  return { name: pastedName(used), mediaType: AGENT_ATTACHMENT_TYPE.TEXT, data: base64Of(bytes) };
}

/** A long paste found in one change to a field's words: the words pasted, and the field's words with them taken out. */
export interface LongPasteIn {
  readonly words: string;
  readonly kept: string;
}

/**
 * The long paste one change to a field's words put in, from what the field
 * held (`was`) to what it holds (`now`): the one run between the words they
 * open and close on alike, where it runs long; none for typing, a
 * deletion, or a short paste. Note that a paste over a selection takes the
 * selection with it, as the panel's paste does, and that a cut never falls
 * inside a character written in two code units, such as an emoji.
 */
export function longPasteIn(was: string, now: string): LongPasteIn | undefined {
  const most = Math.min(was.length, now.length);
  let start = 0;

  while (start < most && was[start] === now[start]) start += 1;

  if (start > 0 && opensPair(now, start - 1)) start -= 1;
  let end = 0;

  while (end < most - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end += 1;

  if (end > 0 && opensPair(now, now.length - 1 - end)) end -= 1;
  const words = now.slice(start, now.length - end);

  if (!longPaste(words)) return undefined;

  return { words, kept: now.slice(0, start) + now.slice(now.length - end) };
}
