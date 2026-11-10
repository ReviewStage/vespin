/**
 * live-activity-store.ts -- the Live Activity each of an account's phones shows for its running agents: the tokens the phone registered for it, and what the service last pushed it.
 *
 * Every function is keyed by the account, and reaches a phone's row only
 * through a `push_device` row that account holds (`../schemas/live-activity.ts`),
 * so no account reads, registers, or records another's activity, whichever
 * phone id it names. A token is registered for a phone the account already
 * holds, by its device token and gateway, and answers whether it held one;
 * the row is made by the first register and kept, each register setting its
 * own token. An update token registered stands for an activity on the phone,
 * so it stamps the activity started where none stood. The service's own
 * records, a start claimed, a push sent, an activity ended, a token Apple
 * said is gone, name the phone by the id it listed it under, and each is
 * held to what the service read of the row, so a refresh that overlaps
 * another never undoes what that one wrote since: a claim lands only where
 * the activity still stands as read, a record only on the activity it was
 * sent to, a clear only of the token it names. The one read across accounts
 * is the sweep's: the accounts with an activity standing, by id alone, the
 * longest unswept first and each row stamped as it is taken. What
 * the activity shows is read here too: the account's own agents, unarchived,
 * whose turn runs, the newest turn first.
 */

import { pushEnvironmentSchema, pushNotifySchema } from "@repo/features/push-device-wire";
import { TURN_STATUS } from "@repo/wire";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { liveActivity } from "../schemas/live-activity.js";
import { pushDevice } from "../schemas/push-device.js";
import { turns } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import type { PushDeviceToken } from "./push-device-store.js";

type LiveActivityEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** Which of a phone's two tokens a register or a gone token names. */
export const LIVE_ACTIVITY_TOKEN = {
  /** The push-to-start token ActivityKit hands the app for the activity's type. */
  START: "start",
  /** The update token of the activity standing on the phone. */
  ACTIVITY: "activity",
} as const;

export type LiveActivityTokenKind = (typeof LIVE_ACTIVITY_TOKEN)[keyof typeof LIVE_ACTIVITY_TOKEN];

/** One phone's activity as a push reads it: the phone, where to address it, and what stands of its activity. */
const LiveActivityPhoneSchema = Schema.Struct({
  pushDeviceId: Schema.String,
  token: Schema.String,
  environment: pushEnvironmentSchema,
  bundleId: Schema.String,
  notify: pushNotifySchema,
  startToken: Schema.NullOr(Schema.String),
  activityToken: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(InstantColumnSchema),
  sentAt: Schema.NullOr(InstantColumnSchema),
  sentState: Schema.NullOr(Schema.String),
});

export type LiveActivityPhone = typeof LiveActivityPhoneSchema.Type;

/** One of the account's agents whose turn runs: the agent, its conversation, the turn, and when the turn started. */
const RunningAgentTurnSchema = Schema.Struct({
  agentId: Schema.String,
  conversationId: Schema.String,
  turnId: Schema.String,
  startedAt: InstantColumnSchema,
});

export type RunningAgentTurn = typeof RunningAgentTurnSchema.Type;

/** What a push records of the phone's activity: when it went, the state it carried, and the start of the activity it went to, which must still stand. */
export interface LiveActivityPush {
  readonly sentAt: Date;
  readonly sentState: string;
  readonly startedAt: Date;
}

/** The activity a refresh read on the phone: its start and its update token, which a claim or a clear is held to. */
export interface LiveActivityRead {
  readonly startedAt: Date | null;
  readonly activityToken: string | null;
}

const OwnPhoneSchema = Schema.Struct({
  userId: Schema.String,
  token: Schema.String,
  environment: pushEnvironmentSchema,
});

const OwnRowSchema = Schema.Struct({ userId: Schema.String, pushDeviceId: Schema.String });

/** The phone ids the account holds, as a subquery a write of a row is held to. */
function ownPhones(userId: string) {
  return queryBuilder
    .select({ id: pushDevice.id })
    .from(pushDevice)
    .where(eq(pushDevice.userId, userId));
}

