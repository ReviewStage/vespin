/**
 * voice-calls.ts -- the one row a voice call keeps while it stands: inserted as the call opens, claimed lease by lease, written as the call goes, and deleted as it closes.
 *
 * A member reads and ends only their own call: a read or a delete by another
 * member's id finds nothing. The lease is the service's, which reads no
 * account: a claim names the epoch its claimant read and takes the next one in
 * one compare-and-set, so of two claims on one epoch exactly one holds the
 * lease, and the loser reads the call's row it lost to. The holder writes the
 * told-through cursor under the epoch it claimed, so a holder whose lease
 * was taken writes nothing (`../schemas/voice-call.ts`). Any member who
 * reaches the agent reads which calls stand on it, the caller and when each
 * opened alone, so every window on the agent draws a call from its start.
 *
 * A call is how a member starts an agent by speaking: the box that starts
 * one starts it blank, handed nothing, and the call opens on it, so its
 * first words are the caller's. Where the call ends with nobody having said
 * a word to it, the agent is the caller's to let go, as a draft closed
 * unsent is: the call's end deletes it, and its task where that holds
 * nothing else, so a press of Talk and a hang-up leave nothing behind
 * (`endVoiceCall`).
 */

import { TASK_PRIORITY, TASK_STATUS, UNTITLED_TASK_NAME } from "@repo/features/task-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import { and, asc, eq, exists, isNull, not, or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { descriptionCommentThread } from "../schemas/description-comment.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { taskBlock } from "../schemas/task-block.js";
import { taskPageVersion } from "../schemas/task-page.js";
import { voiceCallTable } from "../schemas/voice-call.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "./columns.js";
import { deleteConversations } from "./conversation-delete.js";
import { agentVisibleTo } from "./workspace-store.js";

type VoiceCallEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One call as its row keeps it. */
const VoiceCallRowSchema = Schema.Struct({
  id: Schema.String,
  liveSessionId: Schema.String,
  callerId: Schema.String,
  agentId: Schema.String,
  voice: Schema.String,
  startedAt: InstantColumnSchema,
  leaseEpoch: Schema.Number,
  leaseUntil: InstantColumnSchema,
  toldSeq: Schema.NullOr(EpochMillisColumnSchema),
});

export type VoiceCallRow = typeof VoiceCallRowSchema.Type;

/** A call standing on an agent, as any member who reaches the agent reads it: its id, the member on it, and when it opened. */
const StandingVoiceCallSchema = Schema.Struct({
  id: Schema.String,
  callerId: Schema.String,
  startedAt: InstantColumnSchema,
});

export type StandingVoiceCall = typeof StandingVoiceCallSchema.Type;

/** A call as the route opens it, holding lease 1 until `leaseUntil`. */
export interface VoiceCallOpened {
  readonly liveSessionId: string;
  readonly callerId: string;
  readonly agentId: string;
  readonly voice: string;
  readonly startedAt: Date;
  readonly leaseUntil: Date;
}

const voiceCallColumns = {
  id: voiceCallTable.id,
  liveSessionId: voiceCallTable.liveSessionId,
  callerId: voiceCallTable.callerId,
  agentId: voiceCallTable.agentId,
  voice: voiceCallTable.voice,
  startedAt: voiceCallTable.startedAt,
  leaseEpoch: voiceCallTable.leaseEpoch,
  leaseUntil: voiceCallTable.leaseUntil,
  toldSeq: voiceCallTable.toldSeq,
};

const insertOne = SqlSchema.findOne({
  Request: Schema.Struct({
    liveSessionId: Schema.String,
    callerId: Schema.String,
    agentId: Schema.String,
    voice: Schema.String,
    startedAt: Schema.Date,
    leaseUntil: Schema.Date,
  }),
  Result: VoiceCallRowSchema,
  execute: (opened) =>
    Database.use((db) => db.insert(voiceCallTable).values(opened).returning(voiceCallColumns)),
});

const findOfCaller = SqlSchema.findOneOption({
  Request: Schema.Struct({ callerId: Schema.String, id: Schema.String }),
  Result: VoiceCallRowSchema,
  execute: ({ callerId, id }) =>
    Database.use((db) =>
      db
        .select(voiceCallColumns)
        .from(voiceCallTable)
        .where(and(eq(voiceCallTable.id, id), eq(voiceCallTable.callerId, callerId))),
    ),
});

const findStandingOnAgent = SqlSchema.findAll({
  Request: Schema.Struct({ readerId: Schema.String, agentId: Schema.String }),
  Result: StandingVoiceCallSchema,
  execute: ({ readerId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          id: voiceCallTable.id,
          callerId: voiceCallTable.callerId,
          startedAt: voiceCallTable.startedAt,
        })
        .from(voiceCallTable)
        .innerJoin(agentTable, eq(agentTable.id, voiceCallTable.agentId))
        .where(and(eq(voiceCallTable.agentId, agentId), agentVisibleTo(readerId)))
        .orderBy(asc(voiceCallTable.startedAt), asc(voiceCallTable.id)),
    ),
});

