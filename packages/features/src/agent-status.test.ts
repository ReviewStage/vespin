import assert from "node:assert/strict";
import { TURN_STATUS } from "@repo/wire";
import { test } from "vitest";
import { BOOT_PHASE } from "./agent-boot.js";
import {
  agentStatusAt,
  STARTING_GRACE_MILLIS,
  type StatusTurn,
  statusClockEdge,
  turnStoppable,
} from "./agent-status.js";
import { AGENT_STATUS } from "./agent-wire.js";

const STARTED = 1_700_000_000_000;

/** The agent read `sinceStart` after its Start. */
function standing(sinceStart: number) {
  return { createdAt: STARTED, now: STARTED + sinceStart };
}

/** A newest turn in the state given. */
function turn(status: string, overrides: Partial<StatusTurn> = {}): StatusTurn {
  return { status, cancelRequested: false, ...overrides };
}

test("an agent with no turn reads starting through its grace and failed past it, and the edge is the first instant it fails", () => {
  assert.equal(agentStatusAt(undefined, standing(0)), AGENT_STATUS.STARTING);
  assert.equal(agentStatusAt(undefined, standing(STARTING_GRACE_MILLIS)), AGENT_STATUS.STARTING);
  const edge = statusClockEdge(undefined, standing(1_000));
  assert.equal(edge, STARTED + STARTING_GRACE_MILLIS + 1);
  assert.equal(agentStatusAt(undefined, standing((edge ?? 0) - STARTED)), AGENT_STATUS.FAILED);
  assert.equal(statusClockEdge(undefined, standing(STARTING_GRACE_MILLIS + 1)), undefined);
});

test("a turn reads as its own word however long it has stood, a running one with a Stop asked reads canceled, one in a word this build does not know reads running, and the clock moves no turn", () => {
  const running = turn(TURN_STATUS.RUNNING);
  // A day on, a turn still open reads as its row says: the minute sweep, not a reader, fails one past its deadline.
  const dayOn = standing(24 * 60 * 60 * 1_000);
  assert.equal(agentStatusAt(running, dayOn), AGENT_STATUS.RUNNING);
  assert.equal(agentStatusAt(turn(TURN_STATUS.QUEUED), dayOn), AGENT_STATUS.RUNNING);
  assert.equal(statusClockEdge(running, standing(0)), undefined);
  assert.equal(
    agentStatusAt({ ...running, cancelRequested: true }, standing(0)),
    AGENT_STATUS.CANCELED,
  );
  assert.equal(
    agentStatusAt(turn(TURN_STATUS.SETTLED, { cancelRequested: true }), standing(0)),
    AGENT_STATUS.COMPLETED,
  );
  assert.equal(agentStatusAt(turn(TURN_STATUS.FAILED), standing(0)), AGENT_STATUS.FAILED);
  assert.equal(agentStatusAt(turn("waiting"), standing(0)), AGENT_STATUS.RUNNING);
  assert.equal(statusClockEdge(turn(TURN_STATUS.SETTLED), standing(0)), undefined);
});

test("a Stop is offered only on a running turn no Stop was asked of", () => {
  assert.equal(turnStoppable(turn(TURN_STATUS.RUNNING)), true);
  assert.equal(turnStoppable(turn(TURN_STATUS.RUNNING, { cancelRequested: true })), false);
  // A turn whose line no runner took yet has nothing running for a Stop to stop.
  assert.equal(turnStoppable(turn(TURN_STATUS.QUEUED)), false);
  assert.equal(turnStoppable(undefined), false);
});

test("an agent started blank with no turn reads completed however long ago it started, and the clock moves it nowhere", () => {
  const blank = { ...standing(STARTING_GRACE_MILLIS * 3), blank: true };
  assert.equal(agentStatusAt(undefined, blank), AGENT_STATUS.COMPLETED);
  assert.equal(statusClockEdge(undefined, { ...standing(0), blank: true }), undefined);
});

test("an agent whose first launch boots reads starting however long it boots and failed once its boot failed, and the clock moves it nowhere", () => {
  const longBoot = { ...standing(STARTING_GRACE_MILLIS * 3), boot: BOOT_PHASE.RUNNING_SCRIPTS };
  assert.equal(agentStatusAt(undefined, longBoot), AGENT_STATUS.STARTING);
  assert.equal(
    statusClockEdge(undefined, { ...standing(0), boot: BOOT_PHASE.STARTING }),
    undefined,
  );
  assert.equal(
    agentStatusAt(undefined, { ...standing(0), boot: BOOT_PHASE.FAILED }),
    AGENT_STATUS.FAILED,
  );
});
