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
 * so it stamps the activity started where none stood and forgets the state
 * last sent, which the next push then carries whole. The service's own
 * records, a push sent, an activity ended, a token Apple said is gone, name
 * the phone by the id it listed it under. The one read across accounts is
 * the sweep's: the accounts with an activity standing, by id alone.
 */

import { pushEnvironmentSchema, pushNotifySchema } from "@repo/features/push-device-wire";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { liveActivity } from "../schemas/live-activity.js";
import { pushDevice } from "../schemas/push-device.js";
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

/** What a push records of the phone's activity: when it went, the state it carried, and, for a push-to-start, that an activity now stands. */
export interface LiveActivityPush {
  readonly sentState: string;
  readonly started: boolean;
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
          // An activity stands on the phone now; the next push carries its state whole.
          set: {
            activityToken: token,
            startedAt: sql`coalesce(${liveActivity.startedAt}, ${now})`,
            sentState: null,
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

const clearOwnStartToken = SqlSchema.void({
  Request: OwnRowSchema,
  execute: ({ userId, pushDeviceId }) =>
    Database.use((db) =>
      db.update(liveActivity).set({ startToken: null }).where(ownRow(userId, pushDeviceId)),
    ),
});

const updateOwnPushed = SqlSchema.void({
  Request: Schema.Struct({
    ...OwnRowSchema.fields,
    now: Schema.Date,
    sentState: Schema.String,
    started: Schema.Boolean,
  }),
  execute: ({ userId, pushDeviceId, now, sentState, started }) =>
    Database.use((db) =>
      db
        .update(liveActivity)
        .set({ sentAt: now, sentState, ...(started ? { startedAt: now } : undefined) })
        .where(ownRow(userId, pushDeviceId)),
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

const findStandingMembers = SqlSchema.findAll({
  Request: Schema.Int,
  Result: Schema.Struct({ userId: Schema.String }),
  execute: (limit) =>
    Database.use((db) =>
      db
        .selectDistinct({ userId: pushDevice.userId })
        .from(liveActivity)
        .innerJoin(pushDevice, eq(pushDevice.id, liveActivity.pushDeviceId))
        .where(isNotNull(liveActivity.startedAt))
        .orderBy(asc(pushDevice.userId))
        .limit(limit),
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

/** A push to the account's phone's activity recorded as sent now, with the state it carried; a push-to-start stamps the activity started. */
export function recordLiveActivityPushed(
  userId: string,
  pushDeviceId: string,
  push: LiveActivityPush,
): LiveActivityEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    updateOwnPushed({ userId, pushDeviceId, now, ...push }),
  );
}

/** The account's phone's activity ended, or its update token gone: the token, the stamp, and the state last sent forgotten. */
export function recordLiveActivityEnded(
  userId: string,
  pushDeviceId: string,
): LiveActivityEffect<void> {
  return clearOwnActivity({ userId, pushDeviceId });
}

/** A token of the account's phone Apple said is gone, forgotten: the push-to-start token alone, or the activity with its update token. */
export function forgetLiveActivityToken(
  userId: string,
  pushDeviceId: string,
  kind: LiveActivityTokenKind,
): LiveActivityEffect<void> {
  return kind === LIVE_ACTIVITY_TOKEN.START
    ? clearOwnStartToken({ userId, pushDeviceId })
    : clearOwnActivity({ userId, pushDeviceId });
}

/** The sweep's read: up to `limit` accounts with an activity standing on a phone, by id alone. */
export function listLiveActivityMembers(limit: number): LiveActivityEffect<readonly string[]> {
  return Effect.map(findStandingMembers(limit), (rows) => rows.map((row) => row.userId));
}
