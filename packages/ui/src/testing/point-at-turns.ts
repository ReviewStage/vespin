/**
 * point-at-turns.ts -- the pointer coming onto every turn drawn, so a test reads the actions each turn draws only once it is pointed at or its first frame has painted (`MessageFrame`).
 *
 * A turn's actions wait for the frame it was first drawn in to paint, which
 * a test's DOM times on a real timer it never waits on, or for the pointer
 * or the focus to come onto the turn. A test that reads or presses an
 * action comes onto the turn first, as a reader's pointer does.
 */

import { act } from "react";

/** The pointer coming onto each turn under `root`, which draws its actions at once. */
export function pointAtTurns(root: ParentNode): void {
  act(() => {
    for (const turn of root.querySelectorAll(".ui-message")) {
      turn.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    }
  });
}
