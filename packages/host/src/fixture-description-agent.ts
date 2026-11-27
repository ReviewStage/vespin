/**
 * fixture-description-agent.ts -- the Inbox fixture's agent started on its task's description: a long description as its first line, and one finished turn, so its page opens on the Description card the panel stands it in.
 *
 * The Inbox fixture stages it on the rounding task, answering its page and
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * but lists it in no task's agents, so every list the fixture stages counts
 * as it did. Every word here is invented.
 */

import {
  AGENT_BRIEF,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_DESCRIPTION_AGENT_ID = "c526e869-a1d2-4efb-96bd-d2e3f405162c";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Split ledger exports by currency";

/** One section of the description, numbered `n`: a heading, its points, and a closing line. */
function section(n: number): string {
  return [
    `## Part ${n}`,
    "",
    `- Group the export's rows by currency before totals are summed, for ledger ${n}.`,
    "- Keep each currency's rounding as the ledger settles it, never the report's.",
    "- Write one file per currency, named by its ISO code, beside the combined file.",
    "",
    `Part ${n} is done when its files reconcile with the ledger to the cent.`,
  ].join("\n");
}

/** The task's description as the agent was handed it, as long as a real one runs, which stands as tall as many screens where it is drawn whole. */
const DESCRIPTION = [
  "# Split ledger exports by currency",
  "",
  "The monthly export sums every currency into one total, so a team billing in two currencies reads a number that matches neither ledger.",
  "",
  ...Array.from({ length: 12 }, (_, n) => section(n + 1)),
  "",
  "## Acceptance",
  "",
  "- Every currency's file reconciles with its ledger.",
].join("\n");

/** The agent's one turn on the description, finished. */
const ANSWER =
  "The export now writes one file per currency beside the combined one, and each reconciles with its ledger to the cent.";

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, handed the task's description, finished. */
export function fixtureDescriptionAgent(base: AgentSummary): AgentSummary {
  return {
    ...base,
    id: FIXTURE_DESCRIPTION_AGENT_ID,
    title: TITLE,
    status: AGENT_STATUS.COMPLETED,
    brief: AGENT_BRIEF.DESCRIPTION,
  };
}

/** The agent's transcript, its instants counted from `startedAt`: the description `starter` handed it, then its one finished turn. */
export function fixtureDescriptionTranscript(
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: "fixture-description-brief",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: DESCRIPTION }],
      sentAt: startedAt,
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
    },
    {
      id: "fixture-description-answer",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [{ type: "step-start" }, { type: "text", text: ANSWER }],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 2 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}
