/**
 * agent-sandboxes.ts -- when each cloud agent's sandbox was last used, written as it is opened and touched.
 *
 * An open writes the sandbox's row LIVE, for the agent it was opened for,
 * and a touch moves its `used_at` on; each writes only where the row was
 * last written before the cutoff its caller hands it, so a sandbox touched
 * by many callers at once costs one write a cutoff's span, in one statement
 * whichever instance runs it. An open of a sandbox recorded RELEASED writes
 * it LIVE again whatever its cutoff, and a touch of a sandbox no open
 * recorded writes nothing (`../schemas/agent-sandbox.ts`).
 */

import { and, eq, lt, ne, sql } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { AGENT_SANDBOX_STATE, agentSandboxTable } from "../schemas/agent-sandbox.js";

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
