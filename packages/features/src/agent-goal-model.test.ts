/**
 * agent-goal-model.test.ts -- an agent's goal as its transcript's goal notices leave it: set, judged, settled and seen, or cleared, with a project's own Stop hook moving nothing.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import { GOAL_EVENT, GOAL_PART, type GoalNotice } from "@repo/wire/ui-messages";
import { describe, expect, it } from "vitest";
import { AGENT_GOAL_STATE, agentGoal } from "./agent-goal-model.js";
import { AGENT_SENDER, type AgentTranscriptMessage } from "./agent-wire.js";

const CONDITION = "every billing test passes";

function notice(event: GoalNotice["event"], said: Partial<GoalNotice> = {}): GoalNotice {
  return {
    event,
    condition: CONDITION,
    reason: null,
    turns: null,
    tokens: null,
    tokenBudget: null,
    ...said,
  };
}

/** One turn of the agent's, holding the goal notices given, begun at `startedAt`. */
function turn(
  id: string,
  notices: readonly GoalNotice[],
  startedAt = 1_000,
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    startedAt,
    parts: notices.map((data, at) => ({ type: GOAL_PART, id: String(at), data })),
  };
}

function line(id: string): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "go on" }] };
}

describe("agentGoal", () => {
  it("counts the checker's verdicts as turns and keeps its newest reason, past a project's own Stop hook", () => {
    const goal = agentGoal([
      turn("t1", [
        notice(GOAL_EVENT.SET),
        notice(GOAL_EVENT.NOT_MET, { reason: "3 tests fail." }),
        // A project's own blocking Stop hook says its feedback in the same shape, under its own prompt.
        notice(GOAL_EVENT.NOT_MET, { condition: "lint is clean", reason: "Run lint." }),
        notice(GOAL_EVENT.NOT_MET, { reason: "1 test fails." }),
      ]),
    ]);

    expect(goal).toEqual({
      condition: CONDITION,
      state: AGENT_GOAL_STATE.ACTIVE,
      setAt: 1_000,
      turns: 3,
      tokens: null,
      tokenBudget: null,
      reason: "1 test fails.",
      messageId: "t1",
    });
  });

  it("reads a verdict whose condition holds the words that part it from its reason as the goal's", () => {
    const condition = "lint says [ok]: nothing to fix";

    const goal = agentGoal([
      turn("t1", [
        notice(GOAL_EVENT.SET, { condition }),
        // The service split the CLI's feedback at its first "]: ", inside the condition.
        notice(GOAL_EVENT.NOT_MET, {
          condition: "lint says [ok",
          reason: "nothing to fix]: 2 warnings.",
        }),
      ]),
    ]);

    expect(goal).toMatchObject({ condition, turns: 2, reason: "2 warnings." });
  });

  it("takes a goal up from a move its harness said where its setting is on an older page, unread, but never from a verdict alone", () => {
    const met = [turn("t9", [notice(GOAL_EVENT.MET, { reason: "All pass.", turns: 4 })])];
    expect(agentGoal(met, true)).toMatchObject({
      condition: CONDITION,
      state: AGENT_GOAL_STATE.MET,
      turns: 4,
    });
    // A verdict alone may be a project's own Stop hook's word, which moves nothing.
    const verdict = [turn("t9", [notice(GOAL_EVENT.NOT_MET, { reason: "Run lint." })])];
    expect(agentGoal(verdict, true)).toBeUndefined();
    expect(agentGoal(met, false)).toBeUndefined();
  });

  it("stands settled until the developer writes again, and stands nowhere once cleared", () => {
    const met = [
      turn("t1", [
        notice(GOAL_EVENT.SET),
        notice(GOAL_EVENT.MET, { reason: "All pass.", turns: 2 }),
      ]),
    ];

    expect(agentGoal(met)).toMatchObject({
      state: AGENT_GOAL_STATE.MET,
      turns: 2,
      reason: "All pass.",
    });
    expect(agentGoal([...met, line("l2")])).toBeUndefined();
    // A wakeup the app sent is no line of the developer's, and leaves the goal's end standing.
    expect(
      agentGoal([...met, { ...line("w"), sentBy: { kind: AGENT_SENDER.APP, name: "Vespin" } }]),
    ).toMatchObject({
      state: AGENT_GOAL_STATE.MET,
    });

    // A line steered into the turn before the goal was met is stored behind the turn, but was read before the goal settled.
    const steered = [
      {
        ...turn("t1", [notice(GOAL_EVENT.SET)]),
        parts: [
          { type: "step-start" },
          { type: GOAL_PART, id: "0", data: notice(GOAL_EVENT.SET) },
          { type: "step-start" },
          { type: GOAL_PART, id: "1", data: notice(GOAL_EVENT.MET, { reason: "All pass." }) },
        ],
      },
      { ...line("s"), arrivedIn: { journalId: "t1", afterStep: 1 } },
    ];

    expect(agentGoal(steered)).toMatchObject({ state: AGENT_GOAL_STATE.MET });

    const cleared = [
      turn("t1", [notice(GOAL_EVENT.SET)]),
      line("l2"),
      turn("t2", [notice(GOAL_EVENT.CLEARED)]),
    ];

    expect(agentGoal(cleared)).toBeUndefined();
  });
});
