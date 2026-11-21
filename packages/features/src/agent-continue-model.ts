/**
 * agent-continue-model.ts -- where an agent may be continued in a new one on its whole transcript, and the agents that continued it, as the panel's tab and the iPhone's agent page both read it.
 *
 * A continue is a Start from the agent naming no message
 * (`agent-fork-model.ts`'s `continueFork`). A failed turn offers it where a
 * new agent is the one way on (`endLineOffersContinue`), and once another
 * agent continued this one, as Continue again in the same place. The panel
 * draws it on the failed turn's end line; the phone, which draws no end
 * line, in its agent page's menu.
 */

import { agentFailureWords, mendedByNewAgent } from "./agent-failure-words.js";
import {
  AGENT_FAILURE,
  AGENT_STATUS,
  type AgentFailure,
  type AgentStatus,
  type AgentSummary,
} from "./agent-wire.js";
import { FAILURE_REASON, type FailureReason } from "./failure-remedy.js";

/** What the press that starts a new agent on another's whole transcript says. */
export const CONTINUE_LABEL = "Continue in new agent";

/** What that press says once another agent continued the agent, in the same place on the failed end line. */
export const CONTINUE_AGAIN_LABEL = "Continue again";

/** What mends a failed turn from its end line: the API keys' page for a key refused; nothing else there is the developer's to mend. */
export function endLineReason(failure: AgentFailure | undefined, starter?: string): FailureReason {
  // A teammate's key is theirs to mend, so the reader is offered no Settings of their own.
  return failure === AGENT_FAILURE.PROVIDER_KEY && starter === undefined
    ? FAILURE_REASON.API_KEY
    : FAILURE_REASON.OTHER;
}

/**
 * The agents of the task that continue `agentId`: each started from it on
 * its whole transcript, naming no message, archived ones among them, in the
 * order started. Note that a fork names the message it was cut at, so it
 * continues nothing.
 */
function continuationsOf(
  agentId: string,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly AgentSummary[] {
  return [...(agents ?? []), ...(archived ?? [])]
    .filter((each) => each.from?.agentId === agentId && each.from.messageId === undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The ids of the agents that continue `agent`, oldest first: those the
 * service names on its summary (`continuedBy`), so a page that lists the
 * agent alone still names them, then any the task's agents name that the
 * summary does not yet (`continuationsOf`), as one just started. Note that
 * a service older than `continuedBy` leaves the key out, which reads the
 * list alone, and that a fork is never a continuation.
 */
export function continuedByIds(
  agent: AgentSummary,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly string[] {
  const named = (agent.continuedBy ?? [])
    .filter((each) => !each.forked && each.messageId === undefined)
    .map((each) => each.agentId);

  const listed = continuationsOf(agent.id, agents, archived).map((each) => each.id);

  return [...new Set([...named, ...listed])];
}

/** The titles the summary gives the agents that continue it, by id, for a page whose list does not hold them; none for one with no title yet. */
export function continuedByTitles(agent: AgentSummary): ReadonlyMap<string, string> {
  const titled = (agent.continuedBy ?? []).flatMap((each) =>
    each.title === null ? [] : [[each.agentId, each.title] as const],
  );

  return new Map(titled);
}

/** Whether a turn's end line is where an agent may be continued: it failed, and not on a refused API key, which a new agent would meet the same. */
export function endLineContinues(status: AgentStatus, endReason: FailureReason): boolean {
  return status === AGENT_STATUS.FAILED && endReason !== FAILURE_REASON.API_KEY;
}

/**
 * Whether the end line's row ends on Continue, after its words: where the
 * line continues the agent (`endLineContinues`), as Continue in new agent,
 * and once another agent continued it as Continue again, in the same place,
 * since the continued note that takes the box offers none. Before then, it
 * offers the press only where a new agent is the one way on: a failure only
 * one mends (`mendedByNewAgent`). Every other failure leaves the box open
 * and the agent taking messages, so a message carries it on, as a coding
 * CLI's error leaves its session for the next prompt. A box closed on an
 * ended agent offers the press itself, carrying its words, so the line
 * offers none and one Continue stands on screen.
 */
export function endLineOffersContinue(input: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): boolean {
  if (!endLineContinues(input.status, input.endReason)) return false;

  if (input.continued) return true;

  return !input.boxClosed && mendedByNewAgent(input.failure);
}

/**
 * The failure a settled agent's end line tells of: its newest turn's, or,
 * for an agent that failed before any turn opened, that it never started,
 * as the panel's tab reads it where no send of its own is newer.
 */
export function settledFailure(agent: {
  readonly status: AgentStatus;
  readonly turn?: { readonly failure?: AgentFailure | undefined } | undefined;
}): AgentFailure | undefined {
  if (agent.turn !== undefined) return agent.turn.failure;

  return agent.status === AGENT_STATUS.FAILED ? AGENT_FAILURE.NOT_STARTED : undefined;
}

/** What a failed turn's end line says where its failure has no words of its own. */
const FAILED_UNSAID = "the run ended without saying why";

/**
 * What a failed turn's end line says of its failure: "Failed: " and why, of
 * the key the starter named ran on (`agentFailureWords`), leaving out the
 * advice to start a new agent where the line itself offers the continue
 * (`continuable`).
 */
export function failedLineWords(
  failure: AgentFailure | undefined,
  starter: string | undefined,
  continuable: boolean,
): string {
  const words =
    failure === undefined ? undefined : agentFailureWords(failure, starter, continuable);

  return `Failed: ${words ?? FAILED_UNSAID}`;
}