const claimOne = SqlSchema.findOneOption({
  Request: Schema.Struct({
    id: Schema.String,
    epoch: Schema.Number,
    leaseUntil: Schema.Date,
  }),
  Result: VoiceCallRowSchema,
  execute: ({ id, epoch, leaseUntil }) =>
    Database.use((db) =>
      db
        .update(voiceCallTable)
        .set({ leaseEpoch: sql`${voiceCallTable.leaseEpoch} + 1`, leaseUntil })
        // Taken only by a claimant that read the epoch still standing.
        .where(and(eq(voiceCallTable.id, id), eq(voiceCallTable.leaseEpoch, epoch)))
        .returning(voiceCallColumns),
    ),
});

const saveOne = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    epoch: Schema.Number,
    toldSeq: Schema.Number,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, epoch, toldSeq }) =>
    Database.use((db) =>
      db
        .update(voiceCallTable)
        .set({ toldSeq })
        // Only the holder of the epoch writes, so a lease taken over is never overwritten.
        .where(and(eq(voiceCallTable.id, id), eq(voiceCallTable.leaseEpoch, epoch)))
        .returning({ id: voiceCallTable.id }),
    ),
});

const deleteOfCaller = SqlSchema.findAll({
  Request: Schema.Struct({ callerId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ callerId, id }) =>
    Database.use((db) =>
      db
        .delete(voiceCallTable)
        .where(and(eq(voiceCallTable.id, id), eq(voiceCallTable.callerId, callerId)))
        .returning({ id: voiceCallTable.id }),
    ),
});

const endOfCaller = SqlSchema.findOneOption({
  Request: Schema.Struct({ callerId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ callerId, id }) =>
    Database.use((db) =>
      db
        .delete(voiceCallTable)
        .where(and(eq(voiceCallTable.id, id), eq(voiceCallTable.callerId, callerId)))
        .returning({ agentId: voiceCallTable.agentId }),
    ),
});

/**
 * The caller's own blank agent, handed neither the description, a prompt,
 * nor another agent's work, with its conversation locked, the lock every
 * write of its lines and turns takes; none for any other agent.
 */
const lockBlank = SqlSchema.findOneOption({
  Request: Schema.Struct({ callerId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String, taskId: Schema.String }),
  execute: ({ callerId, agentId }) =>
    Database.use((db) =>
      db
        .select({ conversationId: agentTable.conversationId, taskId: agentTable.taskId })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(
          and(
            eq(agentTable.id, agentId),
            eq(agentTable.userId, callerId),
            isNull(agentTable.prompt),
            isNull(agentTable.descriptionSnapshot),
            isNull(agentTable.startedFrom),
          ),
        )
        .for("update", { of: conversations }),
    ),
});

/** Whether anybody said a word to the agent: a turn, a member's line, or another call standing on it. */
const findSpokenTo = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ spoken: Schema.Boolean }),
  execute: ({ agentId, conversationId }) =>
    Database.use((db) =>
      db
        .select({
          spoken: sql<boolean>`${or(
            exists(
              db
                .select({ id: turns.id })
                .from(turns)
                .where(eq(turns.conversationId, conversationId)),
            ),
            exists(
              db
                .select({ id: messages.id })
                .from(messages)
                .where(
                  and(
                    eq(messages.conversationId, conversationId),
                    eq(messages.role, MESSAGE_ROLE.USER),
                  ),
                ),
            ),
            exists(
              db
                .select({ id: voiceCallTable.id })
                .from(voiceCallTable)
                .where(eq(voiceCallTable.agentId, agentId)),
            ),
          )}`,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId)),
    ),
});

/** The agent's conversation locked, as `endVoiceCall` takes it, so a call opening on the agent and its cleanup are one after the other; none for an agent gone. */
const lockAgentConversation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .innerJoin(agentTable, eq(agentTable.conversationId, conversations.id))
        .where(eq(agentTable.id, agentId))
        .for("update", { of: conversations }),
    ),
});

/** The caller's task row locked, as a Start locks it before it adds an agent, so the emptiness read after it sees every agent added before. */
const lockCallerTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ callerId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ callerId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.id, taskId), eq(task.userId, callerId)))
        .for("update"),
    ),
});

const deleteAgentById = SqlSchema.void({
  Request: Schema.String,
  execute: (agentId) =>
    Database.use((db) => db.delete(agentTable).where(eq(agentTable.id, agentId))),
});

/**
 * The caller's task deleted where it holds nothing a member or an agent put
 * there: still untitled, to do, unweighed, and unassigned or assigned to the
 * caller as their start assigns it, with no description, brief, or page, no
 * agent left on it, archived ones included, no comment, and no parent,
 * sub-task, or block either way. Nothing for any other.
 */
