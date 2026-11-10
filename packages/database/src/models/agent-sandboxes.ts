/**
 * agent-sandboxes.ts -- when each cloud agent's sandbox was last used, written as it is opened and touched.
 *
 * An open writes the sandbox's row LIVE, for the agent it was opened for,
 * and a touch moves its `used_at` on; each writes only where the row was
 * last written before the cutoff its caller hands it, so a sandbox touched
 * by many callers at once costs one write a cutoff's span, in one statement
 * whichever instance runs it. An open of a sandbox recorded RELEASING or
 * RELEASED writes it LIVE again whatever its cutoff, and a touch of a sandbox
 * no open recorded writes nothing (`../schemas/agent-sandbox.ts`).
 *
 * A release reads and writes here too (`@repo/service`'s
 * `agents/session-sandboxes.ts`): the sweep reads the LIVE sandboxes last
 * used by a cutoff and those RELEASING, the oldest first, and marks each due
 * one RELEASING; its consumer reads the row again with its agent, the
 * agent's conversation, and its session, and settles it LIVE, where it was
 * used since, or RELEASED, once deleted, each only where the row still
 * stands RELEASING, so an open between them wins.
 */

import { and, asc, eq, lt, lte, ne, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import {
  AGENT_SANDBOX_STATE,
  type AgentSandboxState,
  agentSandboxTable,
} from "../schemas/agent-sandbox.js";
import { conversations } from "../schemas/storage.js";

type SandboxUseEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One use of a sandbox to record: its name, when it was used, and the cutoff a row written since is left at. */
export interface AgentSandboxUse {
  readonly sandboxName: string;
  readonly at: Date;
  readonly writtenBefore: Date;
}

const UseSchema = Schema.Struct({
  sandboxName: Schema.String,
  at: Schema.Date,
  writtenBefore: Schema.Date,
});

const upsertOpen = SqlSchema.void({
  Request: Schema.Struct({ ...UseSchema.fields, agentId: Schema.String }),
  execute: ({ sandboxName, agentId, at, writtenBefore }) =>
    Database.use((db) =>
      db
        .insert(agentSandboxTable)
        .values({ sandboxName, agentId, usedAt: at, state: AGENT_SANDBOX_STATE.LIVE })
        .onConflictDoUpdate({
          target: agentSandboxTable.sandboxName,
          set: { agentId, usedAt: at, state: AGENT_SANDBOX_STATE.LIVE },
          setWhere: sql`${lt(agentSandboxTable.usedAt, writtenBefore)} or ${ne(
            agentSandboxTable.state,
            AGENT_SANDBOX_STATE.LIVE,
          )}`,
        }),
    ),
});

const updateUse = SqlSchema.void({
  Request: UseSchema,
  execute: ({ sandboxName, at, writtenBefore }) =>
    Database.use((db) =>
      db
        .update(agentSandboxTable)
        .set({ usedAt: at })
        .where(
          and(
            eq(agentSandboxTable.sandboxName, sandboxName),
            lt(agentSandboxTable.usedAt, writtenBefore),
          ),
        ),
    ),
});

const StateSchema = Schema.Literals([
  AGENT_SANDBOX_STATE.LIVE,
  AGENT_SANDBOX_STATE.RELEASING,
  AGENT_SANDBOX_STATE.RELEASED,
]);

/** A sandbox a release names: its name, its agent, the agent's conversation and its session where one was recorded, when it was last used, and its state. */
const ReleaseRowSchema = Schema.Struct({
  sandboxName: Schema.String,
  agentId: Schema.String,
  conversationId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  usedAt: Schema.Date,
  state: StateSchema,
});

export type AgentSandboxRelease = typeof ReleaseRowSchema.Type;

const findReleasable = SqlSchema.findAll({
  Request: Schema.Struct({ usedBy: Schema.Date, limit: Schema.Int, releasing: Schema.Boolean }),
  Result: Schema.Struct({ sandboxName: Schema.String, state: StateSchema }),
  execute: ({ usedBy, limit, releasing }) =>
    Database.use((db) =>
      db
        .select({ sandboxName: agentSandboxTable.sandboxName, state: agentSandboxTable.state })
        .from(agentSandboxTable)
        .where(
          releasing
            ? eq(agentSandboxTable.state, AGENT_SANDBOX_STATE.RELEASING)
            : and(
                eq(agentSandboxTable.state, AGENT_SANDBOX_STATE.LIVE),
                lte(agentSandboxTable.usedAt, usedBy),
              ),
        )
        .orderBy(asc(agentSandboxTable.usedAt))
        .limit(limit),
    ),
});

const markReleasing = SqlSchema.findAll({
  Request: Schema.Struct({ sandboxName: Schema.String, usedBy: Schema.Date }),
  Result: Schema.Struct({ sandboxName: Schema.String }),
  execute: ({ sandboxName, usedBy }) =>
    Database.use((db) =>
      db
        .update(agentSandboxTable)
        .set({ state: AGENT_SANDBOX_STATE.RELEASING })
        .where(
          and(
            eq(agentSandboxTable.sandboxName, sandboxName),
            eq(agentSandboxTable.state, AGENT_SANDBOX_STATE.LIVE),
            lte(agentSandboxTable.usedAt, usedBy),
          ),
        )
        .returning({ sandboxName: agentSandboxTable.sandboxName }),
    ),
});

const findRelease = SqlSchema.findOneOption({
  Request: Schema.Struct({ sandboxName: Schema.String }),
  Result: ReleaseRowSchema,
  execute: ({ sandboxName }) =>
    Database.use((db) =>
      db
        .select({
          sandboxName: agentSandboxTable.sandboxName,
          agentId: agentSandboxTable.agentId,
          conversationId: agentTable.conversationId,
          sessionId: conversations.runtimeSessionId,
          usedAt: agentSandboxTable.usedAt,
          state: agentSandboxTable.state,
        })
        .from(agentSandboxTable)
        .innerJoin(agentTable, eq(agentTable.id, agentSandboxTable.agentId))
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(eq(agentSandboxTable.sandboxName, sandboxName)),
    ),
});

const settleReleasing = SqlSchema.void({
  Request: Schema.Struct({ sandboxName: Schema.String, state: StateSchema }),
  execute: ({ sandboxName, state }) =>
    Database.use((db) =>
      db
        .update(agentSandboxTable)
        .set({ state })
        .where(
          and(
            eq(agentSandboxTable.sandboxName, sandboxName),
            eq(agentSandboxTable.state, AGENT_SANDBOX_STATE.RELEASING),
          ),
        ),
    ),
});

/** The agent's sandbox recorded LIVE and used at `at`, where its row was written before the cutoff or stood RELEASED. */
export function recordAgentSandboxOpen(
  agentId: string,
  use: AgentSandboxUse,
): SandboxUseEffect<void> {
  return upsertOpen({ ...use, agentId });
}

/** The sandbox's row used at `at`, where an open recorded one and it was written before the cutoff. */
export function recordAgentSandboxUse(use: AgentSandboxUse): SandboxUseEffect<void> {
  return updateUse(use);
}

/**
 * The sandboxes a release sweep acts on, the oldest used first: at most
 * `limit` LIVE ones last used at or before `usedBy`, and beside them at most
 * `limit` RELEASING, whose release may have been lost on its way to the
 * queue. Note that the two are read apart, so releases that keep failing
 * never hold back the sandboxes newly due.
 */
export function releasableAgentSandboxes(
  usedBy: Date,
  limit: number,
): SandboxUseEffect<
  ReadonlyArray<{ readonly sandboxName: string; readonly state: AgentSandboxState }>
> {
  return Effect.map(
    Effect.all([
      findReleasable({ usedBy, limit, releasing: false }),
      findReleasable({ usedBy, limit, releasing: true }),
    ]),
    ([due, releasing]) => [...due, ...releasing],
  );
}

/** The sandbox marked RELEASING, where it stands LIVE and was last used at or before `usedBy`; answers whether this write marked it. */
export function markAgentSandboxReleasing(
  sandboxName: string,
  usedBy: Date,
): SandboxUseEffect<boolean> {
  return Effect.map(markReleasing({ sandboxName, usedBy }), (rows) => rows.length > 0);
}

/** The sandbox's row as a release reads it again, with its agent, the agent's conversation, and its session; none where the row or its agent is gone. */
export function agentSandboxRelease(
  sandboxName: string,
): SandboxUseEffect<Option.Option<AgentSandboxRelease>> {
  return findRelease({ sandboxName });
}

/** A release settled: the row written LIVE, where it was skipped, or RELEASED, once deleted, only where it still stands RELEASING. */
export function settleAgentSandboxRelease(
  sandboxName: string,
  state: typeof AGENT_SANDBOX_STATE.LIVE | typeof AGENT_SANDBOX_STATE.RELEASED,
): SandboxUseEffect<void> {
  return settleReleasing({ sandboxName, state });
}
