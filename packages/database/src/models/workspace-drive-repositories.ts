/**
 * workspace-drive-repositories.ts -- the repositories each workspace's drive holds, read and written by workspace.
 *
 * A name is lower-cased on its way in, as the drive's folder is named, so a
 * read, a record, and a forget agree however GitHub or a caller spelled it.
 * Recording a repository already held moves its instant to the new fill's.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { workspaceDriveRepository } from "../schemas/workspace-drive-repository.js";
import type { AgentStoreEffect } from "./agent-store.js";

const RepositoriesRequestSchema = Schema.Struct({
  organizationId: Schema.String,
  repositories: Schema.Array(Schema.String),
});

const findRepositories = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ repository: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ repository: workspaceDriveRepository.repository })
        .from(workspaceDriveRepository)
        .where(eq(workspaceDriveRepository.organizationId, organizationId))
        .orderBy(asc(workspaceDriveRepository.repository)),
    ),
});

const upsertRepositories = SqlSchema.void({
  Request: Schema.Struct({ ...RepositoriesRequestSchema.fields, at: Schema.Date }),
  execute: ({ organizationId, repositories, at }) =>
    Database.use((db) =>
      db
        .insert(workspaceDriveRepository)
        .values(repositories.map((repository) => ({ organizationId, repository, addedAt: at })))
        .onConflictDoUpdate({
          target: [workspaceDriveRepository.organizationId, workspaceDriveRepository.repository],
          set: { addedAt: sql`excluded.added_at` },
        }),
    ),
});

const deleteRepositories = SqlSchema.void({
  Request: RepositoriesRequestSchema,
  execute: ({ organizationId, repositories }) =>
    Database.use((db) =>
      db
        .delete(workspaceDriveRepository)
        .where(
          and(
            eq(workspaceDriveRepository.organizationId, organizationId),
            inArray(workspaceDriveRepository.repository, [...repositories]),
          ),
        ),
    ),
});

/** Each name lower-cased once, as the drive's folder is named. */
function driveNames(repositories: readonly string[]): readonly string[] {
  return [...new Set(repositories.map((repository) => repository.toLowerCase()))];
}

/** The repositories the workspace's drive holds, lower-cased `owner/name`, in name order. */
export function workspaceDriveRepositories(
  organizationId: string,
): AgentStoreEffect<readonly string[]> {
  return Effect.map(findRepositories(organizationId), (rows) => rows.map((row) => row.repository));
}

/** Records that a fill at `at` added the repositories to the workspace's drive; one already recorded takes the new instant. */
export function recordWorkspaceDriveRepositories(
  organizationId: string,
  repositories: readonly string[],
  at: Date,
): AgentStoreEffect<void> {
  const names = driveNames(repositories);

  if (names.length === 0) return Effect.void;

  return upsertRepositories({ organizationId, repositories: names, at });
}

/** Forgets the repositories from the workspace's drive; a name it never held moves nothing. */
export function forgetWorkspaceDriveRepositories(
  organizationId: string,
  repositories: readonly string[],
): AgentStoreEffect<void> {
  const names = driveNames(repositories);

  if (names.length === 0) return Effect.void;

  return deleteRepositories({ organizationId, repositories: names });
}
