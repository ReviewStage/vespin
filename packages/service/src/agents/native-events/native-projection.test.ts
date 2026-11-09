import assert from "node:assert/strict";
import { RUN_EVENT } from "@repo/features/turn-run";
import { test } from "vitest";
import { NATIVE_ENDING, NATIVE_MOMENT, PLAN_STATUS } from "./native-moments.js";
import { heldProjection, NATIVE_WRITE, projectMoments } from "./native-projection.js";

test("a call of a tool the record does not hold is reported, but the harness's own ToolSearch is left out without a word", () => {
  const reports: string[] = [];
  projectMoments(
    heldProjection(null),
    ["ToolSearch", "RemoteTrigger"].map((name, index) => ({
      kind: NATIVE_MOMENT.TOOL_STARTED,
      callId: `toolu_${index}`,
      name,
      input: {},
    })),
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      attempt: 1,
      queuedTurnId: undefined,
      model: undefined,
      ownKey: false,
      registered: () => false,
      report: (said) => reports.push(said),
    },
  );
  assert.deepEqual(reports, ["A call to RemoteTrigger names no stored tool and is not recorded."]);
});

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

test("an exhausted payer pool leaves a notice at the pause, while a payer with room retries silently", () => {
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
  const notices = (retryLimited: boolean) =>
    projectMoments(heldProjection(null), moments, {
      ...context,
      retryLimited,
    }).writes.flatMap((write) =>
      write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.USAGE_LIMIT_REACHED
        ? [write.event.notice]
        : [],
    );
  assert.deepEqual(notices(false), [{ agent: "Claude", resetsAt: 60000 }]);
  assert.deepEqual(notices(true), []);
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
      retryLimited: true,
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
