/**
 * fixture-notices-agent.ts -- the Inbox fixture's agent whose transcript holds one of each quiet notice a coding agent's harness leaves between its stretches of work: compacted, a lost connection restored and one still waited on, a goal set, judged, paused, resumed, and met, a move to a Mac, and a new session.
 *
 * The Inbox fixture stages it on the rounding task, answering its page and
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * but lists it in no task's agents, so every list the fixture stages counts
 * as it did. Every word, name, and number here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import {
  AGENT_MOVED_PART,
  COMPACTED_PART,
  CONNECTION_LOST_PART,
  CONNECTION_LOST_PROVIDER,
  GOAL_EVENT,
  GOAL_PART,
  type GoalNotice,
  SESSION_CLEARED_PART,
} from "@repo/wire/ui-messages";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_NOTICES_AGENT_ID = "7cce5db7-d11b-47b2-8dea-066b80cb21f8";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Speed up the nightly reconciliation";

/** The goal the developer sets the agent, whose condition each of its notices names. */
const CONDITION = "the nightly reconciliation finishes in under ten minutes";

/** One move of the goal, as its harness said it. */
function goal(event: GoalNotice["event"], said: Partial<GoalNotice> = {}): WireRecord {
  return {
    type: GOAL_PART,
    data: {
      event,
      condition: CONDITION,
      reason: null,
      turns: null,
      tokens: null,
      tokenBudget: null,
      ...said,
    },
  };
}

/** A finished command the agent ran. */
function ran(callId: string, command: string, stdout: string): WireRecord {
  return {
    type: `tool-${AGENT_TOOL.BASH}`,
    toolCallId: callId,
    state: "output-available",
    input: { command, description: command },
    output: { stdout, stderr: "", exitCode: 0 },
  };
}

/** A line `starter` sent, `at` epoch milliseconds. */
function said(
  id: string,
  at: number,
  text: string,
  starter: { readonly userId: string; readonly name: string },
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    sentAt: at,
    sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
  };
}

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, still at work. */
export function fixtureNoticesAgent(base: AgentSummary): AgentSummary {
  return { ...base, id: FIXTURE_NOTICES_AGENT_ID, title: TITLE, status: AGENT_STATUS.RUNNING };
}

/**
 * The agent's transcript, its instants counted from `startedAt`: a first
 * turn that compacts and loses its connection for a minute; a goal
 * `starter` sets, judged not met once, the agent moving to their Mac,
 * paused and resumed, then met; and a last turn on a new session, waiting
 * on its connection still.
 */
export function fixtureNoticesTranscript(
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    said(
      "fixture-notices-ask",
      startedAt,
      "The nightly reconciliation takes forty minutes. Find where the time goes.",
      starter,
    ),
    {
      id: "fixture-notices-profile",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        ran(
          "fixture-notices-profile-run",
          "pnpm reconcile --profile",
          "matching   31m 12s\nsumming     6m 40s\nwriting     2m 03s",
        ),
        { type: COMPACTED_PART, data: { tokensBefore: 148_000 } },
        {
          type: CONNECTION_LOST_PART,
          data: {
            provider: CONNECTION_LOST_PROVIDER.ANTHROPIC,
            restoredAt: startedAt + 6 * MINUTE,
          },
        },
        {
          type: "text",
          text: "Matching takes most of the run: it compares every ledger row with every bank row.",
        },
      ],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 8 * MINUTE,
    },
    said("fixture-notices-goal-ask", startedAt + 20 * MINUTE, `/goal ${CONDITION}`, starter),
    {
      id: "fixture-notices-goal",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        goal(GOAL_EVENT.SET),
        { type: "step-start" },
        ran("fixture-notices-index-run", "pnpm reconcile --profile", "total      14m 51s"),
        goal(GOAL_EVENT.NOT_MET, {
          reason: "The run still takes 14m 51s. Matching by date first would cut it further.",
          turns: 1,
        }),
        {
          type: AGENT_MOVED_PART,
          data: {
            at: startedAt + 30 * MINUTE,
            from: {},
            to: { deviceId: "fixture-device-studio", name: "Studio" },
          },
        },
        goal(GOAL_EVENT.PAUSED),
        goal(GOAL_EVENT.RESUMED),
        ran("fixture-notices-date-run", "pnpm reconcile --profile", "total       8m 04s"),
        goal(GOAL_EVENT.MET, { turns: 2 }),
        {
          type: "text",
          text: "Matching by date first brings the run to 8 minutes.",
        },
      ],
      startedAt: startedAt + 20 * MINUTE,
      finishedAt: startedAt + 45 * MINUTE,
    },
    said(
      "fixture-notices-weekly-ask",
      startedAt + 60 * MINUTE,
      "Do the same for the weekly run.",
      starter,
    ),
    {
      id: "fixture-notices-weekly",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: SESSION_CLEARED_PART, data: { at: startedAt + 60 * MINUTE } },
        { type: "step-start" },
        {
          type: CONNECTION_LOST_PART,
          data: { provider: CONNECTION_LOST_PROVIDER.ANTHROPIC, restoredAt: null },
        },
      ],
      startedAt: startedAt + 60 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.RUNNING, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}
