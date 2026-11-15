/**
 * workspace-sandbox-size-store.ts -- a workspace's sandbox size: read it, one workspace's or several at once, and set the vCPUs its owners and admins chose.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads or writes another's size; who may call
 * each is the caller's to check. A workspace with no row reads as
 * `SANDBOX_SIZE.VCPUS`.
 */

import { SANDBOX_SIZE, SANDBOX_VCPU_SIZES, type SandboxVcpus } from "@repo/features/sandbox-size";
import { eq, inArray } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { workspaceSandboxSize as size } from "../schemas/workspace-sandbox-size.js";

type SizeEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const VcpusSchema = Schema.Literals(SANDBOX_VCPU_SIZES);

const findVcpus = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ vcpus: VcpusSchema }),
  execute: (organizationId) =>
    Database.use((db) =>
      db.select({ vcpus: size.vcpus }).from(size).where(eq(size.organizationId, organizationId)),
    ),
});

const findAllVcpus = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({ organizationId: Schema.String, vcpus: VcpusSchema }),
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select({ organizationId: size.organizationId, vcpus: size.vcpus })
        .from(size)
        .where(inArray(size.organizationId, [...organizationIds])),
    ),
});

const upsertVcpus = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, vcpus: VcpusSchema, now: Schema.Date }),
  execute: ({ organizationId, vcpus, now }) =>
    Database.use((db) =>
      db
        .insert(size)
        .values({ organizationId, vcpus, updatedAt: now })
        .onConflictDoUpdate({ target: size.organizationId, set: { vcpus, updatedAt: now } }),
    ),
});

/** The vCPUs the workspace's agents' sandboxes open with, the default where it chose none. */
export function readWorkspaceSandboxVcpus(organizationId: string): SizeEffect<SandboxVcpus> {
  return Effect.map(
    findVcpus(organizationId),
    Option.match({ onNone: () => SANDBOX_SIZE.VCPUS, onSome: (row) => row.vcpus }),
  );
}

/** Each of the workspaces' vCPUs, by workspace, the default for one that chose none. */
export function workspaceSandboxVcpusOf(
  organizationIds: readonly string[],
): SizeEffect<(organizationId: string) => SandboxVcpus> {
  if (organizationIds.length === 0) return Effect.succeed(() => SANDBOX_SIZE.VCPUS);

  return Effect.map(findAllVcpus([...new Set(organizationIds)]), (rows) => {
    const chosen = new Map(rows.map((row) => [row.organizationId, row.vcpus]));

    return (organizationId) => chosen.get(organizationId) ?? SANDBOX_SIZE.VCPUS;
  });
}

/** The vCPUs the workspace's owners and admins chose, set. */
export function setWorkspaceSandboxVcpus(
  organizationId: string,
  vcpus: SandboxVcpus,
  now: Date,
): SizeEffect<void> {
  return upsertVcpus({ organizationId, vcpus, now });
}