const deleteEmptyTask = SqlSchema.void({
  Request: Schema.Struct({ callerId: Schema.String, taskId: Schema.String }),
  execute: ({ callerId, taskId }) =>
    Database.use((db) => {
      const child = db.select({ id: task.id }).from(task).where(eq(task.parentTaskId, taskId));

      return db.delete(task).where(
        and(
          eq(task.id, taskId),
          eq(task.userId, callerId),
          eq(task.name, UNTITLED_TASK_NAME),
          eq(task.status, TASK_STATUS.TODO),
          eq(task.priority, TASK_PRIORITY.NONE),
          or(isNull(task.assigneeId), eq(task.assigneeId, callerId)),
          eq(task.description, ""),
          isNull(task.brief),
          isNull(task.parentTaskId),
          not(
            exists(
              db
                .select({ id: agentTable.id })
                .from(agentTable)
                .where(eq(agentTable.taskId, taskId)),
            ),
          ),
          not(exists(child)),
          not(
            exists(
              db
                .select({ id: descriptionCommentThread.id })
                .from(descriptionCommentThread)
                .where(eq(descriptionCommentThread.taskId, taskId)),
            ),
          ),
          not(
            exists(
              db
                .select({ id: taskPageVersion.id })
                .from(taskPageVersion)
                .where(eq(taskPageVersion.taskId, taskId)),
            ),
          ),
          not(
            exists(
              db
                .select({ id: taskBlock.blockerTaskId })
                .from(taskBlock)
                .where(
                  or(eq(taskBlock.blockerTaskId, taskId), eq(taskBlock.blockedTaskId, taskId)),
                ),
            ),
          ),
        ),
      );
    }),
});

/** The call's row, opened at lease epoch 1 and held until `leaseUntil`. */
export function insertVoiceCall(opened: VoiceCallOpened): VoiceCallEffect<VoiceCallRow> {
  // Note that the agent's conversation is locked first, as a call's end locks it to let a blank agent go, so the
  // call either stands before that end reads what was said, or finds the agent gone and fails.
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockAgentConversation(opened.agentId);

        // An insert returns its row, so a missing one is a defect.
        return yield* insertOne(opened).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
      }),
    ),
  );
}

/** The call's row where `callerId` is the member on it, none for any other member's. */
export function readVoiceCall(
  callerId: string,
  id: string,
): VoiceCallEffect<Option.Option<VoiceCallRow>> {
  return findOfCaller({ callerId, id });
}

/** The calls standing on the agent, oldest first, where `readerId` reaches it; none for an agent it does not. */
export function listStandingVoiceCalls(
  readerId: string,
  agentId: string,
): VoiceCallEffect<readonly StandingVoiceCall[]> {
  return findStandingOnAgent({ readerId, agentId });
}

/**
 * The call's row with its lease taken, held until `leaseUntil` under the epoch after `epoch`: none where
 * the call's epoch is no longer `epoch`, whose claimant lost, or where the call is gone.
 */
export function claimVoiceCallLease(
  id: string,
  epoch: number,
  leaseUntil: Date,
): VoiceCallEffect<Option.Option<VoiceCallRow>> {
  return claimOne({ id, epoch, leaseUntil });
}

/** The last conversation `seq` the voice was told saved, whether the call still stood at `epoch` to take it. */
export function saveVoiceCallState(
  id: string,
  epoch: number,
  state: { readonly toldSeq: number },
): VoiceCallEffect<boolean> {
  return Effect.map(saveOne({ id, epoch, ...state }), (rows) => rows.length > 0);
}

/** The call's row deleted, whether `callerId` was the member on it. */
export function deleteVoiceCall(callerId: string, id: string): VoiceCallEffect<boolean> {
  return Effect.map(deleteOfCaller({ callerId, id }), (rows) => rows.length > 0);
}

/**
 * The call's row deleted, whether `callerId` was the member on it; and,
 * where it was, the agent the call was on deleted with its conversation
 * where it is the caller's own blank agent nobody said a word to, with its
 * task where that then holds nothing else, all in the one transaction.
 * Note that the agent's conversation is locked before what was said to it
 * is read, so a line typed as the call ends either landed first, and the
 * agent stands, or waits on the lock and finds no agent.
 */
export function endVoiceCall(callerId: string, id: string): VoiceCallEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const ended = yield* endOfCaller({ callerId, id });

        if (Option.isNone(ended)) return false;
        const { agentId } = ended.value;
        const blank = yield* lockBlank({ callerId, agentId });

        if (Option.isNone(blank)) return true;
        const { conversationId, taskId } = blank.value;
        // Read after the lock, so a line written before it is seen.
        const [said] = yield* findSpokenTo({ agentId, conversationId });

        if (said?.spoken !== false) return true;
        yield* deleteAgentById(agentId);
        yield* deleteConversations([conversationId]);
        // Note that the task is locked apart from its delete, so the delete's read sees an agent a Start added meanwhile.
        const locked = yield* lockCallerTask({ callerId, taskId });

        if (Option.isSome(locked)) yield* deleteEmptyTask({ callerId, taskId });

        return true;
      }),
    ),
  );
}
