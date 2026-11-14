// field-focus.ts -- the SwiftUI text fields that hold the keyboard now, and letting them go before their screen closes.

import type { TextFieldRef } from "@expo/ui/swift-ui";

/** The longest a close waits on its fields letting go, in milliseconds, so a field that never answers never holds its screen open. */
const RELEASE_TIMEOUT_MS = 300;

/** The fields holding focus now, each by the handle that lowers it. */
const focused = new Set<TextFieldRef>();

/** Notes whether a field holds focus, as its focus changes. */
export function noteFieldFocus(field: TextFieldRef, holds: boolean): void {
  if (holds) focused.add(field);
  else focused.delete(field);
}

/** Forgets a field that leaves the screen. */
export function forgetField(field: TextFieldRef): void {
  focused.delete(field);
}

/**
 * Lowers every field holding the keyboard, then waits a frame, but never
 * longer than `RELEASE_TIMEOUT_MS` for the fields. A screen
 * closes after it, because a SwiftUI list that drops a row whose field still
 * holds focus has UIKit refuse the delete and end the app ("The first
 * responder contained inside of a deleted section or item refused to
 * resign"), which New workspace's Cancel hit on the folded iPhone Duo.
 */
export async function releaseFields(): Promise<void> {
  const holding = [...focused];

  if (holding.length === 0) return;
  focused.clear();
  // Note that a blur that fails or never answers, such as a field whose view is already gone, lets the close go on after the timeout rather than hold the screen.
  const released = Promise.allSettled(holding.map((field) => field.blur()));
  const timeout = new Promise<void>((settled) => setTimeout(settled, RELEASE_TIMEOUT_MS));
  await Promise.race([released, timeout]);
  await new Promise<void>((settled) => requestAnimationFrame(() => settled()));
}
