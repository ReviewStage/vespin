/**
 * sandbox-terminal-lease.ts -- the renewal claim of the GitHub token at a coding agent's sandbox's firewall, which the terminal relay keeps.
 *
 * Two windows on one sandbox session mint one token between them: each
 * claims the renewal here before it mints, and only the one whose claim
 * landed renews. Nothing here reads a word of the account: a claim is a
 * conversation, a sandbox session, and an instant.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxTerminalLease } from "../schemas/sandbox-terminal-lease.js";

type LeaseEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const claimCredential = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    sandboxSessionId: Schema.String,
    now: Schema.Date,
    renewedBefore: Schema.Date,
  }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ conversationId, sandboxSessionId, now, renewedBefore }) =>
    Database.use((db) =>
      db
        .insert(sandboxTerminalLease)
        .values({ conversationId, credentialAt: now, credentialSession: sandboxSessionId })
        .onConflictDoUpdate({
          target: sandboxTerminalLease.conversationId,
          set: { credentialAt: now, credentialSession: sandboxSessionId },
          // Never renewed, renewed before the bound, or renewed on another session's firewall than this one.
          setWhere: sql`(${sandboxTerminalLease.credentialAt} is null or ${sandboxTerminalLease.credentialAt} < ${renewedBefore} or ${sandboxTerminalLease.credentialSession} is distinct from ${sandboxSessionId})`,
        })
        .returning({ conversationId: sandboxTerminalLease.conversationId }),
    ),
});

const findCredentialAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, sandboxSessionId: Schema.String }),
  Result: Schema.Struct({ credentialAt: Schema.Date }),
  execute: ({ conversationId, sandboxSessionId }) =>
    Database.use((db) =>
      db
        .select({ credentialAt: sandboxTerminalLease.credentialAt })
        .from(sandboxTerminalLease)
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
            eq(sandboxTerminalLease.credentialSession, sandboxSessionId),
            isNotNull(sandboxTerminalLease.credentialAt),
          ),
        ),
    ),
});

const unclaimCredential = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    sandboxSessionId: Schema.String,
    claimedAt: Schema.Date,
  }),
  execute: ({ conversationId, sandboxSessionId, claimedAt }) =>
    Database.use((db) =>
      db
        .update(sandboxTerminalLease)
        .set({ credentialAt: null })
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
            eq(sandboxTerminalLease.credentialAt, claimedAt),
            eq(sandboxTerminalLease.credentialSession, sandboxSessionId),
          ),
        ),
    ),
});

/**
 * Claims the renewal of the GitHub token at the running sandbox session's
 * firewall, answering whether this caller is to renew it now: once per
 * conversation when it was never renewed, last renewed before the instant given, or last
 * renewed on another session, which a resumed sandbox is, so two windows on
 * one session mint one token between them and a resumed one is never left
 * without.
 */
export function claimCredentialRenewal(
  conversationId: string,
  sandboxSessionId: string,
  now: Date,
  renewedBefore: Date,
): LeaseEffect<boolean> {
  return Effect.map(
    claimCredential({ conversationId, sandboxSessionId, now, renewedBefore }),
    (rows) => rows.length > 0,
  );
}

/** When the GitHub token was last claimed for renewal on the running sandbox session's firewall; none where it never was on this session, or a claim was given back. */
export function credentialRenewedAt(
  conversationId: string,
  sandboxSessionId: string,
): LeaseEffect<Option.Option<Date>> {
  return Effect.map(
    findCredentialAt({ conversationId, sandboxSessionId }),
    Option.map(({ credentialAt }) => credentialAt),
  );
}

/** Gives back a renewal this caller claimed on the session and at the instant given and could not finish, so the next check claims it again; a later claim, or another session's at the same instant, stands. */
export function releaseCredentialRenewal(
  conversationId: string,
  sandboxSessionId: string,
  claimedAt: Date,
): LeaseEffect<void> {
  return unclaimCredential({ conversationId, sandboxSessionId, claimedAt });
}
