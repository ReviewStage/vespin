/**
 * held-push-store.ts -- alerts held back from a member's phones while they were at their desk: hold one, and take the holds of members who have since walked away.
 *
 * A hold names what it tells of, a thread or an agent's failed turn
 * (`../schemas/held-push.ts`), under the member it was for, and holding the
 * same thing again only stamps it held again, with the newer turn for an
 * agent. The sweep takes, a batch at a time, the holds of every member whose
 * last activity (`../schemas/presence.ts`) is no later than the instant it names,
 * deleting each as it takes it, so two sweeps never take one hold twice and a
 * hold taken is never left standing; what to send for each is the caller's.
 */

import { and, eq, gt, inArray, notExists } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { heldPush } from "../schemas/held-push.js";
import { memberPresence } from "../schemas/presence.js";

type HeldPushEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** A hold the sweep took: whose it was, and the thread, or the agent and its failed turn, it tells of. */
const TakenHoldSchema = Schema.Struct({
  userId: Schema.String,
  inboxItemId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
});

export type TakenHold = typeof TakenHoldSchema.Type;

const upsertThreadHold = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String, now: Schema.Date }),
  execute: ({ userId, itemId, now }) =>
    Database.use((db) =>
      db
        .insert(heldPush)
        .values({ userId, inboxItemId: itemId, heldAt: now })
        .onConflictDoUpdate({
          target: [heldPush.userId, heldPush.inboxItemId],
          set: { heldAt: now },
        }),
    ),
});

const upsertTurnHold = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    turnId: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ userId, agentId, turnId, now }) =>
    Database.use((db) =>
      db
        .insert(heldPush)
        .values({ userId, agentId, turnId, heldAt: now })
        .onConflictDoUpdate({
          target: [heldPush.userId, heldPush.agentId],
          set: { turnId, heldAt: now },
        }),
    ),
});

const deleteAbsentHolds = SqlSchema.findAll({
  Request: Schema.Struct({ activeSince: Schema.Date, limit: Schema.Number }),
  Result: TakenHoldSchema,
  execute: ({ activeSince, limit }) =>
    Database.use((db) =>
      db
        .delete(heldPush)
        .where(
          inArray(
            heldPush.id,
            queryBuilder
              .select({ id: heldPush.id })
              .from(heldPush)
              .where(
                notExists(
                  queryBuilder
                    .select({ one: memberPresence.userId })
                    .from(memberPresence)
                    .where(
                      and(
                        eq(memberPresence.userId, heldPush.userId),
                        gt(memberPresence.lastActiveAt, activeSince),
                      ),
                    ),
                ),
              )
              .limit(limit)
              .for("update", { skipLocked: true }),
          ),
        )
        .returning({
          userId: heldPush.userId,
          inboxItemId: heldPush.inboxItemId,
          agentId: heldPush.agentId,
          turnId: heldPush.turnId,
        }),
    ),
});

/** The member's push about the thread held, or stamped held again. */
export function holdThreadPush(userId: string, itemId: string): HeldPushEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => upsertThreadHold({ userId, itemId, now }));
}

/** The member's push about the agent's failed turn held, the newer turn replacing an older one held for the same agent. */
export function holdFailedTurnPush(
  userId: string,
  agentId: string,
  turnId: string,
): HeldPushEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    upsertTurnHold({ userId, agentId, turnId, now }),
  );
}

/** Up to `limit` holds of members last active at or before `activeSince`, or never, deleted as they are taken. */
export function takeAbsentHolds(
  activeSince: Date,
  limit: number,
): HeldPushEffect<readonly TakenHold[]> {
  return deleteAbsentHolds({ activeSince, limit });
}
