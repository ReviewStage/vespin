import assert from "node:assert/strict";
import { SANDBOX_STATE } from "@repo/features/agent-sandbox-wire";
import { test } from "vitest";
import { sandboxStandingAt, sandboxStandingEdge } from "./sandbox-standing.js";

/**
 * sandbox-standing.test.ts -- a sandbox's record read against the reader's
 * clock: running until its stop, then off, as Vercel stops an untouched
 * sandbox unseen; booting until a boot has run fifteen minutes, then off;
 * off where none was recorded. Instants hand-worked, in milliseconds from a
 * boot at 1,000,000.
 */

const BOOT = 1_000_000;
const MINUTE = 60_000;

const RUNNING = {
  state: SANDBOX_STATE.RUNNING,
  stateAt: BOOT + 3 * MINUTE,
  runsUntil: BOOT + 6 * MINUTE,
};

const BOOTING = { state: SANDBOX_STATE.BOOTING, stateAt: BOOT, runsUntil: null };

test.each([
  {
    case: "running before its stop",
    now: BOOT + 5 * MINUTE,
    sandbox: RUNNING,
    state: SANDBOX_STATE.RUNNING,
  },
  {
    case: "running at its stop, which Vercel made unseen",
    now: BOOT + 6 * MINUTE,
    sandbox: RUNNING,
    state: SANDBOX_STATE.OFF,
  },
  {
    case: "booting within fifteen minutes",
    now: BOOT + 14 * MINUTE,
    sandbox: BOOTING,
    state: SANDBOX_STATE.BOOTING,
  },
  {
    case: "booting fifteen minutes, a boot that failed",
    now: BOOT + 15 * MINUTE,
    sandbox: BOOTING,
    state: SANDBOX_STATE.OFF,
  },
  { case: "never recorded", now: BOOT, sandbox: undefined, state: SANDBOX_STATE.OFF },
])("a sandbox $case", ({ now, sandbox, state }) => {
  assert.equal(sandboxStandingAt(sandbox, now), state);
});

test("a record reads otherwise at a running sandbox's stop or a boot's stall, and never once past it", () => {
  assert.equal(sandboxStandingEdge(RUNNING, BOOT + 5 * MINUTE), BOOT + 6 * MINUTE);
  assert.equal(sandboxStandingEdge(BOOTING, BOOT + 5 * MINUTE), BOOT + 15 * MINUTE);
  assert.equal(sandboxStandingEdge(RUNNING, BOOT + 6 * MINUTE), undefined);
});
