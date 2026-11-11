/**
 * push-device-store.ts -- an account's phones that take pushes: register one, unregister one, read them, and delete a token Apple says is gone.
 *
 * Every function but the last is an effect over the ambient `SqlClient`,
 * keyed by the account, so no account reads or unregisters another's phone.
 * A register is idempotent: a token on its gateway is one row, so one the
 * account already holds only stamps `last_seen_at`, and one another account
 * holds moves to this account, since the phone is now signed in here
 * (`../schemas/push-device.ts`). The delete by token alone is the sender's,
 * for a token Apple has said will never take another push, whichever account
 * holds it, as are the records of what became of a push, a delivery or a
 * failure, by token alone. The phone's own "Notify me" and its standing are
 * read and set by the account that holds it alone.
 */

import {
  PUSH_FAILURE_REASON_MAX_CHARS,
  type PushDeviceStatusAnswer,
  type PushEnvironment,
  type PushNotify,
  pushEnvironmentSchema,
  pushNotifySchema,
} from "@repo/features/push-device-wire";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { liveActivity } from "../schemas/live-activity.js";
import { pushDevice } from "../schemas/push-device.js";
import { InstantColumnSchema } from "./columns.js";

type PushDeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** A token on the gateway it belongs to, which names one phone. */
export interface PushDeviceToken {
  readonly token: string;
  readonly environment: PushEnvironment;
}

/** What a phone registers: its token and gateway, and the app Apple issued the token to. */
export interface PushDeviceRegistration extends PushDeviceToken {
  readonly bundleId: string;
}

const TokenKeySchema = Schema.Struct({
  token: Schema.String,
  environment: pushEnvironmentSchema,
});

/** One phone as a push reads it: whose it is, where to address it, when it last registered, and when it takes an alert. */
const PushDeviceSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  token: Schema.String,
  environment: pushEnvironmentSchema,
  bundleId: Schema.String,
  createdAt: InstantColumnSchema,
  lastSeenAt: InstantColumnSchema,
  notify: pushNotifySchema,
});

/** What became of the phone's pushes, as its row keeps it. */
const PushDeviceStandingSchema = Schema.Struct({
  notify: pushNotifySchema,
  lastDeliveredAt: Schema.NullOr(InstantColumnSchema),
  failingSince: Schema.NullOr(InstantColumnSchema),
  failureReason: Schema.NullOr(Schema.String),
});

export type PushDevice = typeof PushDeviceSchema.Type;

const PUSH_DEVICE_COLUMNS = {
  id: pushDevice.id,
  userId: pushDevice.userId,
  token: pushDevice.token,
  environment: pushDevice.environment,
  bundleId: pushDevice.bundleId,
  createdAt: pushDevice.createdAt,
  lastSeenAt: pushDevice.lastSeenAt,
  notify: pushDevice.notify,
};

const upsertDevice = SqlSchema.void({
  Request: Schema.Struct({
    ...TokenKeySchema.fields,
    userId: Schema.String,
    bundleId: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ userId, token, environment, bundleId, now }) =>
    Database.use((db) =>
      db
        .insert(pushDevice)
        .values({ userId, token, environment, bundleId, createdAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [pushDevice.environment, pushDevice.token],
          // The phone is signed in to this account now, whichever held the token before.
          set: { userId, bundleId, lastSeenAt: now },
        }),
    ),
});

const deleteMovedLiveActivity = SqlSchema.void({
  Request: Schema.Struct({ ...TokenKeySchema.fields, userId: Schema.String }),
  execute: ({ userId, token, environment }) =>
    Database.use((db) =>
      db.delete(liveActivity).where(
        inArray(
          liveActivity.pushDeviceId,
          db
            .select({ id: pushDevice.id })
            .from(pushDevice)
            .where(
              and(
                eq(pushDevice.environment, environment),
                eq(pushDevice.token, token),
                ne(pushDevice.userId, userId),
              ),
            ),
        ),
      ),
    ),
});

const deleteOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({ ...TokenKeySchema.fields, userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, token, environment }) =>
    Database.use((db) =>
      db
        .delete(pushDevice)
        .where(
          and(
            eq(pushDevice.userId, userId),
            eq(pushDevice.environment, environment),
            eq(pushDevice.token, token),
          ),
        )
        .returning({ id: pushDevice.id }),
    ),
});

const deleteDeviceByToken = SqlSchema.findAll({
  Request: TokenKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ token, environment }) =>
    Database.use((db) =>
      db
        .delete(pushDevice)
        .where(and(eq(pushDevice.environment, environment), eq(pushDevice.token, token)))
        .returning({ id: pushDevice.id }),
    ),
});

const findDevices = SqlSchema.findAll({
  Request: Schema.String,
  Result: PushDeviceSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PUSH_DEVICE_COLUMNS)
        .from(pushDevice)
        .where(eq(pushDevice.userId, userId))
        .orderBy(desc(pushDevice.lastSeenAt), desc(pushDevice.id)),
    ),
});

