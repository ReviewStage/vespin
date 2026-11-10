/**
 * cli-remind.ts -- the instant `vespin inbox remind` sets a thread's reminder for, from the words on its command line.
 *
 * The words are a date as a date mention reads them (`date-mention.ts`'s
 * `dateOfWords`), such as `tomorrow`, `fri 3pm`, or `nov 12 9:30am`, in the
 * reader's own zone, or a time spelled as a mention holds one. A day alone
 * comes due at 9 AM, as the app's Tomorrow and Next week do. A range names
 * no one moment and is refused, as is a moment not after now, which the
 * app's picker refuses too.
 */

import { dateOfWall, dateOfWords, dateWall, isDateMoment } from "./date-mention.js";

/** The time of day a reminder set for a day alone comes due at, as the app's own. */
const MORNING = "09:00";

/** When the reminder comes due, in epoch milliseconds, or why the words name no such time. */
export type CliRemind = { readonly at: number } | { readonly refusal: string };

/** The instant `words` name, counted from `now` in `zone`, or why they name none a reminder can come due at. */
export function cliRemindAt(words: string, now: number, zone: string): CliRemind {
  const typed = words.trim();
  const span = isDateMoment(typed) ? { start: typed } : dateOfWords(typed, now, zone);
  if (span === undefined) {
    return { refusal: `No date in "${typed}". Try tomorrow, fri 3pm, or nov 12 9:30am.` };
  }
  if (span.end !== undefined) return { refusal: "A reminder comes due at one time, not a range." };
  const wall = dateWall(span, zone);
  const timed =
    wall === undefined
      ? undefined
      : dateOfWall({ start: { day: wall.start.day, time: wall.start.time ?? MORNING } }, zone);
  const at = timed === undefined ? Number.NaN : Date.parse(timed.start);
  if (!(at > now)) return { refusal: "Pick a time after now to be reminded." };
  return { at };
}
