/**
 * turn-message.ts -- a coding agent's turn message composed, on either harness: the spoken turn's words, the time, and the task where it changed.
 *
 * What a turn opens with after the history is the same whichever native
 * harness answers the agent's conversation: the pieces are
 * `turn-context.ts`'s, and this composes them once, so an agent reads the
 * same words on either harness. A harness's sessions hand it ahead of the
 * developer's line in the message
 * written to the runner (`runner-sessions.ts`), with what the conversation's
 * row has handed (`native_handed`, read and written here).
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readAccountTimeZone } from "@repo/database/models/account-time-zone";
import {
  type Agent,
  readNativeHanded,
  recordNativeHanded,
} from "@repo/database/models/agent-store";
import { readDescriptionCommentThreads } from "@repo/database/models/description-comments";
import { listRevisions } from "@repo/database/models/description-revisions";
import { WORKSPACE_MEMORIES } from "@repo/database/models/memory-store";
import { turnsBefore } from "@repo/database/models/message-reads";
import { pendingRunnerHanded } from "@repo/database/models/runner-line-store";
import { readTask } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { EXPERIMENT } from "@repo/settings";
import type { WireValue } from "@repo/wire";
import { Effect, Option, Result, Schema } from "effect";
import { managerMemories, matchWorkspaceMemories } from "../../accounts/workspace-memories.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { standingContext } from "../agent-runtime/standing-context.js";
import { recallSource } from "../memory-provenance.js";
import { recordMemoryRecalls } from "../memory-tools.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import type { SessionTurn } from "../sessions/agent-sessions.js";
import { postsThreads, standingOfAgent, TOOL_GATE } from "../tool-catalog/gates.js";
import { experimentOnIn, experimentOnSinceIn } from "../workspace-experiment-on.js";
import {
  handedAfterCompaction,
  memoriesWithLead,
  movedWords,
  resizedWords,
  savedByAnotherSince,
  TURN_ASK,
  TURN_REPLY,
  type TurnAsk,
  type TurnHanded,
  TurnHandedSchema,
  type TurnReply,
  taskKey,
  taskWithLead,
  timeWithLead,
  turnKindWords,
} from "./turn-context.js";

/** The turn opening: its kind, as its request named it, its store id, and the words of the line it opens on, where it carries any. */
export interface CoderTurn {
  readonly kind: SessionTurn | undefined;
  readonly turnId: string | undefined;
  /** Whether the line the turn opens on is the developer's words spoken on a call. */
  readonly spoken?: boolean;
  readonly words?: string;
}

/** A turn's own message, where there is one to hand, and what the session has handed once it is. */
export interface CoderTurnMessage {
  readonly text: string | undefined;
  readonly handed: TurnHanded;
}

/** The newest turns read to find the agent's previous one: the turn opening, where the relay queued it already, and the one before. */
const PREVIOUS_TURN_READ = 2;

const readHanded = Schema.decodeUnknownResult(TurnHandedSchema);
const writeHanded = Schema.encodeUnknownResult(TurnHandedSchema);

/**
 * When the agent's turn before the one opening started, or nothing for its
 * first turn: the newest of the conversation's turns but the one named,
 * which the relay may have queued already as this one opens.
 */
const previousTurnStart = (target: ConversationTarget, turnId: string | undefined) =>
  Effect.map(
    turnsBefore(target.userId, target.conversationId, PREVIOUS_TURN_READ, undefined),
    (page) => {
      const previous = page.turns.findLast((turn) => turn.id !== turnId);

      return previous === undefined
        ? undefined
        : (previous.startedAt ?? previous.queuedAt).getTime();
    },
  );

