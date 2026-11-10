import assert from "node:assert/strict";
import { SANDBOX_STATE, SANDBOX_STEP } from "@repo/features/agent-sandbox-wire";
import { test } from "vitest";
import { sandboxStandingAt, sandboxStandingEdge } from "./sandbox-standing.js";

/**
 * sandbox-standing.test.ts -- a sandbox's record read against the reader's
 * clock: running until its stop, then off since it, as Vercel stops an
 * untouched sandbox unseen; booting on its last step until a boot goes ten
 * minutes without one, then off since that step; off where none was
 * recorded. Instants hand-worked, in milliseconds from a boot at 1,000,000.
 */

const BOOT = 1_000_000;
const MINUTE = 60_000;

const CREATING = { step: SANDBOX_STEP.CREATING, at: BOOT };
const CLONING = { step: SANDBOX_STEP.CLONING, at: BOOT + 2 * MINUTE };

const RUNNING = {
  state: SANDBOX_STATE.RUNNING,
  stateAt: BOOT + 3 * MINUTE,
  steps: [CREATING, CLONING],
  runsUntil: BOOT + 6 * MINUTE,
};

const BOOTING = {
  state: SANDBOX_STATE.BOOTING,
  stateAt: BOOT,
  steps: [CREATING, CLONING],
  runsUntil: null,
};

test.each([
  {
    case: "running before its stop",
    now: BOOT + 5 * MINUTE,
    sandbox: RUNNING,
    standing: {
      state: SANDBOX_STATE.RUNNING,
      since: BOOT + 3 * MINUTE,
      runsUntil: BOOT + 6 * MINUTE,
    },
  },
  {
    case: "running at its stop, which Vercel made unseen",
    now: BOOT + 6 * MINUTE,
    sandbox: RUNNING,
    standing: { state: SANDBOX_STATE.OFF, since: BOOT + 6 * MINUTE },
  },
  {
    case: "booting within ten minutes of its last step",
    now: BOOT + 11 * MINUTE,
    sandbox: BOOTING,
    standing: {
      state: SANDBOX_STATE.BOOTING,
      since: BOOT,
      step: CLONING,
      steps: [CREATING, CLONING],
    },
  },
  {
    case: "booting ten minutes past its last step, a boot that failed",
    now: BOOT + 12 * MINUTE,
    sandbox: BOOTING,
    standing: { state: SANDBOX_STATE.OFF, since: BOOT + 2 * MINUTE },
  },
  {
    case: "never recorded",
    now: BOOT,
    sandbox: undefined,
    standing: { state: SANDBOX_STATE.OFF },
  },
])("a sandbox $case", ({ now, sandbox, standing }) => {
  assert.deepEqual(sandboxStandingAt(sandbox, now), standing);
});

test("a record reads otherwise at a running sandbox's stop or a boot's stall, and never once past it", () => {
  assert.equal(sandboxStandingEdge(RUNNING, BOOT + 5 * MINUTE), BOOT + 6 * MINUTE);
  assert.equal(sandboxStandingEdge(BOOTING, BOOT + 5 * MINUTE), BOOT + 12 * MINUTE);
  assert.equal(sandboxStandingEdge(RUNNING, BOOT + 6 * MINUTE), undefined);
});
