/**
 * sandbox-owners.ts -- the workspace each sandbox we create is billed to, written before the sandbox is opened and read by its name.
 *
 * A record names the sandbox, its workspace, and the agent and member it
 * was opened for where there are any (`../schemas/sandbox-owner.ts`). The
 * first record of a name stands: one written again, as every launch of an
 * agent's sandbox and every fill of a drive writes it, changes nothing, so
 * the row keeps the instant the sandbox was first opened under its name.
 */

import { eq } from "drizzle-orm";
import { type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { sandboxOwnerTable } from "../schemas/sandbox-owner.js";
import type { AgentStoreEffect } from "./agent-store.js";

const OwnerSchema = Schema.Struct({
  sandboxName: Schema.String,
  organizationId: Schema.String,
  agentId: Schema.NullOr(Schema.String),
  userId: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
});

/** Whom a sandbox is billed to: its workspace, and the agent and member it was opened for, null where none. */
export type SandboxOwner = typeof OwnerSchema.Type;

const insertOwner = SqlSchema.void({
  Request: OwnerSchema,
  execute: (owner) =>
    Database.use((db) =>
      db
        .insert(sandboxOwnerTable)
        .values(owner)
        .onConflictDoNothing({ target: sandboxOwnerTable.sandboxName }),
    ),
});

const findOwner = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OwnerSchema,
  execute: (sandboxName) =>
    Database.use((db) =>
      db
        .select({
          sandboxName: sandboxOwnerTable.sandboxName,
          organizationId: sandboxOwnerTable.organizationId,
          agentId: sandboxOwnerTable.agentId,
          userId: sandboxOwnerTable.userId,
          createdAt: sandboxOwnerTable.createdAt,
        })
        .from(sandboxOwnerTable)
        .where(eq(sandboxOwnerTable.sandboxName, sandboxName)),
    ),
});

/** Records whom the sandbox is billed to, before it is opened; a name already recorded keeps its first record. */
export function recordSandboxOwner(owner: SandboxOwner): AgentStoreEffect<void> {
  return insertOwner(owner);
}

/** Whom the sandbox under the name is billed to; none where no record names it. */
export function sandboxOwner(sandboxName: string): AgentStoreEffect<Option.Option<SandboxOwner>> {
  return findOwner(sandboxName);
}
