/**
 * account-time-zone.ts -- the IANA time zone a member's own device last named: written as a client says it, read as an agent's turn opens.
 *
 * Both are effects over the ambient `SqlClient`, keyed by the account, so a
 * write moves the caller's own row alone and a read answers one account's
 * zone (`../schemas/auth.ts`'s `user.time_zone`). A write that names the
 * zone already kept changes nothing, so a client may name it at every launch.
 * Whether the zone still stands is the reader's to judge: the column keeps
 * what the device named.
 */

import { and, eq, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { user } from "../schemas/auth.js";

type TimeZoneEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const updateTimeZone = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, timeZone: Schema.String }),
  execute: ({ userId, timeZone }) =>
    Database.use((db) =>
      db
        .update(user)
        .set({ timeZone })
        // Note that a zone already kept is not written again, because every launch names it and the write would move the account's `updated_at`.
        .where(and(eq(user.id, userId), sql`${user.timeZone} is distinct from ${timeZone}`)),
    ),
});

const findTimeZone = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ timeZone: Schema.NullOr(Schema.String) }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ timeZone: user.timeZone }).from(user).where(eq(user.id, userId)),
    ),
});

/** The account's zone kept as its device named it. */
export function writeAccountTimeZone(userId: string, timeZone: string): TimeZoneEffect<void> {
  return updateTimeZone({ userId, timeZone });
}

/** The zone the account's device last named; nothing where none ever has, or no such account stands. */
export function readAccountTimeZone(userId: string): TimeZoneEffect<Option.Option<string>> {
  return Effect.map(
    findTimeZone(userId),
    Option.flatMap((row) => Option.fromNullishOr(row.timeZone)),
  );
}
