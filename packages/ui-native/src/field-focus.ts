// field-focus.ts -- the SwiftUI text fields that hold the keyboard now, and letting them go before their screen closes.

import type { TextFieldRef } from "@expo/ui/swift-ui";

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
 * Lowers every field holding the keyboard, then waits a frame. A screen
 * closes after it, because a SwiftUI list that drops a row whose field still
 * holds focus has UIKit refuse the delete and end the app ("The first
 * responder contained inside of a deleted section or item refused to
 * resign"), which New workspace's Cancel hit on the folded iPhone Duo.
 */
export async function releaseFields(): Promise<void> {
  const holding = [...focused];

  if (holding.length === 0) return;
  focused.clear();
  await Promise.all(holding.map((field) => field.blur()));
  await new Promise<void>((settled) => requestAnimationFrame(() => settled()));
}
