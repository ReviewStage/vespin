/**
 * inbox-remind-times.ts -- the times a Remind me menu offers on an Inbox item, and the words it says them in, for every client that sets a reminder.
 *
 * A reminder takes an item out of the reader's Inbox until a time they pick:
 * in an hour, tomorrow at 9 AM, next Monday at 9 AM, or a day and time of
 * their own, which a picker opens on tomorrow at 9 AM. The panel's menus
 * (`packages/panel/src/tasks/inbox-remind.tsx`) and the iOS app's Remind me
 * sheet both read them here, so the two offer the same times in the same
 * words. Nothing here draws.
 */

import { dateChipText, readerZone } from "./date-mention.js";

/** The hour tomorrow, next week, and a picker's opening day come due at, in the reader's own zone. */
const MORNING_HOUR = 9;

const HOUR_MS = 60 * 60 * 1000;

/** The words a Remind me menu says, wherever it stands. */
export const REMIND_WORDS = {
  REMIND_ME: "Remind me",
  IN_AN_HOUR: "In 1 hour",
  TOMORROW: "Tomorrow",
  NEXT_WEEK: "Next week",
  PICK: "Pick a date and time…",
  CLEAR: "Clear reminder",
  CLEAR_ALL: "Clear reminders",
  CLEARED: "Reminders cleared",
  PAST: "Pick a time after now to be reminded",
  /** What a row's due time is heard as, where it says when a reminder comes back in its age's place. */
  DUE: "Reminder",
} as const;

/** One time a Remind me menu offers: its words, and when it comes due, counted from the moment it is chosen. */
interface RemindTime {
  readonly label: string;
  readonly at: (now: number) => number;
}

/** `now`'s day in the reader's own zone, `days` on, at `hour` sharp. */
function dayAt(now: number, days: number, hour: number): number {
  const day = new Date(now);
  day.setDate(day.getDate() + days);
  day.setHours(hour, 0, 0, 0);

  return day.getTime();
}

/** The times every Remind me menu offers, in its order: an hour on, tomorrow morning, and next Monday morning. */
export const REMIND_TIMES: readonly RemindTime[] = [
  { label: REMIND_WORDS.IN_AN_HOUR, at: (now) => now + HOUR_MS },
  { label: REMIND_WORDS.TOMORROW, at: (now) => dayAt(now, 1, MORNING_HOUR) },
  {
    label: REMIND_WORDS.NEXT_WEEK,
    // Note that a Monday's next week is the Monday after, never the day itself.
    at: (now) => dayAt(now, (8 - new Date(now).getDay()) % 7 || 7, MORNING_HOUR),
  },
];

/** The moment a picker for a time of the reader's own opens on: tomorrow morning. */
export function remindPickOpensAt(now: number): number {
  return dayAt(now, 1, MORNING_HOUR);
}

/** An instant as a date mention spells a time, at UTC, so its chip's words say it in the reader's zone. */
export function remindMoment(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16)}+00:00`;
}

/** When a reminder comes due, in the words a date mention's chip uses from `now`: Today 11:24 AM, Tomorrow 9:00 AM, Monday 9:00 AM. */
export function remindWords(at: number, now: number): string {
  return dateChipText({ start: remindMoment(at) }, now, readerZone());
}
