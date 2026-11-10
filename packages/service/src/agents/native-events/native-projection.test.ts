import assert from "node:assert/strict";
import { RUN_EVENT, TURN_FAILURE } from "@repo/features/turn-run";
import { test } from "vitest";
import { NATIVE_ENDING, NATIVE_MOMENT, PLAN_STATUS } from "./native-moments.js";
import { heldProjection, NATIVE_WRITE, projectMoments } from "./native-projection.js";

test("a warm launch that fails after its turn ended at its IDLE fails no turn of its own", () => {
  const context = {
    conversationId: "c_projection",
    now: 0,
    attempt: 1,
    queuedTurnId: undefined,
    model: undefined,
    ownKey: false,
    registered: () => true,
    report: () => undefined,
  };
  const idled = projectMoments(
    heldProjection(null),
    [
      { kind: NATIVE_MOMENT.ACTIVE },
      { kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE, warm: true },
    ],
    { ...context, sequence: 0 },
  );
  const crashed = projectMoments(
    idled.state,
    [
      {
        kind: NATIVE_MOMENT.ENDED,
        ending: NATIVE_ENDING.FAILED,
        detail: "failed app-server exited",
        launchFailed: true,
      },
    ],
    { ...context, sequence: 1 },
  );
  assert.deepEqual(crashed.writes, []);
});

test("a warm runner a newer launch cut off with no turn under way or queued fails no turn, says so, and lets its limit go", () => {
  const reports: string[] = [];
  const cutOff = projectMoments(
    { rateLimit: "usage limit reached" },
    [
      {
        kind: NATIVE_MOMENT.ENDED,
        ending: NATIVE_ENDING.FAILED,
        detail: "failed the service refused the launch's lines: The service answered 401",
        launchFailed: true,
      },
    ],
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      attempt: 2,
      queuedTurnId: undefined,
      model: undefined,
      ownKey: false,
      registered: () => true,
      report: (said) => reports.push(said),
    },
  );
  assert.deepEqual(cutOff.writes, []);
  assert.deepEqual(cutOff.state, {});
  assert.deepEqual(reports, [
    "A launch with no turn under way ended: failed the service refused the launch's lines: The service answered 401",
  ]);
});

test("an exhausted payer pool leaves a notice at the pause, and a payer with room one naming both payers", () => {
  const context = {
    conversationId: "c_projection",
    sequence: 0,
    now: 0,
    attempt: 1,
    queuedTurnId: undefined,
    model: "anthropic/claude-opus-5.5",
    ownKey: false,
    registered: () => true,
    report: () => undefined,
  };
  const moments = [
    { kind: NATIVE_MOMENT.ACTIVE },
    { kind: NATIVE_MOMENT.RATE_LIMIT, refused: true, detail: "limited", resetsAt: 60000 },
    { kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED },
    { kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.FAILED },
  ] as const;
  const moved = { from: "Work plan", to: "API key · sk-…a91F" };
  const notices = (movedAfterLimit: typeof moved | undefined) =>
    projectMoments(heldProjection(null), moments, {
      ...context,
      movedAfterLimit,
    }).writes.flatMap((write) =>
      write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.USAGE_LIMIT_REACHED
        ? [write.event.notice]
        : [],
    );
  assert.deepEqual(notices(undefined), [{ agent: "Claude", resetsAt: 60000 }]);
  assert.deepEqual(notices(moved), [{ agent: "Claude", resetsAt: null, moved }]);
  const stopped = projectMoments(
    heldProjection(null),
    moments.filter((moment) => moment.kind !== NATIVE_MOMENT.RATE_LIMIT),
    context,
  );
  assert.deepEqual(
    stopped.writes.flatMap((write) =>
      write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.USAGE_LIMIT_REACHED
        ? [write.event.notice]
        : [],
    ),
    [{ agent: "Claude", resetsAt: null }],
  );
});

test("a successful result after a reported limit ends without a usage-limit notice or retry", () => {
  const result = projectMoments(
    heldProjection(null),
    [
      { kind: NATIVE_MOMENT.ACTIVE },
      { kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED },
      { kind: NATIVE_MOMENT.RESULT },
      { kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.VERIFIED },
      { kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE },
    ],
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      attempt: 1,
      queuedTurnId: undefined,
      model: "anthropic/claude-opus-5.5",
      ownKey: false,
      movedAfterLimit: { from: "Work plan", to: "Personal plan" },
      registered: () => true,
      report: () => undefined,
    },
  );
  assert.equal(
    result.writes.some((write) => write.kind === NATIVE_WRITE.WAIT),
    false,
  );
  assert.equal(
    result.writes.some(
      (write) =>
        write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.USAGE_LIMIT_REACHED,
    ),
    false,
  );
  assert.ok(
    result.writes.some(
      (write) => write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.TURN_ENDED,
    ),
  );
});

test("a limit lifted before the turn failed for another reason fails it as that failure, never the plan's limit", () => {
  const result = projectMoments(
    heldProjection(null),
    [
      { kind: NATIVE_MOMENT.ACTIVE },
      {
        kind: NATIVE_MOMENT.RATE_LIMIT,
        refused: true,
        detail: "rate_limit_rejected",
        resetsAt: 60000,
      },
      { kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED },
      { kind: NATIVE_MOMENT.RATE_LIMIT, refused: false, detail: "rate_limit_allowed" },
      { kind: NATIVE_MOMENT.RESULT, failure: "error_during_execution" },
      { kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.FAILED },
    ],
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      attempt: 1,
      queuedTurnId: undefined,
      model: "anthropic/claude-opus-5.5",
      ownKey: false,
      registered: () => true,
      report: () => undefined,
    },
  );
  const ended = result.writes.flatMap((write) =>
    write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.TURN_ENDED
      ? [write.event.failure]
      : [],
  );
  assert.deepEqual(ended, [TURN_FAILURE.MODEL]);
  assert.equal(
    result.writes.some(
      (write) =>
        write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.USAGE_LIMIT_REACHED,
    ),
    false,
  );
});