/**
 * The agent's task as the turn's message hands it (`turn-context.ts`), read
 * as the member whose turn this is, and what the session has handed of it
 * once this turn is (`taskKey`), or nothing for an agent whose task is
 * gone. The task is handed where a revision of the description
 * another writer made was saved after the agent's previous turn started,
 * so a save made while that turn ran, which none of its steps may have
 * read, is handed too; or where the rest of it is not what the session
 * last handed; never on a first turn, whose first message the description, or the
 * prompt beside it, already is. Where the agent's workspace has Task descriptions off, no
 * save of the description hands it, and it is handed without the description
 * (`standingContext`). Beside it, whether this is the agent's first turn,
 * and the words its memories are found by (`memoriesOf`): the task's name,
 * the line's words, the brief, and the description where it is handed. A read
 * that fails is logged and hands nothing. An agent on no task is handed no
 * task (`tasklessOf`).
 */
/**
 * The zone the developer's day is read in on this turn: the one its own
 * request named, else the one the account's device last named
 * (`account-time-zone.ts`), so a turn a thread's answer, a wakeup, or an
 * automation opens reads their day as a typed line does; none where neither
 * stands, which reads UTC. A read that fails is logged and reads none, so
 * the turn still opens.
 */
const developerZone = (admitted: AdmittedConversation) =>
  admitted.timeZone === undefined
    ? readAccountTimeZone(admitted.caller).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      )
    : Effect.succeed(admitted.timeZone);

