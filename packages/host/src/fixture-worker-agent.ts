/**
 * fixture-worker-agent.ts -- the Inbox fixture's agent that hands its work to workers: one still at work, one finished, one whose worker never started, and a Claude Code subagent, so its page draws each delegation's row as the panel's subagent row stands it, and the finished worker's own transcript, which its row opens.
 *
 * The Inbox fixture stages it on the rounding task, answering its page and
 * laying its transcript and its finished worker's where the host holds them
 * (`LIVE_READ.TRANSCRIPT`), but lists it in no task's agents, so every list
 * the fixture stages counts as it did. Every word here is invented.
 */

import { AGENT_TOOL, CLAUDE_CODE_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_DELEGATE_TOOL,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_WORKER_AGENT_ID = "e3b7a9d1-58c2-4f06-b1d4-6a9c2e7f3b18";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Audit the CSV export's rounding";

/** The model the agent's workers run on, which their rows name. */
const WORKER_MODEL = "anthropic/claude-sonnet-5.5";

/** The effort the agent's workers run at. */
const WORKER_EFFORT = "medium";

/** The delegation calls the agent's turn made, each the worker it started is read under. */
const CALL = {
  /** A worker still at work. */
  RUNNING: "fixture-worker-running",
  /** A worker that finished, whose own transcript its row opens. */
  DONE: "fixture-worker-done",
  /** A delegation refused before its worker began. */
  FAILED: "fixture-worker-failed",
  /** A Claude Code subagent, whose work no page keeps. */
  NATIVE: "fixture-worker-native",
} as const;

/** The call whose finished worker's transcript the fixture holds, which a flow opens. */
export const FIXTURE_DONE_WORKER_CALL = CALL.DONE;

/** The tasks the agent handed its workers, each a worker's first line. */
const TASK = {
  RUNNING:
    "Read every CSV writer under src/export and list each place a total is rounded, with its file and line.",
  DONE: "Check that the export's tests cover half-cent totals.\n\nRun only the export's own suite, and say which cases are missing.",
  FAILED: "Compare the ledger's rounding with the export's on last month's statements.",
} as const;

/** What the finished worker answered. */
const DONE_ANSWER =
  "The suite covers half-cent totals for USD and EUR, but not for JPY, which has no minor unit. Two cases are missing: a JPY total and a negative half-cent refund.";

/** One stored tool part: answered where `output` is given, still running where not. */
function toolPart(
  tool: string,
  callId: string,
  input: WireRecord,
  output?: WireRecord,
): WireRecord {
  return output === undefined
    ? { type: `tool-${tool}`, toolCallId: callId, state: "input-available", input }
    : { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, at work while a worker is. */
export function fixtureWorkerAgent(base: AgentSummary): AgentSummary {
  return { ...base, id: FIXTURE_WORKER_AGENT_ID, title: TITLE, status: AGENT_STATUS.RUNNING };
}

/**
 * The agent's transcript, its instants counted from `startedAt`: `starter`'s
 * ask, then its turn, still under way, handing the audit to three workers
 * and a Claude Code subagent; and where each worker stands, as the agent's
 * page says it (`subagents`), the one still at work counting from when it
 * began (`delegations`).
 */
export function fixtureWorkerTranscript(
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const turnAt = startedAt + MINUTE;
  const pair = { model: WORKER_MODEL, effort: WORKER_EFFORT };

  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: "fixture-worker-ask",
      role: MESSAGE_ROLE.USER,
      parts: [
        {
          type: "text",
          text: "Audit how the CSV export rounds its totals, and check its tests cover the edges.",
        },
      ],
      sentAt: startedAt,
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
    },
    {
      id: "fixture-worker-turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        { type: "text", text: "I'll split the audit between workers so it runs side by side." },
        toolPart(AGENT_DELEGATE_TOOL, CALL.RUNNING, { task: TASK.RUNNING, ...pair }),
        toolPart(
          AGENT_DELEGATE_TOOL,
          CALL.DONE,
          { task: TASK.DONE, ...pair },
          { result: DONE_ANSWER, ...pair },
        ),
        {
          type: `tool-${AGENT_DELEGATE_TOOL}`,
          toolCallId: CALL.FAILED,
          state: "output-error",
          input: { task: TASK.FAILED },
          errorText: "The worker could not start: its sandbox ran out of disk space.",
        },
        toolPart(
          CLAUDE_CODE_TOOL.AGENT,
          CALL.NATIVE,
          {
            description: "Find the export's callers",
            prompt: "List every caller of exportCsv in the repository.",
            subagent_type: "Explore",
          },
          { result: "Two callers: the monthly statement job and the admin export button." },
        ),
      ],
      startedAt: turnAt,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: {
      status: AGENT_STATUS.RUNNING,
      runStartedAt: turnAt,
      title: TITLE,
      caughtUp: true,
      delegations: [{ callId: CALL.RUNNING, startedAt: turnAt }],
      subagents: [
        { callId: CALL.RUNNING, status: AGENT_STATUS.RUNNING, ...pair, startedAt: turnAt },
        { callId: CALL.DONE, status: AGENT_STATUS.COMPLETED, ...pair, startedAt: turnAt },
      ],
    },
    pages: 1,
  };
}

/** The finished worker's own transcript, its instants counted from `startedAt`: the task it was handed, as the service keeps it, then its one turn, which reads the export's tests and answers. */
export function fixtureDoneWorkerTranscript(startedAt: number): AppTranscript {
  const turnAt = startedAt + MINUTE;

  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: "fixture-worker-done-task",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: TASK.DONE }],
      sentAt: turnAt,
    },
    {
      id: "fixture-worker-done-turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        toolPart(
          AGENT_TOOL.GREP,
          "fixture-worker-done-grep",
          { pattern: "halfCent", path: "src/export" },
          { content: "src/export/total.test.ts:14\nsrc/export/total.test.ts:31" },
        ),
        toolPart(
          AGENT_TOOL.READ_FILE,
          "fixture-worker-done-read",
          { filePath: "src/export/total.test.ts" },
          { content: 'it("rounds a half-cent USD total up", () => { … });' },
        ),
        { type: "step-start" },
        { type: "text", text: DONE_ANSWER },
      ],
      startedAt: turnAt,
      finishedAt: turnAt + 3 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: {
      status: AGENT_STATUS.COMPLETED,
      runStartedAt: turnAt,
      title: "Half-cent test coverage",
      caughtUp: true,
    },
    pages: 1,
  };
}