/** The account's own row of the phone, by the id it listed it under. */
function ownRow(userId: string, pushDeviceId: string) {
  return and(
    eq(liveActivity.pushDeviceId, pushDeviceId),
    inArray(liveActivity.pushDeviceId, ownPhones(userId)),
  );
}

/** The row's activity still as a refresh read it: the same start and the same update token, either of them none. */
function standsAsRead(read: LiveActivityRead) {
  return and(
    read.startedAt === null
      ? isNull(liveActivity.startedAt)
      : eq(liveActivity.startedAt, read.startedAt),
    read.activityToken === null
      ? isNull(liveActivity.activityToken)
      : eq(liveActivity.activityToken, read.activityToken),
  );
}

const LiveActivityReadSchema = Schema.Struct({
  startedAt: Schema.NullOr(Schema.Date),
  activityToken: Schema.NullOr(Schema.String),
});

const ClaimedRowSchema = Schema.Struct({ pushDeviceId: Schema.String });

const findOwnPhone = SqlSchema.findOneOption({
  Request: OwnPhoneSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, token, environment }) =>
    Database.use((db) =>
      db
        .select({ id: pushDevice.id })
        .from(pushDevice)
        .where(
          and(
            eq(pushDevice.userId, userId),
            eq(pushDevice.environment, environment),
            eq(pushDevice.token, token),
          ),
        ),
    ),
});

const upsertStartToken = SqlSchema.void({
  Request: Schema.Struct({ pushDeviceId: Schema.String, token: Schema.String }),
  execute: ({ pushDeviceId, token }) =>
    Database.use((db) =>
      db
        .insert(liveActivity)
        .values({ pushDeviceId, startToken: token })
        .onConflictDoUpdate({ target: liveActivity.pushDeviceId, set: { startToken: token } }),
    ),
});

const upsertActivityToken = SqlSchema.void({
  Request: Schema.Struct({ pushDeviceId: Schema.String, token: Schema.String, now: Schema.Date }),
  execute: ({ pushDeviceId, token, now }) =>
    Database.use((db) =>
      db
        .insert(liveActivity)
        .values({ pushDeviceId, activityToken: token, startedAt: now })
        .onConflictDoUpdate({
          target: liveActivity.pushDeviceId,
          // An activity stands on the phone now, showing what the start that made it carried.
          set: {
            activityToken: token,
            startedAt: sql`coalesce(${liveActivity.startedAt}, ${now})`,
          },
        }),
    ),
});

const clearOwnActivity = SqlSchema.void({
  Request: OwnRowSchema,
  execute: ({ userId, pushDeviceId }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ activityToken: null, startedAt: null, sentState: null })
        .where(ownRow(userId, pushDeviceId)),
    ),
});

const clearOwnActivityAsRead = SqlSchema.findAll({
  Request: Schema.Struct({ ...OwnRowSchema.fields, read: LiveActivityReadSchema }),
  Result: ClaimedRowSchema,
  execute: ({ userId, pushDeviceId, read }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ activityToken: null, startedAt: null, sentState: null })
        .where(and(ownRow(userId, pushDeviceId), standsAsRead(read)))
        .returning({ pushDeviceId: liveActivity.pushDeviceId }),
    ),
});

const clearOwnActivityToken = SqlSchema.void({
  Request: Schema.Struct({ ...OwnRowSchema.fields, token: Schema.String }),
  execute: ({ userId, pushDeviceId, token }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ activityToken: null, startedAt: null, sentState: null })
        .where(and(ownRow(userId, pushDeviceId), eq(liveActivity.activityToken, token))),
    ),
});

const clearOwnStartToken = SqlSchema.void({
  Request: Schema.Struct({ ...OwnRowSchema.fields, token: Schema.String }),
  execute: ({ userId, pushDeviceId, token }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ startToken: null })
        .where(and(ownRow(userId, pushDeviceId), eq(liveActivity.startToken, token))),
    ),
});

