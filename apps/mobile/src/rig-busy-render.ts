// rig-busy-render.ts -- the rig's stand-in for a page whose every render is slow, as a Manager's page at work is: a fixture run's agent page held for the time `-busyRender <ms>` names on each render while its composer holds words, so a flow can type and press while JavaScript is behind the field.

import { launchBusyRender } from "./host/launch-arguments.js";

/** How long each render is held, read once; none outside a fixture run that names it, which is every phone's. */
const BUSY_MS = launchBusyRender();

/**
 * Holds the JavaScript thread for the rig's render time, as a heavy render
 * holds it, while the composer holds words (`writing`), so the field's keys
 * and the presses after them wait for one batch, as they do on a phone whose
 * page is busy. Note that it holds the thread rather than waiting on a
 * timer, because only a held thread keeps the native events queued, and
 * only while words are written, so the page opens and a sent message lands
 * at their own pace and one held render spans every key and press a flow
 * makes after its first word; nothing runs it outside the rig.
 */
export function rigBusyRender(writing: boolean): void {
  if (BUSY_MS === undefined || !writing) return;
  const until = performance.now() + BUSY_MS;

  while (performance.now() < until) {
    // Note that the loop does nothing but hold the thread until the time is up.
  }
}
