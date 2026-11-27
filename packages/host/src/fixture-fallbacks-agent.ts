/**
 * fixture-fallbacks-agent.ts -- the Inbox fixture's agent whose one turn holds what a build draws by a fallback: a set shown whose picture was not kept, a call in a state this build does not know, a call given and answering nothing to draw, words that are only a link's definition, and another agent's message of its head alone.
 *
 * The Inbox fixture stages it on the rounding task, answering its page and
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * but lists it in no task's agents, so every list the fixture stages counts
 * as it did. Every word here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_MESSAGE_LEAD,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
  agentMessageReplyLine,
} from "@repo/features/agent-wire";
import { MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_FALLBACKS_AGENT_ID = "3b9e6f12-7c4d-4a85-b1e0-9d2c8f4a6e17";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Tidy the ledger's labels";

/** The agent that sends this one a message of its head alone: the fixture's digest agent, by the id `fixture-inbox.ts` gives it, which this file cannot import, since that one imports it. */
const MESSAGING_AGENT = { id: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6", name: "Weekly digest email" };

/** What the agent was asked, and what it said once its turn was done. */
const WORDS = {
  ASKED: "Tidy the ledger's labels, and show me the settings page once it reads right.",
  DONE: "The labels are tidy, and the export reads them in one place now.",
} as const;

/**
 * A reference link's definition alone, which Markdown reads as no block, so
 * a build that draws only blocks draws nothing for it.
 */
const DEFINITION_ALONE = "[ledger]: https://example.com/ledger";

/** The state a newer writer stores that this build's list of tool states does not name. */
const NEWER_TOOL_STATE = "output-denied";

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, finished. */
export function fixtureFallbacksAgent(base: AgentSummary): AgentSummary {
  return { ...base, id: FIXTURE_FALLBACKS_AGENT_ID, title: TITLE, status: AGENT_STATUS.COMPLETED };
}

/** The agent's transcript, its instants counted from `startedAt`: what `starter` asked, the one finished turn of fallbacks, then another agent's message of its head alone. */
export function fixtureFallbacksTranscript(
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: "fixture-fallbacks-asked",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: WORDS.ASKED }],
      sentAt: startedAt,
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
    },
    {
      id: "fixture-fallbacks-turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        // Note that the call answered in a state this build does not know, as a newer writer stores a denied call.
        {
          type: `tool-${AGENT_TOOL.BASH}`,
          toolCallId: "fixture-fallbacks-denied",
          state: NEWER_TOOL_STATE,
          input: { command: "rm -rf exports/", description: "Clear the old exports" },
        },
        // Note that the call was given nothing and answered only that it went, so its opened body holds no block.
        {
          type: "tool-sync_labels",
          toolCallId: "fixture-fallbacks-sync",
          state: "output-available",
          input: {},
          output: { ok: true },
        },
        { type: "text", text: DEFINITION_ALONE },
        // Note that the service kept none of the pictures the set showed.
        {
          type: `tool-${AGENT_TOOL.SHOW_MEDIA}`,
          toolCallId: "fixture-fallbacks-shown",
          state: "output-available",
          input: {
            images: [{ path: "/shots/ledger-settings.png", caption: "The ledger's settings" }],
          },
          output: { status: "accepted", pictures: [] },
        },
        { type: "text", text: WORDS.DONE },
      ],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 4 * MINUTE,
    },
    // Note that the message is its head and its reply line alone, so its words as a person reads them are empty.
    {
      id: "fixture-fallbacks-message",
      role: MESSAGE_ROLE.USER,
      parts: [
        {
          type: "text",
          text: [
            `${AGENT_MESSAGE_LEAD} · ${MESSAGING_AGENT.name} to you:`,
            agentMessageReplyLine(MESSAGING_AGENT.id),
          ].join("\n\n"),
        },
      ],
      metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
      sentAt: startedAt + 5 * MINUTE,
      sentBy: { name: MESSAGING_AGENT.name, agent: true, agentId: MESSAGING_AGENT.id },
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}