const taskOf = (
  admitted: AdmittedConversation,
  agent: Agent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
) =>
  Effect.gen(function* () {
    if (agent.taskId === null) return yield* tasklessOf(admitted, turn);
    const taskId = agent.taskId;

    const descriptionsSince = yield* experimentOnSinceIn(
      agent.organizationId,
      EXPERIMENT.DESCRIPTIONS,
    );

    const descriptionsOn = Option.isSome(descriptionsSince);

    const [stored, comments, since] = yield* Effect.all(
      [
        readTask(admitted.caller, taskId),
        // Note that the description's threads are neither read nor handed where its workspace has Task descriptions off.
        descriptionsOn
          ? readDescriptionCommentThreads(admitted.caller, taskId)
          : Effect.succeedNone,
        previousTurnStart(admitted.target, turn.turnId),
      ],
      { concurrency: "unbounded" },
    );

    if (Option.isNone(stored)) return undefined;
    const opening = since === undefined;

    // Note that the line's words go ahead of the description, since a search matches only its first words, and the description only where it is handed.
    const words = [
      stored.value.task.name,
      turn.words ?? "",
      stored.value.brief ?? "",
      descriptionsOn ? stored.value.text : "",
    ].join("\n");

    const threads = Option.getOrElse(comments, () => []);
    const key = taskKey(stored.value, threads, descriptionsOn);

    const saved =
      descriptionsOn &&
      since !== undefined &&
      savedByAnotherSince(
        (yield* listRevisions(admitted.caller, taskId)).revisions,
        since,
        agent.id,
      );

    // Note that Descriptions gone off leaves the words handed as they were but the description, so it hands nothing again, and keeps the key Descriptions going back on is told apart by.
    const unchanged =
      key === handed.task || (!descriptionsOn && taskKey(stored.value, threads) === handed.task);

    if (!saved && (opening || unchanged)) {
      return { key: opening ? handed.task : key, text: undefined, opening, words };
    }

    const clock = { now, timeZone: admitted.timeZone };

    const text = taskWithLead(
      standingContext(
        stored.value,
        clock,
        threads,
        descriptionsOn,
        Option.getOrUndefined(descriptionsSince),
      ),
    );

    return { key, text, opening, words };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * What an agent on no task is handed in its task's place: nothing, and on
 * its first turn the line's words alone to find its memories by.
 */
const tasklessOf = (admitted: AdmittedConversation, turn: CoderTurn) =>
  Effect.map(previousTurnStart(admitted.target, turn.turnId), (since) => ({
    key: undefined,
    text: undefined,
    opening: since === undefined,
    words: turn.words ?? "",
  }));

/**
 * The memories of the agent's workspace that the words given find
 * (`matchWorkspaceMemories`), as the turn's message hands them, where its
 * workspace has Memory on; nothing where it is off or none match. They are
 * found as the member who started the agent, so only a workspace they are a
 * member of is searched, and each is logged as recalled by the agent and its
 * turn's line (`recordMemoryRecalls`), as a search's are. A Manager is
 * handed its own memories beside the workspace's (`managerMemories`). A
 * store that fails is logged and hands nothing, as `search_memory` carries
 * on without memory; a recall that cannot be logged hands the memories all
 * the same.
 */
const memoriesOf = (agent: Agent, words: string) =>
  Effect.gen(function* () {
    if (!(yield* experimentOnIn(agent.organizationId, EXPERIMENT.MEMORY))) return undefined;

    const found = yield* matchWorkspaceMemories(
      agent.userId,
      agent.organizationId,
      words,
      agent.kind === AGENT_KIND.MANAGER ? managerMemories(agent.id) : WORKSPACE_MEMORIES,
    );

    if (found.length === 0) return undefined;
    yield* recordMemoryRecalls(
      { workspaceId: agent.organizationId, userId: agent.userId },
      found.map((memory) => memory.id),
      yield* recallSource(agent),
    );

    return memoriesWithLead(found);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/** How the agent's reply reaches the developer, which its turn's kind words follow: a Manager's by `send_to_user`, and every other agent's by its last message. */
function turnReplyOf(agent: Agent): TurnReply {
  return agent.kind === AGENT_KIND.MANAGER ? TURN_REPLY.SEND_TO_USER : TURN_REPLY.LAST_MESSAGE;
}

/**
 * Where the agent's question for the developer goes on a typed turn after a
 * spoken one, the only turn whose words name it: a thread where it posts
 * them, its Manager where one started it, and its reply otherwise. Note that
 * its standing is read only for that turn, since every other turn's words
 * name none, and that a Manager's own words name `send_to_user` instead.
 */
const turnAskOf = (
  agent: Agent,
  turn: CoderTurn,
  handed: TurnHanded,
  reply: TurnReply,
): Effect.Effect<TurnAsk, never, DatabaseServices> => {
  if (turn.spoken === true || handed.spoken !== true || reply === TURN_REPLY.SEND_TO_USER) {
    return Effect.succeed(TURN_ASK.REPLY);
  }

  return Effect.map(standingOfAgent(Option.some(agent)), (standing) => {
    if (postsThreads(standing)) return TURN_ASK.THREAD;

    return standing.open.has(TOOL_GATE.UNMANAGED) ? TURN_ASK.REPLY : TURN_ASK.MANAGER;
  });
};

/**
 * The message the agent's turn opens with after the history, and what the
 * session has handed once it is: on a spoken turn, the words for a reply
 * read aloud, and after one, the line saying they no longer hold
 * (`turnKindWords`); once, a move to another place since its last turn
 * (`movedWords`) and the size its sandbox was stopped for (`resizedWords`); the developer's time on
 * every turn, in their zone (`developerZone`); the task where `taskOf` hands it; and on the agent's first
 * turn alone, the memories its task's name, brief, and description and the
 * line's words find (`memoriesOf`). Note that a later turn is handed none,
 * because the first turn's still stand in its history, a follow-up on the
 * same task would mostly find them again, and the agent searches itself as
 * it reaches an area they leave out. A read that fails is logged and leaves
 * its part out, so the turn still opens.
 */
export function coderTurnMessage(
  admitted: AdmittedConversation,
  agent: Agent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
): Effect.Effect<CoderTurnMessage, never, DatabaseServices> {
  return Effect.gen(function* () {
    const zoned = { ...admitted, timeZone: yield* developerZone(admitted) };
    const task = yield* taskOf(zoned, agent, turn, handed, now);
    const memories = task?.opening === true ? yield* memoriesOf(agent, task.words) : undefined;
    const clock = { now, timeZone: zoned.timeZone };
    const standing = task?.text ?? timeWithLead(standingContext(undefined, clock));

    const reply = turnReplyOf(agent);
    const ask = yield* turnAskOf(agent, turn, handed, reply);
    const kind = turnKindWords(handed, turn.spoken === true, reply, ask);
    const resized = handed.resized === undefined ? undefined : resizedWords(handed.resized);
    const moved = handed.moved === undefined ? undefined : movedWords(handed.moved);
    const taskHanded = task === undefined ? handed.task : task.key;

    const next: TurnHanded = {
      ...(taskHanded === undefined ? undefined : { task: taskHanded }),
      ...(turn.spoken === true ? { spoken: true } : undefined),
    };

    const parts = [kind, moved, resized, standing, memories].filter((part) => part !== undefined);

    return { text: parts.join("\n\n"), handed: next };
  });
}

/**
 * What a native harness's session has handed, as its conversation's row
 * keeps it (`readNativeHanded`); nothing yet where the row holds none or
 * holds what the schema refuses. A read that failed fails, for a caller a
 * lost read would mislead, as one deciding whether a move opens the
 * session afresh (`runner-sessions.ts`).
 */
export function heldNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<TurnHanded, StoreFailure, DatabaseServices> {
  return Effect.map(readNativeHanded(target), (kept) => {
    if (kept === null) return {};
    const read = readHanded(kept);

    return Result.isSuccess(read) ? read.success : {};
  });
}

/**
 * What a native harness's session has handed, as `heldNativeTurnHanded`
 * reads it, and nothing where a read failed, which is logged, since handing
 * the words again costs a repeat and never a turn.
 */
export function readNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<TurnHanded, never, DatabaseServices> {
  return heldNativeTurnHanded(target).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed((): TurnHanded => ({})),
  );
}

/**
 * What a native harness's session will have been handed once its runner
 * takes the agent's newest line still waiting for one (`pendingRunnerHanded`);
 * none where no such line carries it, or where it holds what the schema
 * refuses. The next line is composed against it, so a line queued behind
 * another hands only what that one does not. Note that a read that failed
 * fails, unlike the row's (`readNativeTurnHanded`), because a line composed
 * against the row instead, behind one that hands a change, could leave out
 * what undoes that change, and its take would record the row's state as
 * handed though the runner last read the waiting line's.
 */
export function readPendingTurnHanded(
  target: ConversationTarget,
  agentId: string,
): Effect.Effect<Option.Option<TurnHanded>, StoreFailure, DatabaseServices> {
  return pendingRunnerHanded(target.userId, agentId).pipe(
    Effect.map(
      Option.flatMap((kept) => {
        const read = readHanded(kept);

        return Result.isSuccess(read) ? Option.some(read.success) : Option.none();
      }),
    ),
  );
}

/** What a session has handed as its row keeps it (the JSON `native_handed` holds), for a line to carry until its runner takes it; none where the schema refuses it. */
export function handedValue(handed: TurnHanded): Option.Option<WireValue> {
  const written = writeHanded(handed);

  return Result.isSuccess(written) ? Option.some(written.success) : Option.none();
}

/**
 * What a native harness's session has handed, written on its conversation's
 * row for the next message to read; a write that fails fails, for a caller
 * that must not stand without it, as a move (`move.ts`). Nothing is written
 * for what the schema refuses.
 */
export function keptNativeTurnHanded(
  target: ConversationTarget,
  handed: TurnHanded,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  const written = writeHanded(handed);

  if (Result.isFailure(written)) return Effect.void;

  return recordNativeHanded(target, written.success);
}

/**
 * What a native harness's session has handed once a turn's message is,
 * written on its conversation's row for the next message to read. A write
 * that fails is logged, since the message stands, and the next hands the
 * words again.
 */
export function recordNativeTurnHanded(
  target: ConversationTarget,
  handed: TurnHanded,
): Effect.Effect<void, never, DatabaseServices> {
  return keptNativeTurnHanded(target, handed).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => undefined),
  );
}

/**
 * What a native harness's session has handed once its harness compacted its
 * history (`handedAfterCompaction`), so the next message hands the call's
 * words and the task again.
 */
export function compactNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(readNativeTurnHanded(target), (handed) =>
    recordNativeTurnHanded(target, handedAfterCompaction(handed)),
  );
}
