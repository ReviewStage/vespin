/**
 * toast.ts -- what a test of a toast reads: the toasts standing and the newest of them, as the window's toasts stack.
 *
 * Toasts stack newest first, and one leaving stays drawn through its exit,
 * as one waiting aside for room stays drawn hidden, so the toast an act just
 * raised is the first one drawn that is neither.
 */

/** A toast standing in sight: neither on its way out nor waiting aside for room. */
export const STANDING_TOAST = ".ui-toast:not([data-ending-style]):not([data-limited])";

/** What each toast standing says, oldest first, as they read up the window's corner from the newest at its foot. */
export function standingToastWords(): string[] {
  return [...document.querySelectorAll(`${STANDING_TOAST} .ui-toast-words`)]
    .map((words) => words.textContent ?? "")
    .reverse();
}

/** The newest toast standing, or none. */
function newestToast(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(STANDING_TOAST) ?? undefined;
}

/** What the newest toast standing says, or nothing while none stands. */
export function newestToastSays(): string | undefined {
  return newestToast()?.textContent ?? undefined;
}

/** The newest toast's action, which an act raising it offered: its first button, the Dismiss after it. */
export function newestToastAction(): HTMLButtonElement | undefined {
  return newestToast()?.querySelector<HTMLButtonElement>("button") ?? undefined;
}
