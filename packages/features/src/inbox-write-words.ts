// inbox-write-words.ts -- what a client says of an Inbox write the service did not take: read marks, a Got it on notices, and a reminder, as the panel's toasts and the iOS app's notice say them.

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

/** What a toast says of a reminder set, or canceled, that the service did not take. */
export const REMIND_REFUSED = {
  SET: "Could not set the reminder",
  CANCEL: "Could not cancel the reminder",
} as const;
