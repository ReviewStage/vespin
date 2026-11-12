import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  SWITCH_STEP,
  SWITCHER_LET_GO,
  type SwitcherState,
  switcherChose,
  switcherPressed,
  switcherShown,
  switcherTarget,
} from "./tab-switcher-model.js";

/**
 * tab-switcher-model.test.ts -- ⌃Tab's keys over the screens stood on last,
 * most recent first: a tap flipping to the screen before, a hold stepping on
 * and back around the cards, and a let-go on the screen here going nowhere.
 */

/** The screens, most recent first, the window standing on the first. */
const SCREENS = ["here", "inbox", "task b", "automations"] as const;

/** The switcher after each press, from let go. */
function pressed(
  screens: readonly string[],
  here: boolean,
  ...steps: (1 | -1)[]
): SwitcherState<string> {
  return steps.reduce<SwitcherState<string>>(
    (state, step) => switcherPressed(state, { screens, here, step }),
    SWITCHER_LET_GO,
  );
}

describe("⌃Tab", () => {
  test("tapped, goes to the screen before this one and shows nothing", () => {
    const state = pressed(SCREENS, true, SWITCH_STEP.ON);
    assert.equal(state.held && state.shown, false);
    assert.equal(switcherTarget(state), "inbox");
  });

  test("held, shows the cards once the hold is long enough, the screen here first", () => {
    const state = switcherShown(pressed(SCREENS, true, SWITCH_STEP.ON));
    assert.ok(state.held);
    assert.equal(state.shown, true);
    assert.equal(state.cards[0], "here");
    assert.equal(state.chosen, 1);
  });

  test("pressed again while held steps on and shows the cards at once, wrapping past the last", () => {
    const twice = pressed(SCREENS, true, SWITCH_STEP.ON, SWITCH_STEP.ON);
    assert.ok(twice.held && twice.shown);
    assert.equal(switcherTarget(twice), "task b");

    const around = pressed(
      SCREENS,
      true,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
    );

    assert.equal(switcherTarget(around), undefined, "back on the screen here, so nothing moves");
  });

  test("with ⇧ steps back, starting from the last card", () => {
    assert.equal(switcherTarget(pressed(SCREENS, true, SWITCH_STEP.BACK)), "automations");
    assert.equal(
      switcherTarget(pressed(SCREENS, true, SWITCH_STEP.BACK, SWITCH_STEP.BACK)),
      "task b",
    );
  });

  test("shows no more than five cards", () => {
    const many = Array.from({ length: 9 }, (_, at) => `screen ${at}`);
    const state = pressed(many, true, SWITCH_STEP.BACK);
    assert.ok(state.held);
    assert.equal(state.cards.length, 5);
    assert.equal(switcherTarget(state), "screen 4");
  });

  test("a card pointed at is the one chosen", () => {
    const state = switcherChose(pressed(SCREENS, true, SWITCH_STEP.ON), 3);
    assert.equal(switcherTarget(state), "automations");
  });

  test("with nothing else to go to, holds nothing", () => {
    assert.equal(pressed(["here"], true, SWITCH_STEP.ON).held, false);
  });

  test("from somewhere that is no step, goes to the most recent screen", () => {
    assert.equal(switcherTarget(pressed(SCREENS, false, SWITCH_STEP.ON)), "here");
  });
});