const findOwnStanding = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...TokenKeySchema.fields, userId: Schema.String }),
  Result: PushDeviceStandingSchema,
  execute: ({ userId, token, environment }) =>
    Database.use((db) =>
      db
        .select({
          notify: pushDevice.notify,
          lastDeliveredAt: pushDevice.lastDeliveredAt,
          failingSince: pushDevice.failingSince,
          failureReason: pushDevice.failureReason,
        })
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

const updateOwnNotify = SqlSchema.findAll({
  Request: Schema.Struct({
    ...TokenKeySchema.fields,
    userId: Schema.String,
    notify: pushNotifySchema,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, token, environment, notify }) =>
    Database.use((db) =>
      db
        .update(pushDevice)
        .set({ notify })
        .where(
          and(
            eq(pushDevice.userId, userId),
            eq(pushDevice.environment, environment),
            eq(pushDevice.token, token),
          ),
        )
        .returning({ id: pushDevice.id }),
    ),
});

const updateDelivered = SqlSchema.void({
  Request: Schema.Struct({ ...TokenKeySchema.fields, now: Schema.Date }),
  execute: ({ token, environment, now }) =>
    Database.use((db) =>
      db
        .update(pushDevice)
        .set({ lastDeliveredAt: now, failingSince: null, failureReason: null })
        .where(and(eq(pushDevice.environment, environment), eq(pushDevice.token, token))),
    ),
});

const updateFailed = SqlSchema.void({
  Request: Schema.Struct({ ...TokenKeySchema.fields, now: Schema.Date, reason: Schema.String }),
  execute: ({ token, environment, now, reason }) =>
    Database.use((db) =>
      db
        .update(pushDevice)
        // A failing run keeps the instant it began through every later failure.
        .set({
          failingSince: sql`coalesce(${pushDevice.failingSince}, ${now})`,
          failureReason: reason,
        })
        .where(and(eq(pushDevice.environment, environment), eq(pushDevice.token, token))),
    ),
});

/**
 * The phone registered under the account, stamped as seen now; a token
 * another account held moves to this one, leaving behind the Live Activity
 * it kept for that account (`./live-activity-store.ts`).
 */
export function registerPushDevice(
  userId: string,
  registration: PushDeviceRegistration,
): PushDeviceEffect<void> {
  return Effect.gen(function* () {
    const { token, environment } = registration;
    yield* deleteMovedLiveActivity({ userId, token, environment });
    yield* upsertDevice({ userId, ...registration, now: yield* DateTime.nowAsDate });
  });
}

/** The account's phone unregistered, answering whether the account held it; another account's token is left standing. */
export function unregisterPushDevice(
  userId: string,
  key: PushDeviceToken,
): PushDeviceEffect<boolean> {
  return Effect.map(deleteOwnDevice({ userId, ...key }), (rows) => rows.length > 0);
}

/** The account's phones, the one that registered most recently first. */
export function listPushDevices(userId: string): PushDeviceEffect<readonly PushDevice[]> {
  return findDevices(userId);
}

/** A token Apple has said is gone, deleted whichever account holds it, answering whether a row stood. */
export function deletePushDeviceToken(key: PushDeviceToken): PushDeviceEffect<boolean> {
  return Effect.map(deleteDeviceByToken(key), (rows) => rows.length > 0);
}

/** The account's phone's standing, its "Notify me" and what became of its pushes; nothing where the account holds no such phone. */
export function readPushDeviceStatus(
  userId: string,
  key: PushDeviceToken,
): PushDeviceEffect<Option.Option<PushDeviceStatusAnswer>> {
  return Effect.map(
    findOwnStanding({ userId, ...key }),
    Option.map((row) => ({
      notify: row.notify,
      lastDeliveredAt: row.lastDeliveredAt?.getTime() ?? null,
      failingSince: row.failingSince?.getTime() ?? null,
      failureReason: row.failureReason,
    })),
  );
}

/** The account's phone's "Notify me" set, answering whether the account held it; another account's phone is left standing. */
export function setPushDeviceNotify(
  userId: string,
  key: PushDeviceToken,
  notify: PushNotify,
): PushDeviceEffect<boolean> {
  return Effect.map(updateOwnNotify({ userId, ...key, notify }), (rows) => rows.length > 0);
}

/** A push to the token reached Apple now, ending any failing run, whichever account holds it. */
export function recordPushDelivered(key: PushDeviceToken): PushDeviceEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => updateDelivered({ ...key, now }));
}

/** A push to the token failed now, for the reason given, whichever account holds it; a run already failing keeps when it began. */
export function recordPushFailed(key: PushDeviceToken, reason: string): PushDeviceEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    updateFailed({ ...key, now, reason: reason.slice(0, PUSH_FAILURE_REASON_MAX_CHARS) }),
  );
}
