/**
 * fork-model.ts -- a coding agent forked at one of its messages: the fork a draft holds, what its chip quotes of the message, the choice it starts on, the Start a forked draft sends, and where each message was forked to.
 *
 * A fork is a new agent on the same plan handed the source's transcript up
 * to and including one of the source's own messages
 * (`agentStartRequestFields`' `from`), kept whole, which its tab offers
 * once the turn that wrote it has ended. The draft that sends it holds
 * the fork beside its choices (`use-agents.ts`), with the opening
 * words of the message it was forked at, which its chip quotes. The
 * developer's words and files go with it as a note, as the Start takes
 * them, files riding a note of no words; an empty box forks alone. The way back is read
 * off the plan's agents as listed, archived ones among them: each agent
 * started `from` a message names that message, so the source's tab says
 * under it which agents were forked there, in the order started, and no
 * read of the service's is owed to it.
 *
 * A continue is held the same way, naming no message: the draft its
 * Continue in new agent opens (`continue-agent.tsx`) starts from the
 * source on its whole transcript, its chip naming the source alone.
 */

import type { AgentPermissionMode } from "@repo/features/agent-approval-wire";
import type { AgentAttachment, AgentRunsOnRequest, AgentSummary } from "@repo/features/agent-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import { cardTitle } from "@repo/features/plain-words";
import type { ACT_KIND } from "@repo/host/acts";
import type { PortActPayload } from "@repo/host/contract";
import { choiceRequest } from "./agent-model.js";

/** The words the fork's action, chip, and trail are drawn with. */
export const FORK_WORDS = {
  ACTION: "Fork to new agent",
  OF: "Fork of",
  CONTINUE_OF: "Continue of",
  AT: "at",
  TO: "Forked to",
  DROP: "Drop the fork",
  DROP_CONTINUE: "Drop the continue",
  OPEN_SOURCE: "Open the message",
} as const;

/** How many words of the message the chip quotes, and at most how many characters. */
const OPENING = { WORDS: 8, CHARS: 60 } as const;

/** The ellipsis a quote cut short ends on. */
const ELLIPSIS = "…";

/**
 * One agent forked at one of its messages, with the message's opening
 * words, which the draft's chip quotes; or, naming no message,
 * continued on its whole transcript, when there is nothing to quote and
 * `opening` is empty.
 */
export interface AgentFork {
  readonly agentId: string;
  readonly messageId?: string;
  readonly opening: string;
}

/** A continue of `agentId` as a draft holds it: its whole transcript, no message named. */
export function continueFork(agentId: string): AgentFork {
  return { agentId, opening: "" };
}

/** What a forked or continued draft's working line says while its Start is out, in the order the service does it. */
const START_STAGE_WORDS = {
  COPYING_BEFORE: "Copying ",
  COPYING_AFTER: "'s work…",
  STARTING: "Starting the new agent…",
} as const;

/**
 * How long the copy of the source's work is said to take before the line
 * moves on to the new agent starting. Note that the service says nothing
 * while a Start is out, so the stage follows the time it typically spends
 * on the copy, which comes first, rather than a word of its own.
 */
const COPY_STAGE_MS = 3_000;

/** A Start as the draft's send asks it, the plan left for the caller to name. */
export type ForkStart = Omit<PortActPayload<typeof ACT_KIND.AGENTS_START>, "taskId">;

/**
 * A message's opening words as the fork's chip quotes them: its first line
 * read as plain words, at most a few of them, ending on an ellipsis where
 * the line was cut.
 */
export function messageOpening(words: string): string {
  const whole = cardTitle(words)
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");

  let quote = whole.split(" ").slice(0, OPENING.WORDS).join(" ");

  if (quote.length > OPENING.CHARS) quote = quote.slice(0, OPENING.CHARS).trimEnd();

  return quote.length < whole.length ? `${quote}${ELLIPSIS}` : quote;
}

/** The choice a fork of `source` starts on until the developer picks another: the source's own model and effort, and its window. */
export function forkChoice(source: AgentSummary): ModelChoice {
  return choiceRequest({
    model: source.model,
    effort: source.effort,
    ...(source.contextWindow === undefined ? undefined : { contextWindow: source.contextWindow }),
  });
}

/** Where a fork starts from: its source at its message, or on its whole transcript for a continue. */
function forkFrom({ agentId, messageId }: AgentFork): NonNullable<ForkStart["from"]> {
  return messageId === undefined ? { agentId } : { agentId, messageId };
}

/**
 * The Start a forked draft sends under its own key: from the source at its
 * message, a note where the box holds anything, its words and the files
 * with them, the servers the draft switched off, none among them as well,
 * the choice only where one was made, since a fork otherwise runs on
 * the source's, and the permission mode only where one was picked, since a
 * Start naming none starts on the member's Default permissions.
 */
export function forkStart(input: {
  readonly draftId: string;
  readonly fork: AgentFork;
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  /** Where the new agent runs, where one was picked; none for where its source runs. */
  readonly runsOn?: AgentRunsOnRequest | undefined;
  /** The mode the new agent starts in, where one was picked; none for the member's Default permissions. */
  readonly permissionMode?: AgentPermissionMode | undefined;
}): ForkStart {
  const note = input.words.trim();
  const { attachments, choice, disabledServers, runsOn, permissionMode } = input;

  return {
    idempotencyKey: input.draftId,
    from: forkFrom(input.fork),
    ...(note === "" && attachments.length === 0 ? undefined : { note }),
    ...(attachments.length === 0 ? undefined : { attachments }),
    // Note that the servers go even when none is off, because a Start naming none runs on the source's.
    disabledServers,
    ...(choice === undefined ? undefined : choiceRequest(choice)),
    ...(runsOn === undefined ? undefined : { runsOn }),
    ...(permissionMode === undefined ? undefined : { permissionMode }),
  };
}

/**
 * What a forked or continued draft's working line says `elapsedMs` after
 * its Start went: the copy of `source`'s work, named as its tab is, from
 * the first and while the time is not yet read, then the new agent
 * starting.
 */
export function startingWords(source: string, elapsedMs: number | undefined): string {
  return elapsedMs !== undefined && elapsedMs >= COPY_STAGE_MS
    ? START_STAGE_WORDS.STARTING
    : `${START_STAGE_WORDS.COPYING_BEFORE}${source}${START_STAGE_WORDS.COPYING_AFTER}`;
}

/**
 * Where each of `sourceId`'s messages was forked to: the ids of the agents
 * started from it at that message, by the message's id, in the order
 * started, archived ones among them. A continue names no message, so it is
 * no fork of any.
 */
export function forksOf(
  agents: readonly AgentSummary[],
  sourceId: string,
): ReadonlyMap<string, readonly string[]> {
  const forks = new Map<string, string[]>();
  const started = [...agents].sort((a, b) => a.createdAt - b.createdAt);

  for (const agent of started) {
    const messageId = agent.from?.agentId === sourceId ? agent.from.messageId : undefined;

    if (messageId === undefined) continue;
    const held = forks.get(messageId);

    if (held === undefined) forks.set(messageId, [agent.id]);
    else held.push(agent.id);
  }

  return forks;
}
