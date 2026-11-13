import assert from "node:assert/strict";
import { test } from "vitest";
import { INTRO, introsSeenFrom, isIntrosSeenJson } from "./intros.js";

/**
 * intros.test.ts -- a list naming an intro this build does not know, a
 * newer build's, is still taken whole, and reads as the intros this build
 * draws, so the newer build's intro costs this one none of the others.
 */

test("a list naming a newer build's intro is taken, and reads as the intros this build draws", () => {
  const stored = '["inbox","a_newer_page","inbox"]';

  assert.equal(isIntrosSeenJson(stored), true);
  assert.deepEqual(introsSeenFrom(stored), [INTRO.INBOX]);
});
