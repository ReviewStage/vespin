/**
 * voice-calls.ts -- the one row a voice call keeps while it stands: inserted as the call opens, claimed lease by lease, written as the call goes, and deleted as it closes.
 *
 * A member reads and ends only their own call: a read or a delete by another
 * member's id finds nothing. The lease is the service's, which reads no
 * account: a claim names the epoch its claimant read and takes the next one in
 * one compare-and-set, so of two claims on one epoch exactly one holds the
 * lease, and the loser reads the call's row it lost to. The holder writes the
 * told-through cursor under the epoch it claimed, so a holder whose lease
 * was taken writes nothing (`../schemas/voice-call.ts`). A reconnect moves
 * the call to a new session in one compare-and-set from the session it read,
 * taking the next epoch with it, so every lease on the old session is stale;
 * and a call is deleted only by naming the session it stands on, so the
 * close of a session the call left ends nothing.
 */

import { and, eq, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { voiceCallTable } from "../schemas/voice-call.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "./columns.js";

type VoiceCallEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One call as its row keeps it. */
const VoiceCallRowSchema = Schema.Struct({
  id: Schema.String,
  liveSessionId: Schema.String,
  callerId: Schema.String,
  agentId: Schema.String,
  voice: Schema.String,
  startedAt: InstantColumnSchema,
  clockBaseMs: Schema.Number,
  leaseEpoch: Schema.Number,
  leaseUntil: InstantColumnSchema,
  toldSeq: Schema.NullOr(EpochMillisColumnSchema),
});

export type VoiceCallRow = typeof VoiceCallRowSchema.Type;

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
  clockBaseMs: voiceCallTable.clockBaseMs,
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

const moveOne = SqlSchema.findOneOption({
  Request: Schema.Struct({
    callerId: Schema.String,
    id: Schema.String,
    fromSessionId: Schema.String,
    liveSessionId: Schema.String,
    clockBaseMs: Schema.Number,
    leaseUntil: Schema.Date,
  }),
  Result: VoiceCallRowSchema,
  execute: ({ callerId, id, fromSessionId, liveSessionId, clockBaseMs, leaseUntil }) =>
    Database.use((db) =>
      db
        .update(voiceCallTable)
        .set({
          liveSessionId,
          clockBaseMs,
          leaseEpoch: sql`${voiceCallTable.leaseEpoch} + 1`,
          leaseUntil,
        })
        // Moved only by a reconnect that read the session still standing.
        .where(
          and(
            eq(voiceCallTable.id, id),
            eq(voiceCallTable.callerId, callerId),
            eq(voiceCallTable.liveSessionId, fromSessionId),
          ),
        )
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
  Request: Schema.Struct({
    callerId: Schema.String,
    id: Schema.String,
    liveSessionId: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ callerId, id, liveSessionId }) =>
    Database.use((db) =>
      db
        .delete(voiceCallTable)
        .where(
          and(
            eq(voiceCallTable.id, id),
            eq(voiceCallTable.callerId, callerId),
            eq(voiceCallTable.liveSessionId, liveSessionId),
          ),
        )
        .returning({ id: voiceCallTable.id }),
    ),
});

/** The call's row, opened at lease epoch 1 and held until `leaseUntil`. */
export function insertVoiceCall(opened: VoiceCallOpened): VoiceCallEffect<VoiceCallRow> {
  // An insert returns its row, so a missing one is a defect.
  return insertOne(opened).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
}

/** The call's row where `callerId` is the member on it, none for any other member's. */
export function readVoiceCall(
  callerId: string,
  id: string,
): VoiceCallEffect<Option.Option<VoiceCallRow>> {
  return findOfCaller({ callerId, id });
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

/**
 * The call moved by a reconnect from the session `fromSessionId` to a new
 * one whose timeline starts `clockBaseMs` into the call, under the next
 * epoch, held until `leaseUntil`: none where the call no longer stands on
 * `fromSessionId`, or is not `callerId`'s, or is gone.
 */
export function moveVoiceCall(
  callerId: string,
  id: string,
  fromSessionId: string,
  to: { readonly liveSessionId: string; readonly clockBaseMs: number; readonly leaseUntil: Date },
): VoiceCallEffect<Option.Option<VoiceCallRow>> {
  return moveOne({ callerId, id, fromSessionId, ...to });
}

/** The last conversation `seq` the voice was told saved, whether the call still stood at `epoch` to take it. */
export function saveVoiceCallState(
  id: string,
  epoch: number,
  state: { readonly toldSeq: number },
): VoiceCallEffect<boolean> {
  return Effect.map(saveOne({ id, epoch, ...state }), (rows) => rows.length > 0);
}

/** The call's row deleted, whether `callerId` was the member on it and it still stood on the session `liveSessionId`. */
export function deleteVoiceCall(
  callerId: string,
  id: string,
  liveSessionId: string,
): VoiceCallEffect<boolean> {
  return Effect.map(deleteOfCaller({ callerId, id, liveSessionId }), (rows) => rows.length > 0);
}
