/**
 * fixture-orchestrator-agent.ts -- the Inbox fixture's orchestrating agent: one finished turn that reads the invitations agent, messages it, and starts the digest agent, each call a row of its own between its words, so its page draws what a call to another agent sent and opens the agent it names.
 *
 * The Inbox fixture stages it on the digest task, answering its page and
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * but lists it in no task's agents, so every list the fixture stages counts
 * as it did. The agents its calls name are the fixture's own, so a press
 * on one opens a page the fixture draws. Every word here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_ORCHESTRATOR_AGENT_ID = "d637f97a-b2e3-4f0c-a7ce-e3f4051627d3";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Coordinate the invites digest";

/** The fixture's agents the calls name, by the ids and titles `fixture-inbox.ts` gives them (`AGENT.INVITES`, `AGENT.DIGEST`), which this file cannot import, since that one imports it. */
const CALLED = {
  INVITES: { id: "5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5", title: "Build teammate invitations" },
  DIGEST: { id: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6", title: "Send the weekly digest" },
} as const;

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** An agent as a call about it answers it: its id and its title, on another task than the caller's. */
function answeredAgent(agent: { readonly id: string; readonly title: string }): WireRecord {
  return { status: "accepted", agent: { ...agent, onYourTask: false } };
}

/** What the agent asked the invitations agent, which the message's open row quotes whole. */
const MESSAGE =
  "The digest will count pending invites apart from members.\n\nDoes an invite keep its id when it's resent? The digest keys its count on it.";

/** The prompt the digest agent was started on, and the note beside it. */
const START = {
  PROMPT:
    "Summarize what merged and what is still open this week, and post it to the team's digest.",
  NOTE: "Count pending invites apart from members, as the invitations agent settles them.",
} as const;

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, finished. */
export function fixtureOrchestratorAgent(base: AgentSummary): AgentSummary {
  return {
    ...base,
    id: FIXTURE_ORCHESTRATOR_AGENT_ID,
    title: TITLE,
    status: AGENT_STATUS.COMPLETED,
  };
}

/** The agent's transcript, its instants counted from `startedAt`: what `starter` asked, then its one finished turn of calls to the fixture's other agents. */
export function fixtureOrchestratorTranscript(
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: "fixture-orchestrator-ask",
      role: MESSAGE_ROLE.USER,
      parts: [
        {
          type: "text",
          text: "Get this week's digest out, and make sure it counts pending invites right.",
        },
      ],
      sentAt: startedAt,
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
    },
    {
      id: "fixture-orchestrator-work",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        { type: "text", text: "First, where the invitations work stands." },
        toolPart(
          AGENT_TOOL.READ_AGENT,
          "fixture-orchestrator-read",
          { agentId: CALLED.INVITES.id },
          answeredAgent(CALLED.INVITES),
        ),
        { type: "text", text: "It's on resending, so I'll ask it how a resend keeps its id." },
        toolPart(
          AGENT_TOOL.MESSAGE_AGENT,
          "fixture-orchestrator-message",
          { agentId: CALLED.INVITES.id, text: MESSAGE },
          answeredAgent(CALLED.INVITES),
        ),
        { type: "text", text: "Meanwhile an agent can write the digest." },
        toolPart(
          AGENT_TOOL.START_AGENT,
          "fixture-orchestrator-start",
          { taskId: "fixture-digest-task", prompt: START.PROMPT, note: START.NOTE },
          answeredAgent(CALLED.DIGEST),
        ),
        {
          type: "text",
          text: "The digest agent is writing it, and the invitations agent has the question.",
        },
      ],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 3 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}
