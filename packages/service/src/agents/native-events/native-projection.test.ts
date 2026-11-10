import assert from "node:assert/strict";
import { RUN_EVENT, TURN_FAILURE } from "@repo/features/turn-run";
import { test } from "vitest";
import { NATIVE_ENDING, NATIVE_MOMENT, PLAN_STATUS } from "./native-moments.js";
import {
  heldProjection,
  NATIVE_WRITE,
  projectMoments,
  turnProgressed,
} from "./native-projection.js";
import { toolAnswerSettlement } from "./runner-moments.js";

test("an unknown tool's call settled with a new input, as Codex settles one, keeps the input that names the tool it called", () => {
  const result = projectMoments(
    heldProjection(null),
    [
      { kind: NATIVE_MOMENT.TOOL_STARTED, callId: "call_plan", name: "edit_plan", input: {} },
      {
        kind: NATIVE_MOMENT.TOOL_SETTLED,
        callId: "call_plan",
        settlement: toolAnswerSettlement({ workspaceTool: true, text: "Unknown tool" }, true),
        input: { notes: [] },
      },
    ],
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      attempt: 1,
      queuedTurnId: undefined,
      model: undefined,
      ownKey: false,
      registered: () => false,
      report: () => undefined,
    },
  );
  assert.deepEqual(
    result.writes.flatMap((write) =>
      write.kind === NATIVE_WRITE.EVENT &&
      (write.event.kind === RUN_EVENT.TOOL_CALL_STARTED ||
        write.event.kind === RUN_EVENT.TOOL_CALL_SETTLED)
        ? [[write.event.kind, write.event.name, write.event.input]]
        : [],
    ),
    [
      [RUN_EVENT.TOOL_CALL_STARTED, "unknown_tool", { name: "edit_plan", input: {} }],
      [RUN_EVENT.TOOL_CALL_SETTLED, "unknown_tool", undefined],
    ],
  );
});

test("a connection lost to the provider holds the turn open with a notice, counts a heartbeat as progress, and a restore settles the notice and asks for a carry-on", () => {
  const context = {
    conversationId: "c_projection",
    attempt: 1,
    queuedTurnId: "turn-1",
    model: "claude-sonnet-4-5",
    ownKey: false,
    registered: () => true,
    report: () => undefined,
  };
  const lost = projectMoments(
    heldProjection(null),
    [
      { kind: NATIVE_MOMENT.ACTIVE },
      { kind: NATIVE_MOMENT.RESULT, failure: "success: API Error: Connection error." },
      { kind: NATIVE_MOMENT.CONNECTION_LOST, host: "api.anthropic.com" },
    ],
    { ...context, sequence: 1, now: 1_000 },
  );
  const noticed = lost.writes.flatMap((write) =>
    write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.CONNECTION_LOST
      ? [write.event]
      : [],
  );
  assert.equal(noticed.length, 1);
  assert.deepEqual(noticed[0]?.notice, { provider: "Anthropic", restoredAt: null });
  assert.ok(lost.state.turn !== undefined, "the turn stays open");
  assert.equal(lost.state.turn.failure, undefined, "the model turn's failure is let go");
  assert.equal(
    lost.writes.some((write) => write.kind === NATIVE_WRITE.FAILED),
    false,
  );
  assert.equal(turnProgressed(0, lost.state), true, "a heartbeat alone is progress while it waits");

  // A loss told again while the wait stands adds no notice, so the restore settles the first.
  const lostTwice = projectMoments(
    lost.state,
    [{ kind: NATIVE_MOMENT.CONNECTION_LOST, host: "api.anthropic.com" }],
    { ...context, sequence: 2, now: 31_000 },
  );
  assert.deepEqual(lostTwice.writes, []);
  const restored = projectMoments(
    lostTwice.state,
    [{ kind: NATIVE_MOMENT.CONNECTION_RESTORED, host: "api.anthropic.com", carryOn: true }],
    { ...context, sequence: 2, now: 61_000 },
  );
  const settled = restored.writes.flatMap((write) =>
    write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.CONNECTION_RESTORED
      ? [write.event]
      : [],
  );
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.lostSequence, noticed[0]?.sequence);
  assert.equal(settled[0]?.restoredAt, 61_000);
  assert.deepEqual(
    restored.writes.filter((write) => write.kind === NATIVE_WRITE.CARRY_ON),
    [{ kind: NATIVE_WRITE.CARRY_ON, turnId: "turn-1", lostSequence: noticed[0]?.sequence }],
  );
  // A second loss of the same turn asks for a carry-on of its own, keyed apart from the first.
  const lostAgain = projectMoments(
    restored.state,
    [
      { kind: NATIVE_MOMENT.CONNECTION_LOST, host: "api.anthropic.com" },
      { kind: NATIVE_MOMENT.CONNECTION_RESTORED, host: "api.anthropic.com", carryOn: true },
    ],
    { ...context, sequence: 3, now: 121_000 },
  );
  const second = lostAgain.writes.find((write) => write.kind === NATIVE_WRITE.CARRY_ON);
  assert.ok(second !== undefined && second.kind === NATIVE_WRITE.CARRY_ON);
  assert.notEqual(second.lostSequence, noticed[0]?.sequence);
  assert.equal(
    turnProgressed(0, restored.state),
    false,
    "a heartbeat alone is no progress once it goes on",
  );

  // A line the service sent meanwhile goes next instead, so no carry-on is asked for.
  const lineNext = projectMoments(
    lost.state,
    [{ kind: NATIVE_MOMENT.CONNECTION_RESTORED, host: "api.anthropic.com", carryOn: false }],
    { ...context, sequence: 2, now: 61_000 },
  );
  assert.equal(
    lineNext.writes.some((write) => write.kind === NATIVE_WRITE.CARRY_ON),
    false,
  );
});

