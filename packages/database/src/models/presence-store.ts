/**
 * presence-store.ts -- when a member last used a desktop or web client: stamped by each beat, read by a push deciding whether to hold.
 *
 * Both are effects over the ambient `SqlClient`, keyed by the account, so a
 * beat stamps the caller's own row alone and a read answers one account's
 * instant (`../schemas/presence.ts`). Whether that instant still makes the
 * member present is the reader's to judge against its window
 * (`@repo/features/presence-wire`'s `PRESENCE`).
 */

import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { memberPresence } from "../schemas/presence.js";
import { InstantColumnSchema } from "./columns.js";

type PresenceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const upsertPresence = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(memberPresence)
        .values({ userId, lastActiveAt: now })
        .onConflictDoUpdate({
          target: memberPresence.userId,
          // Note that a beat never moves the stamp back, because two instances' clocks may disagree.
          set: {
            lastActiveAt: sql`greatest(${memberPresence.lastActiveAt}, excluded.last_active_at)`,
          },
        }),
    ),
});

const findPresence = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ lastActiveAt: InstantColumnSchema }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ lastActiveAt: memberPresence.lastActiveAt })
        .from(memberPresence)
        .where(eq(memberPresence.userId, userId)),
    ),
});

/** The account stamped active now, as a client's beat says. */
export function stampPresence(userId: string): PresenceEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => upsertPresence({ userId, now }));
}

/** When the account was last active at a client; nothing where no client ever beat for it. */
export function readLastActive(userId: string): PresenceEffect<Option.Option<Date>> {
  return Effect.map(
    findPresence(userId),
    Option.map((row) => row.lastActiveAt),
  );
}
