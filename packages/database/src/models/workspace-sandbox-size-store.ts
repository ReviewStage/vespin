/**
 * workspace-sandbox-size-store.ts -- a workspace's sandbox size: read it, set the vCPUs its owners and admins chose, and set the most our admins let it have.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads or writes another's size; who may call
 * each, and whether a choice stands under the most, is the caller's to
 * check. A workspace with no row reads as `DEFAULT_WORKSPACE_SANDBOX_SIZE`,
 * and a write makes its row where none stands, with the other value at its
 * default. A write names a workspace that must stand: one that does not
 * writes nothing and answers none.
 */

import {
  DEFAULT_WORKSPACE_SANDBOX_SIZE,
  SANDBOX_VCPU_SIZES,
  type SandboxVcpus,
  type WorkspaceSandboxSize,
} from "@repo/features/sandbox-size";
import { eq, inArray, sql } from "drizzle-orm";
import type { QueryBuilder } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { organization } from "../schemas/auth.js";
import { workspaceSandboxSize as size } from "../schemas/workspace-sandbox-size.js";

type SizeEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const VcpusSchema = Schema.Literals(SANDBOX_VCPU_SIZES);

const SizeSchema = Schema.Struct({ vcpus: VcpusSchema, maxVcpus: VcpusSchema });

const SIZE_COLUMNS = { vcpus: size.vcpus, maxVcpus: size.maxVcpus };

const findSize = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: SizeSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db.select(SIZE_COLUMNS).from(size).where(eq(size.organizationId, organizationId)),
    ),
});

const findSizes = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({ organizationId: Schema.String, ...SizeSchema.fields }),
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select({ organizationId: size.organizationId, ...SIZE_COLUMNS })
        .from(size)
        .where(inArray(size.organizationId, [...organizationIds])),
    ),
});

const SizeWriteSchema = Schema.Struct({
  organizationId: Schema.String,
  vcpus: VcpusSchema,
  now: Schema.Date,
});

/**
 * The workspace's row as a write makes it where none stands, at the sizes
 * given, selected from the workspace's own row, so a workspace that does not
 * stand makes none.
 */
const madeRow =
  (organizationId: string, made: WorkspaceSandboxSize, now: Date) => (qb: QueryBuilder) =>
    qb
      .select({
        organizationId: organization.id,
        vcpus: sql<SandboxVcpus>`${made.vcpus}::int`.as("vcpus"),
        maxVcpus: sql<SandboxVcpus>`${made.maxVcpus}::int`.as("max_vcpus"),
        updatedAt: sql<Date>`${now.toISOString()}::timestamptz`.as("updated_at"),
      })
      .from(organization)
      .where(eq(organization.id, organizationId));

const upsertVcpus = SqlSchema.findOneOption({
  Request: SizeWriteSchema,
  Result: SizeSchema,
  execute: ({ organizationId, vcpus, now }) =>
    Database.use((db) =>
      db
        .insert(size)
        .select(madeRow(organizationId, { ...DEFAULT_WORKSPACE_SANDBOX_SIZE, vcpus }, now))
        .onConflictDoUpdate({ target: size.organizationId, set: { vcpus, updatedAt: now } })
        .returning(SIZE_COLUMNS),
    ),
});

const upsertMaxVcpus = SqlSchema.findOneOption({
  Request: SizeWriteSchema,
  Result: SizeSchema,
  execute: ({ organizationId, vcpus, now }) =>
    Database.use((db) =>
      db
        .insert(size)
        .select(
          madeRow(organizationId, { ...DEFAULT_WORKSPACE_SANDBOX_SIZE, maxVcpus: vcpus }, now),
        )
        .onConflictDoUpdate({
          target: size.organizationId,
          set: { maxVcpus: vcpus, updatedAt: now },
        })
        .returning(SIZE_COLUMNS),
    ),
});

/** The workspace's sandbox size as it is kept, the default where it has none. */
export function readWorkspaceSandboxSize(organizationId: string): SizeEffect<WorkspaceSandboxSize> {
  return Effect.map(
    findSize(organizationId),
    Option.getOrElse(() => DEFAULT_WORKSPACE_SANDBOX_SIZE),
  );
}

/** Each of the workspaces' sandbox sizes as they are kept, by workspace, the default for one that has none. */
export function workspaceSandboxSizesOf(
  organizationIds: readonly string[],
): SizeEffect<(organizationId: string) => WorkspaceSandboxSize> {
  if (organizationIds.length === 0) return Effect.succeed(() => DEFAULT_WORKSPACE_SANDBOX_SIZE);

  return Effect.map(findSizes([...new Set(organizationIds)]), (rows) => {
    const sizes = new Map(rows.map(({ organizationId, ...kept }) => [organizationId, kept]));

    return (organizationId) => sizes.get(organizationId) ?? DEFAULT_WORKSPACE_SANDBOX_SIZE;
  });
}

/** The vCPUs the workspace's owners and admins chose set; its size as it then stands, none where the workspace does not stand. */
export function setWorkspaceSandboxVcpus(
  organizationId: string,
  vcpus: SandboxVcpus,
  now: Date,
): SizeEffect<Option.Option<WorkspaceSandboxSize>> {
  return upsertVcpus({ organizationId, vcpus, now });
}

/** The most vCPUs the workspace may choose set; its size as it then stands, none where the workspace does not stand. */
export function setWorkspaceSandboxMaxVcpus(
  organizationId: string,
  maxVcpus: SandboxVcpus,
  now: Date,
): SizeEffect<Option.Option<WorkspaceSandboxSize>> {
  return upsertMaxVcpus({ organizationId, vcpus: maxVcpus, now });
}
