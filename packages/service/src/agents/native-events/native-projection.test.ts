import assert from "node:assert/strict";
import { test } from "vitest";
import { RUN_EVENT } from "../../core.js";
import { NATIVE_ENDING, NATIVE_MOMENT } from "./native-moments.js";
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
      catalogModelOf: () => undefined,
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
    catalogModelOf: () => undefined,
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

test("a conversation not yet metered by model is billed its model turn, never its session's whole totals", () => {
  const modelTurn = {
    inputTokens: 130,
    outputTokens: 5,
    cachedInputTokens: 100,
    reasoningTokens: 0,
  };
  // The session's totals count every turn since it began, which turns metered before by their main loop already billed.
  const sessionTotals = {
    inputTokens: 9_000,
    outputTokens: 700,
    cachedInputTokens: 8_000,
    reasoningTokens: 0,
  };
  const { writes } = projectMoments(
    heldProjection(null),
    [
      {
        kind: NATIVE_MOMENT.MODEL_USAGE_TOTALS,
        session: "s_before",
        totals: [{ providerModel: "claude-opus-5-5", usage: sessionTotals }],
        modelTurn,
      },
      { kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE },
    ],
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      attempt: 1,
      queuedTurnId: undefined,
      model: "anthropic/claude-opus-5.5",
      catalogModelOf: () => undefined,
      ownKey: false,
      registered: () => true,
      report: () => undefined,
    },
  );
  const ended = writes.flatMap((write) =>
    write.kind === NATIVE_WRITE.EVENT && write.event.kind === RUN_EVENT.TURN_ENDED
      ? [write.event]
      : [],
  );
  assert.deepEqual(
    ended.map((event) => [event.usage, event.usageByModel]),
    [[modelTurn, [{ model: "anthropic/claude-opus-5.5", ...modelTurn }]]],
  );
});