test("a launch that gives up on the provider fails its turn as expected, with the runner's words", () => {
  const context = {
    conversationId: "c_projection",
    attempt: 1,
    queuedTurnId: "turn-1",
    model: "gpt-5.1-codex",
    ownKey: false,
    registered: () => true,
    report: () => undefined,
  };
  const lost = projectMoments(
    heldProjection(null),
    [
      { kind: NATIVE_MOMENT.ACTIVE },
      { kind: NATIVE_MOMENT.RESULT, failure: "responseStreamDisconnected" },
      { kind: NATIVE_MOMENT.CONNECTION_LOST, host: "chatgpt.com" },
    ],
    { ...context, sequence: 1, now: 1_000 },
  );
  const gaveUp = projectMoments(
    lost.state,
    [
      {
        kind: NATIVE_MOMENT.ENDED,
        ending: NATIVE_ENDING.FAILED,
        detail: "failed chatgpt.com could not be reached, and did not answer again within the wait",
      },
    ],
    { ...context, sequence: 2, now: 601_000 },
  );
  const failed = gaveUp.writes.filter((write) => write.kind === NATIVE_WRITE.FAILED);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.expected, true);
  assert.ok(failed[0]?.detail.includes("did not answer again within the wait"), failed[0]?.detail);
  assert.equal(gaveUp.state.turn, undefined);
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

test("a turn whose launch lost its session goes on once in a replayed launch, and a second loss fails it", () => {
  const context = {
    conversationId: "c_projection",
    now: 0,
    queuedTurnId: "t_lost",
    model: undefined,
    ownKey: false,
    registered: () => true,
    report: () => undefined,
  };
  const lostLaunch = [
    { kind: NATIVE_MOMENT.LINE_ACCEPTED, clientId: "line_lost" },
    { kind: NATIVE_MOMENT.RESULT, failure: "error_during_execution No conversation found" },
    { kind: NATIVE_MOMENT.SESSION_LOST },
    { kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE },
  ] as const;
  const first = projectMoments(heldProjection(null), lostLaunch, {
    ...context,
    sequence: 0,
    attempt: 1,
  });
  const second = projectMoments(first.state, lostLaunch, { ...context, sequence: 1, attempt: 2 });
  const kinds = (writes: typeof first.writes) =>
    writes.flatMap((write) =>
      write.kind === NATIVE_WRITE.RETRY || write.kind === NATIVE_WRITE.FAILED
        ? [{ kind: write.kind, replay: write.kind === NATIVE_WRITE.RETRY && write.replay }]
        : [],
    );
  assert.deepEqual(
    [kinds(first.writes), kinds(second.writes)],
    [[{ kind: NATIVE_WRITE.RETRY, replay: true }], [{ kind: NATIVE_WRITE.FAILED, replay: false }]],
  );
});