const claimOwnStart = SqlSchema.findAll({
  Request: Schema.Struct({
    ...OwnRowSchema.fields,
    startToken: Schema.String,
    read: LiveActivityReadSchema,
    now: Schema.Date,
  }),
  Result: ClaimedRowSchema,
  execute: ({ userId, pushDeviceId, startToken, read, now }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ startedAt: now, activityToken: null, sentState: null })
        .where(
          and(
            ownRow(userId, pushDeviceId),
            eq(liveActivity.startToken, startToken),
            standsAsRead(read),
          ),
        )
        .returning({ pushDeviceId: liveActivity.pushDeviceId }),
    ),
});

const releaseOwnStart = SqlSchema.void({
  Request: Schema.Struct({ ...OwnRowSchema.fields, claimedAt: Schema.Date }),
  execute: ({ userId, pushDeviceId, claimedAt }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ startedAt: null })
        .where(
          and(
            ownRow(userId, pushDeviceId),
            eq(liveActivity.startedAt, claimedAt),
            isNull(liveActivity.activityToken),
          ),
        ),
    ),
});

const updateOwnPushed = SqlSchema.void({
  Request: Schema.Struct({
    ...OwnRowSchema.fields,
    sentAt: Schema.Date,
    sentState: Schema.String,
    startedAt: Schema.Date,
  }),
  execute: ({ userId, pushDeviceId, sentAt, sentState, startedAt }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ sentAt, sentState })
        .where(and(ownRow(userId, pushDeviceId), eq(liveActivity.startedAt, startedAt))),
    ),
});

const findOwnActivities = SqlSchema.findAll({
  Request: Schema.String,
  Result: LiveActivityPhoneSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          pushDeviceId: liveActivity.pushDeviceId,
          token: pushDevice.token,
          environment: pushDevice.environment,
          bundleId: pushDevice.bundleId,
          notify: pushDevice.notify,
          startToken: liveActivity.startToken,
          activityToken: liveActivity.activityToken,
          startedAt: liveActivity.startedAt,
          sentAt: liveActivity.sentAt,
          sentState: liveActivity.sentState,
        })
        .from(liveActivity)
        .innerJoin(pushDevice, eq(pushDevice.id, liveActivity.pushDeviceId))
        .where(eq(pushDevice.userId, userId))
        .orderBy(asc(liveActivity.pushDeviceId)),
    ),
});

const takeStandingMembers = SqlSchema.findAll({
  Request: Schema.Struct({ limit: Schema.Int, now: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ limit, now }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ sweptAt: now })
        .from(pushDevice)
        .where(
          and(
            eq(pushDevice.id, liveActivity.pushDeviceId),
            inArray(
              liveActivity.pushDeviceId,
              queryBuilder
                .select({ id: liveActivity.pushDeviceId })
                .from(liveActivity)
                .where(isNotNull(liveActivity.startedAt))
                .orderBy(
                  sql`${liveActivity.sweptAt} asc nulls first`,
                  asc(liveActivity.pushDeviceId),
                )
                .limit(limit)
                .for("update", { skipLocked: true }),
            ),
          ),
        )
        .returning({ userId: pushDevice.userId }),
    ),
});

const findRunningAgentTurns = SqlSchema.findAll({
  Request: Schema.String,
  Result: RunningAgentTurnSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          agentId: agentTable.id,
          conversationId: agentTable.conversationId,
          turnId: turns.id,
          startedAt: sql<Date>`coalesce(${turns.startedAt}, ${turns.queuedAt})`.mapWith(
            turns.queuedAt,
          ),
        })
        .from(turns)
        .innerJoin(agentTable, eq(agentTable.conversationId, turns.conversationId))
        .where(
          and(
            eq(agentTable.userId, userId),
            eq(turns.userId, userId),
            eq(turns.status, TURN_STATUS.RUNNING),
            isNull(agentTable.archivedAt),
          ),
        )
        .orderBy(desc(turns.startedAt), desc(turns.id)),
    ),
});

/**
 * A token ActivityKit handed the phone, registered for the account's phone
 * named by its device token and gateway, answering whether the account
 * holds that phone; nothing is written for one it does not hold.
 */
