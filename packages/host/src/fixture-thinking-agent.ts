/**
 * fixture-thinking-agent.ts -- the Inbox fixture's agent that thinks: one ask and one finished turn holding a long thought among its calls, which fold with them, and a thought its page carried cut between its words, which a read answers whole.
 *
 * The Inbox fixture stages it on the invitations task, answering its page,
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * and answering the read of its cut thought (`fixtureThinkingPart`), as the
 * service answers one, but lists it in no task's agents, so every list the
 * fixture stages counts as it did. Every word here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_CALL_FAILURE, type AgentPartView } from "@repo/features/agent-view";
import {
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
  PART_CUT_FIELD,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_THINKING_AGENT_ID = "2b7e4c91-5d3a-4f86-9c1e-7a8b9c0d1e2f";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Look into expired invites";

/** The ids its two messages stand under. */
const MESSAGE = {
  ASK: "fixture-thinking-ask",
  TURN: "fixture-thinking-turn",
} as const;

/** The cut thought's place among the turn's parts, which its page's cut names it by. */
const CUT_INDEX = 5;

/** The thought among the turn's calls, long enough to wrap many lines once opened, opening on a bold title of its own, as a model's thought often does. */
const LONG_THOUGHT = [
  "**Checking why invites expire**",
  "Nine invites expired, and the funnel counts an invite as expired once seven days pass without a click. Before saying why, I want to know whether these nine were ever opened: an email that bounced reads the same as one ignored in that count.",
  "The invites table keeps a sent time and an accepted time, but no opened time, so I'll read the mail provider's events for the nine addresses instead. If most of them bounced, the fix is in the address check on the dialog, not in the expiry.",
  "I'll also check which of them were sent before the resend change landed, since those had no way to be sent again and would have expired regardless.",
].join("\n\n");

/** The thought its page carried cut: its two ends, its middle, which only a whole read holds, and its whole size. */
const CUT_THOUGHT = {
  HEAD: "**Weighing a resend against a new invite**\n\nA resend could mint a new invite row, or keep the pending membership and replace only its link.",
  MIDDLE: [
    "A new row would leave the old one behind as expired, so the funnel would count the same person twice, once expired and once accepted, and the expired count would grow every time anyone resent.",
    "Keeping the row and replacing the link keeps one person to one membership, which is how the description settled an invite. The link's token is what expires, so the token is what a resend replaces.",
    "The old link should keep working until the new email is sent, so the swap waits for the provider to accept the new email before it retires the old token.",
  ].join("\n\n"),
  TAIL: "So a resend keeps the membership and swaps the token once the new email is out, and none of the nine needs a new row.",
  BYTES: 48_213,
} as const;

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, finished. */
export function fixtureThinkingAgent(base: AgentSummary): AgentSummary {
  return { ...base, id: FIXTURE_THINKING_AGENT_ID, title: TITLE, status: AGENT_STATUS.COMPLETED };
}

/** The agent's transcript, its instants counted from `startedAt`: what `reader` asked, then its one finished turn of thinking, calls, and words. */
export function fixtureThinkingTranscript(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: MESSAGE.ASK,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Why did nine invites expire?" }],
      sentAt: startedAt,
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: reader.userId, name: reader.name },
    },
    {
      id: MESSAGE.TURN,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: LONG_THOUGHT },
        {
          type: `tool-${AGENT_TOOL.BASH}`,
          toolCallId: "fixture-thinking-events",
          state: "output-available",
          input: {
            command: "mail-events --status --since 30d invites",
            description: "Read the mail events for the expired invites",
          },
          output: { stdout: " delivered | 7\n bounced   | 2", stderr: "", exitCode: 0 },
        },
        {
          type: `tool-${AGENT_TOOL.READ_FILE}`,
          toolCallId: "fixture-thinking-read",
          state: "output-available",
          input: { filePath: "src/members/invite.ts" },
          output: { content: "export const INVITE_DAYS = 7;" },
        },
        {
          type: "text",
          text: "Seven of the nine were delivered and never opened, and two bounced: their addresses had a typo the dialog let through.",
        },
        // Note that the page carries this thought cut (`cutParts` below), so its words here are empty, as the service sends them.
        { type: "reasoning", text: "" },
        {
          type: "text",
          text: "A resend keeps the pending membership and swaps its link, so the seven can be sent again without counting anyone twice.",
        },
      ],
      cutParts: [
        {
          index: CUT_INDEX,
          field: PART_CUT_FIELD.TEXT,
          bytes: CUT_THOUGHT.BYTES,
          head: CUT_THOUGHT.HEAD,
          tail: CUT_THOUGHT.TAIL,
        },
      ],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 4 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}

/** A part of a transcript whole, by its agent, its message, and its place there, as the host answers a read of a part its page carried cut: this agent's cut thought; that it is not found for any other, since no other fixture agent's page carries a part cut. */
export function fixtureThinkingPart(
  agentId: string,
  messageId: string,
  index: number,
): AgentPartView {
  if (agentId !== FIXTURE_THINKING_AGENT_ID || messageId !== MESSAGE.TURN || index !== CUT_INDEX) {
    return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
  }

  const text = [CUT_THOUGHT.HEAD, CUT_THOUGHT.MIDDLE, CUT_THOUGHT.TAIL].join("\n\n");

  return { part: { type: "reasoning", text } };
}
