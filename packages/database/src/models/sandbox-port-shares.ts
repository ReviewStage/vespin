/**
 * sandbox-port-shares.ts -- the ports coding agents' cloud sandboxes share by a public link, which the share writes and the scheduled sweep lists.
 *
 * A share is kept by the agent's session alone (`schemas/sandbox-port-share.ts`):
 * opening one writes its row, a share of another port replaces it, and a
 * close deletes it. Nothing here
 * reads a word of an account: a share is a session, a port, and an instant,
 * and the caller has already reached the agent the session is.
 */

import { asc, eq } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxPortShare } from "../schemas/sandbox-port-share.js";

type ShareEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One share as its row keeps it. */
const PortShareSchema = Schema.Struct({
  sessionId: Schema.String,
  port: Schema.Number,
  sharedAt: Schema.Date,
});

export type PortShare = typeof PortShareSchema.Type;

const upsertShare = SqlSchema.void({
  Request: PortShareSchema,
  execute: ({ sessionId, port, sharedAt }) =>
    Database.use((db) =>
      db
        .insert(sandboxPortShare)
        .values({ sessionId, port, sharedAt })
        .onConflictDoUpdate({ target: sandboxPortShare.sessionId, set: { port, sharedAt } }),
    ),
});

const deleteShare = SqlSchema.void({
  Request: Schema.Struct({ sessionId: Schema.String }),
  execute: ({ sessionId }) =>
    Database.use((db) =>
      db.delete(sandboxPortShare).where(eq(sandboxPortShare.sessionId, sessionId)),
    ),
});

const findShares = SqlSchema.findAll({
  Request: Schema.Void,
  Result: PortShareSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({
          sessionId: sandboxPortShare.sessionId,
          port: sandboxPortShare.port,
          sharedAt: sandboxPortShare.sharedAt,
        })
        .from(sandboxPortShare)
        .orderBy(asc(sandboxPortShare.sharedAt), asc(sandboxPortShare.sessionId)),
    ),
});

/** Keeps the session's share of the port, opened at the instant given, in place of any it kept before. */
export function recordPortShare(
  sessionId: string,
  port: number,
  sharedAt: Date,
): ShareEffect<void> {
  return upsertShare({ sessionId, port, sharedAt });
}

/** Forgets the session's share. */
export function forgetPortShare(sessionId: string): ShareEffect<void> {
  return deleteShare({ sessionId });
}

/** Every share kept, the longest standing first. */
export function listPortShares(): ShareEffect<readonly PortShare[]> {
  return findShares(undefined);
}
