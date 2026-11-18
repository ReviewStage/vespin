import assert from "node:assert/strict";
import { test } from "vitest";
import { GITHUB_WAKE, githubWakesOffFrom, githubWakesOffWith } from "./github-wakes.js";

/**
 * github-wakes.test.ts -- a switch turned off and back on writes the list
 * with only its own kind moved, keeping a kind a newer build stored, which
 * this build reads past, so an older build's switch never turns a newer
 * build's kind back on.
 */

test("a kind turned off and back on moves only that kind, and keeps a newer build's", () => {
  const stored = '["a_newer_kind"]';
  const off = githubWakesOffWith(stored, GITHUB_WAKE.COMMENT, false);

  assert.deepEqual(githubWakesOffFrom(off), [GITHUB_WAKE.COMMENT]);
  assert.equal(githubWakesOffWith(off, GITHUB_WAKE.COMMENT, true), stored);
});