export function registerLiveActivityToken(
  userId: string,
  phone: PushDeviceToken,
  kind: LiveActivityTokenKind,
  token: string,
): LiveActivityEffect<boolean> {
  return Effect.gen(function* () {
    const own = yield* findOwnPhone({ userId, ...phone });
    if (Option.isNone(own)) return false;
    const pushDeviceId = own.value.id;
    if (kind === LIVE_ACTIVITY_TOKEN.START) {
      yield* upsertStartToken({ pushDeviceId, token });
    } else {
      yield* upsertActivityToken({ pushDeviceId, token, now: yield* DateTime.nowAsDate });
    }
    return true;
  });
}

/** The account's phone's activity ended on the phone, its update token forgotten; a phone the account does not hold is passed over. */
export function endLiveActivityOnPhone(
  userId: string,
  phone: PushDeviceToken,
): LiveActivityEffect<void> {
  return Effect.gen(function* () {
    const own = yield* findOwnPhone({ userId, ...phone });
    if (Option.isNone(own)) return;
    yield* clearOwnActivity({ userId, pushDeviceId: own.value.id });
  });
}

/** The account's phones that registered a token for their activity, with what stands of it. */
export function listLiveActivityPhones(
  userId: string,
): LiveActivityEffect<readonly LiveActivityPhone[]> {
  return findOwnActivities(userId);
}

/**
 * The account's phone's push-to-start claimed at `now`, answering whether
 * this caller won it: only where the phone still holds `startToken` and its
 * activity stands as `read`, so of two refreshes that read the same row one
 * claims it and sends, and the other sends nothing. The claim stamps the
 * activity started and forgets any update token an aged one held.
 */
export function claimLiveActivityStart(
  userId: string,
  pushDeviceId: string,
  claim: { readonly startToken: string; readonly read: LiveActivityRead; readonly now: Date },
): LiveActivityEffect<boolean> {
  return Effect.map(claimOwnStart({ userId, pushDeviceId, ...claim }), (rows) => rows.length > 0);
}

/** A claimed push-to-start that will not be tried again let go, where the claim still stands and no update token came of it. */
export function releaseLiveActivityStart(
  userId: string,
  pushDeviceId: string,
  claimedAt: Date,
): LiveActivityEffect<void> {
  return releaseOwnStart({ userId, pushDeviceId, claimedAt });
}

/** A push to the account's phone's activity recorded as sent, with the state it carried, where the activity it went to still stands. */
export function recordLiveActivityPushed(
  userId: string,
  pushDeviceId: string,
  push: LiveActivityPush,
): LiveActivityEffect<void> {
  return updateOwnPushed({ userId, pushDeviceId, ...push });
}

/** The account's phone's activity ended: the token, the stamp, and the state last sent forgotten, where it still stands as `read`; answers whether it did. */
export function recordLiveActivityEnded(
  userId: string,
  pushDeviceId: string,
  read: LiveActivityRead,
): LiveActivityEffect<boolean> {
  return Effect.map(
    clearOwnActivityAsRead({ userId, pushDeviceId, read }),
    (rows) => rows.length > 0,
  );
}

/** A token of the account's phone Apple said is gone, forgotten where the phone still holds it: the push-to-start token alone, or the activity with its update token. */
export function forgetLiveActivityToken(
  userId: string,
  pushDeviceId: string,
  kind: LiveActivityTokenKind,
  token: string,
): LiveActivityEffect<void> {
  return kind === LIVE_ACTIVITY_TOKEN.START
    ? clearOwnStartToken({ userId, pushDeviceId, token })
    : clearOwnActivityToken({ userId, pushDeviceId, token });
}

/** The account's own unarchived agents whose turn runs, the newest turn first: what the activity shows. */
export function listRunningAgentTurns(
  userId: string,
): LiveActivityEffect<readonly RunningAgentTurn[]> {
  return findRunningAgentTurns(userId);
}

/**
 * The sweep's read: the accounts of up to `limit` phones with an activity
 * standing, by id alone, the phones the sweep took longest ago first, each
 * stamped taken now so the next sweep comes round to the rest; a phone
 * another sweep is taking meanwhile is passed over.
 */
export function listLiveActivityMembers(limit: number): LiveActivityEffect<readonly string[]> {
  return Effect.gen(function* () {
    const rows = yield* takeStandingMembers({ limit, now: yield* DateTime.nowAsDate });
    return [...new Set(rows.map((row) => row.userId))];
  });
}
