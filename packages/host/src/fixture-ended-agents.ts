/**
 * fixture-ended-agents.ts -- the Inbox fixture's agents whose last turn ended without finishing, so each page ends on its end line: one the account stopped, one failed past what a message mends, which offers Continue in new agent, one failed where a message carries it on, which offers Try again, and one whose first launch failed before it wrote a message, whose end line stands alone.
 *
 * The Inbox fixture stages them on the rounding task, answering each page
 * and laying each transcript where the host holds one
 * (`LIVE_READ.TRANSCRIPT`), but lists them in no task's agents, so every
 * list the fixture stages counts as it did. Every word here is invented.
 */

import {
  AGENT_FAILURE,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentFailure,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE, TURN_STATUS, type TurnStatus } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agents' ids, which a fixture run opens each page by (`-agent <id>`). */
export const FIXTURE_ENDED_AGENT = {
  STOPPED: "d637f97a-b2e3-4f0c-87ce-e3f4051627a1",
  FAILED_CONTINUE: "d637f97a-b2e3-4f0c-87ce-e3f4051627a2",
  FAILED_RETRY: "d637f97a-b2e3-4f0c-87ce-e3f4051627a3",
  NEVER_STARTED: "d637f97a-b2e3-4f0c-87ce-e3f4051627a4",
} as const;

type EndedAgentId = (typeof FIXTURE_ENDED_AGENT)[keyof typeof FIXTURE_ENDED_AGENT];

/** The one turn an ended agent ran: how it ended and its id, the line it was sent and what it wrote before it ended, each by its message's id. */
interface EndedRun {
  readonly turn: TurnStatus;
  readonly turnId: string;
  readonly askedId: string;
  readonly wroteId: string;
  readonly failure: AgentFailure | undefined;
  readonly asked: string;
  readonly wrote: string;
}

/** One ended agent: its title, where it stands, and its one turn; none for an agent whose first launch failed before any turn opened. */
interface EndedAgent {
  readonly title: string;
  readonly status: AgentStatus;
  readonly run: EndedRun | undefined;
}

const ENDED: Readonly<Record<EndedAgentId, EndedAgent>> = {
  [FIXTURE_ENDED_AGENT.STOPPED]: {
    title: "Backfill ledger currency codes",
    status: AGENT_STATUS.CANCELED,
    run: {
      turn: TURN_STATUS.CANCELED,
      turnId: "d637f97a-b2e3-4f0c-87ce-e3f4051627b1",
      askedId: "fixture-stopped-asked",
      wroteId: "fixture-stopped-turn",
      failure: undefined,
      asked: "Backfill the currency code on every ledger row written before March.",
      wrote: "Reading the ledger rows written before March to find the ones with no currency code.",
    },
  },
  // Note that a conversation too long for the model takes no message again, so only a new agent goes on past it.
  [FIXTURE_ENDED_AGENT.FAILED_CONTINUE]: {
    title: "Reconcile a year of ledger rounding",
    status: AGENT_STATUS.FAILED,
    run: {
      turn: TURN_STATUS.FAILED,
      turnId: "d637f97a-b2e3-4f0c-87ce-e3f4051627b2",
      askedId: "fixture-overflow-asked",
      wroteId: "fixture-overflow-turn",
      failure: AGENT_FAILURE.CONTEXT_OVERFLOW,
      asked: "Reconcile the rounding of every month this year against the bank's statements.",
      wrote: "January through August reconcile to the cent. Reading September's statement next.",
    },
  },
  // Note that a failed checkout leaves the agent taking messages, so a message carries it on.
  [FIXTURE_ENDED_AGENT.FAILED_RETRY]: {
    title: "Check rounding against the bank feed",
    status: AGENT_STATUS.FAILED,
    run: {
      turn: TURN_STATUS.FAILED,
      turnId: "d637f97a-b2e3-4f0c-87ce-e3f4051627b3",
      askedId: "fixture-sandbox-asked",
      wroteId: "fixture-sandbox-turn",
      failure: AGENT_FAILURE.SANDBOX,
      asked: "Check the ledger's rounding against this week's bank feed.",
      wrote: "Cloning the ledger repository to read this week's rounding.",
    },
  },
  // Note that an agent whose first launch failed before any turn opened holds no message, so its page is its end line alone, which reads it as never started and offers Continue.
  [FIXTURE_ENDED_AGENT.NEVER_STARTED]: {
    title: "Archive last year's ledger exports",
    status: AGENT_STATUS.FAILED,
    run: undefined,
  },
};

/** The ended agents' ids, in the order their pages are shot. */
export const FIXTURE_ENDED_AGENT_IDS: readonly EndedAgentId[] = Object.values(FIXTURE_ENDED_AGENT);

/** The ended agent `agentId` as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, and its last turn, ended as it ended, where it ran one. */
export function fixtureEndedAgent(base: AgentSummary, agentId: EndedAgentId): AgentSummary {
  const { title, status, run } = ENDED[agentId];
  const agent = { ...base, id: agentId, title, status };

  if (run === undefined) return agent;

  return {
    ...agent,
    turnId: run.turnId,
    turn: {
      id: run.turnId,
      queuedAt: base.createdAt,
      status: run.turn,
      ...(run.failure === undefined ? undefined : { failure: run.failure }),
    },
  };
}

/** The ended agent's transcript, its instants counted from `startedAt`: the line `starter` sent it, then its one turn, ended before it finished its work; nothing where it ran no turn. */
export function fixtureEndedTranscript(
  agentId: EndedAgentId,
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const { title, status, run } = ENDED[agentId];

  const messages: readonly AgentTranscriptMessage[] =
    run === undefined
      ? []
      : [
          {
            id: run.askedId,
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: run.asked }],
            sentAt: startedAt,
            sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
          },
          {
            id: run.wroteId,
            role: MESSAGE_ROLE.ASSISTANT,
            parts: [{ type: "step-start" }, { type: "text", text: run.wrote }],
            startedAt: startedAt + MINUTE,
            finishedAt: startedAt + 4 * MINUTE,
          },
        ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: {
      status,
      runStartedAt: startedAt,
      title,
      caughtUp: true,
      ...(run?.failure === undefined ? undefined : { failureReason: run.failure }),
    },
    pages: 1,
  };
}
