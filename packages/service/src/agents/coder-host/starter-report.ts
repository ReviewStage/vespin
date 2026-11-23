/**
 * starter-report.ts -- a started agent's failed turn told to the agent that started it, as its turn settles.
 *
 * An agent another coding agent started (`agent.started_by_agent_id`)
 * messages its starter itself when it finishes or needs it; one whose turn
 * fails cannot, and would leave its starter waiting on a message that never
 * comes. So the store writer's settle of a coding agent's failed turn
 * (`@repo/database/models/writer`'s `SettledTurnListener`) hands the turn's
 * final words to the starter here, as a message from the agent
 * (`agent-message.ts`): under the agent's own name, opening on who sent it
 * and why its turn failed. A turn completed or stopped sends nothing, and
 * one that said nothing hands its failure alone. The words are cut to fit
 * one message.
 *
 * The line goes under the turn's own id as its key, so a settle heard again
 * sends nothing twice (`steerAgent`'s repeat); one the service could not
 * send is logged and not tried again, since the starter reads the agent
 * itself (`read_agent`). A starter archived or gone is told by no one.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgent, readAgentOfConversation } from "@repo/database/models/agent-store";
import { readMessageByClientId } from "@repo/database/models/message-reads";
import { type SettledAgentTurn, storeWriter } from "@repo/database/models/writer";
import { agentFailureWords } from "@repo/features/agent-failure-words";
import { AGENT_FAILURE, AGENT_MESSAGE_LEAD } from "@repo/features/agent-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import { causeKind } from "@repo/runtime/effect";
import type { Sandbox } from "@repo/sandbox";
import { TURN_STATUS } from "@repo/wire";
import type { StoredUIMessage } from "@repo/wire/ui-messages";
import { isTextUIPart } from "ai";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { SessionsForAccount } from "../../automations/automation-runs.js";
import { MESSAGE_CHANNEL, TURN_FAILURE } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { MAX_MESSAGE_WORDS_CHARS } from "./agent-message.js";
import { agentLineSender, steerAgent } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** The room the head takes of a message's words, which the final words leave free. */
const REPORT_HEAD_ROOM_CHARS = 500;

/** The most characters of the agent's final words the line carries; longer ones are cut. */
const REPORT_WORDS_CHARS = MAX_MESSAGE_WORDS_CHARS - REPORT_HEAD_ROOM_CHARS;

/** What the cut end of the final words says. */
const CUT_MARK = "… (cut to fit; read_agent reads the rest)";

/** What the line says of a turn that ended in words of its own. */
const NO_WORDS = "(it said nothing)";

/** A turn's final words, whole: the last text its journal holds; none where it said nothing. */
export function lastSaid(journal: StoredUIMessage): string | undefined {
  return journal.parts
    .flatMap((part) =>
      isTextUIPart(part) && part.text.trim().length > 0 ? [part.text.trim()] : [],
    )
    .at(-1);
}

/** The agent's final words: the last text its turn's journal holds, cut to fit; none where it said nothing. */
function finalWords(journal: StoredUIMessage): string | undefined {
  const last = lastSaid(journal);

  if (last === undefined) return undefined;

  return last.length > REPORT_WORDS_CHARS
    ? `${last.slice(0, REPORT_WORDS_CHARS - CUT_MARK.length)}${CUT_MARK}`
    : last;
}

/** How the failed turn ended, in the head's words. */
function ended(turn: SettledAgentTurn): string {
  // A turn its plan's usage limit stopped is said so, not as a failure word.
  if (turn.failure === TURN_FAILURE.PLAN_LIMIT) {
    return `was stopped: ${agentFailureWords(AGENT_FAILURE.PLAN_LIMIT, undefined)}`;
  }

  return `failed its turn${turn.failure === null ? "" : ` (${turn.failure})`}`;
}

/** The line the starter receives: who it is from and how its turn failed, and its final words. */
function reportLine(mention: string, turn: SettledAgentTurn, words: string | undefined): string {
  const head = `${AGENT_MESSAGE_LEAD} · ${mention}, an agent you started, ${ended(turn)}. Its final message:`;

  return [head, words ?? NO_WORDS].join("\n\n");
}

/**
 * The starter the agent reports to: the agent that started it, where it
 * stands unarchived; none otherwise.
 */
const starterOf = (agent: Agent) =>
  Effect.gen(function* () {
    if (agent.startedByAgentId === null) return Option.none<Agent>();
    const starter = yield* readAgent(agent.userId, agent.startedByAgentId);

    return Option.filter(starter, (found) => found.archivedAt === null);
  });

/**
 * Hands a failed turn's final message to the agent's starter, as the
 * header says, or nothing where the turn did not fail or the agent has
 * none to tell; a failure to
 * send is logged by its kind alone, never answered, so nothing of the agent
 * or its member rides the log line.
 */
export function reportToStarter(
  sessionsFor: SessionsForAccount,
  turn: SettledAgentTurn,
): Effect.Effect<void, never, DatabaseServices | HttpClient.HttpClient | GitHubApp | Sandbox> {
  return Effect.gen(function* () {
    if (turn.status !== TURN_STATUS.FAILED) return;
    const agent = yield* readAgentOfConversation(turn.userId, turn.conversationId);

    if (Option.isNone(agent)) return;
    const starter = yield* starterOf(agent.value);

    if (Option.isNone(starter)) return;

    const journal = yield* readMessageByClientId(
      turn.userId,
      turn.conversationId,
      CODER_TOOL_SET,
      turn.turnId,
    );

    const [newest] = journal.ok ? journal.value : [];
    const words = newest === undefined ? undefined : finalWords(newest.message);
    const step = yield* workspaceStepOf(turn.userId, agent.value.organizationId);

    const mention = writtenMention(
      { kind: MENTION_KIND.AGENT, agentId: agent.value.id },
      agentName(agent.value),
      step,
    );

    const agentSessions = yield* sessionsFor(turn.userId);
    yield* steerAgent(
      agentSessions,
      storeWriter({ tools: CODER_TOOL_SET }),
      turn.userId,
      starter.value,
      {
        text: reportLine(mention, turn, words),
        clientKey: turn.turnId,
        sender: agentLineSender(agent.value),
        metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
      },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("a started agent's final message was not handed to its starter", {
        failure: causeKind(cause),
      }),
    ),
  );
}
