import { and, asc, desc, eq, not, type SQL, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { workspaceTokenRepository } from "../schemas/workspace-token-repository.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { workspaceReachableBy } from "./workspace-store.js";

/**
 * workspace-token-repository-store.ts -- the repositories members added to a workspace on their own GitHub token, read and written for `/api/github/token-repositories`.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account asking and the workspace, and touches a row only where the
 * account is a member of that workspace, so no account reads or changes
 * another workspace's. A repository is one however its name's letters are
 * cased, as GitHub's names are: adding one already added keeps the first
 * add, and removing one that is gone moves nothing. A row whose adder is no
 * longer a member of the workspace is read as gone, since their token no
 * longer acts for it, and the next add replaces it. Who may remove one, its
 * adder or a workspace's owner or admin, is the caller's to decide; the
 * store answers who added it.
 */

const RowSchema = Schema.Struct({
  repository: Schema.String,
  addedByUserId: Schema.String,
  addedAt: InstantColumnSchema,
});

/** One repository a member added to the workspace on their token, as its row holds it. */
export interface WorkspaceTokenRepositoryRow {
  readonly repository: string;
  readonly addedByUserId: string;
  /** Epoch milliseconds. */
  readonly addedAt: number;
}

/** The row naming the repository however its letters are cased, since GitHub's names ignore case. */
function namedRepository(repository: string): SQL {
  return sql`lower(${workspaceTokenRepository.repository}) = lower(${repository})`;
}

/** The row's adder still a member of its workspace, so their token still acts for it. */
const ADDER_STANDS = workspaceReachableBy(
  workspaceTokenRepository.addedByUserId,
  workspaceTokenRepository.organizationId,
);

const PlaceSchema = Schema.Struct({ userId: Schema.String, organizationId: Schema.String });

const KeySchema = Schema.Struct({ ...PlaceSchema.fields, repository: Schema.String });

const findRows = SqlSchema.findAll({
  Request: PlaceSchema,
  Result: RowSchema,
  execute: (place) =>
    Database.use((db) =>
      db
        .select({
          repository: workspaceTokenRepository.repository,
          addedByUserId: workspaceTokenRepository.addedByUserId,
          addedAt: workspaceTokenRepository.addedAt,
        })
        .from(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, place.organizationId),
            workspaceReachableBy(place.userId, workspaceTokenRepository.organizationId),
            ADDER_STANDS,
          ),
        )
        .orderBy(desc(workspaceTokenRepository.addedAt), asc(workspaceTokenRepository.repository)),
    ),
});

const findAdder = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: Schema.Struct({ addedByUserId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ addedByUserId: workspaceTokenRepository.addedByUserId })
        .from(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, key.organizationId),
            namedRepository(key.repository),
            workspaceReachableBy(key.userId, workspaceTokenRepository.organizationId),
            ADDER_STANDS,
          ),
        ),
    ),
});

const deleteLeftRow = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, repository: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, key.organizationId),
            namedRepository(key.repository),
            not(ADDER_STANDS),
          ),
        ),
    ),
});

const insertRow = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, now: Schema.Date }),
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(workspaceTokenRepository)
        .values({
          organizationId: write.organizationId,
          repository: write.repository,
          addedByUserId: write.userId,
          addedAt: write.now,
        })
        .onConflictDoNothing(),
    ),
});

const deleteRow = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, addedByUserId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(workspaceTokenRepository)
        .where(
          and(
            eq(workspaceTokenRepository.organizationId, key.organizationId),
            namedRepository(key.repository),
            eq(workspaceTokenRepository.addedByUserId, key.addedByUserId),
            workspaceReachableBy(key.userId, workspaceTokenRepository.organizationId),
          ),
        ),
    ),
});

/** The repositories members added to the workspace on their tokens, newest added first; none where the account is not a member of it. */
export function listWorkspaceTokenRepositories(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly WorkspaceTokenRepositoryRow[]> {
  return Effect.map(findRows({ userId, organizationId }), (rows) =>
    rows.map((row) => ({
      repository: row.repository,
      addedByUserId: row.addedByUserId,
      addedAt: row.addedAt.getTime(),
    })),
  );
}

/**
 * Adds the repository to the workspace as the account's, at the instant
 * given; a repository already added keeps its first adder while they are
 * still a member, and is taken over from one who left. The caller has
 * already checked the account is a member and its token may push to it.
 */
export function addWorkspaceTokenRepository(
  userId: string,
  organizationId: string,
  repository: string,
  now: Date,
): TaskStoreEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.andThen(
        deleteLeftRow({ organizationId, repository }),
        insertRow({ userId, organizationId, repository, now }),
      ),
    ),
  );
}

/** Who added the repository to the workspace; nothing where it is not added, or the account is not a member. */
export function workspaceTokenRepositoryAdder(
  userId: string,
  organizationId: string,
  repository: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findAdder({ userId, organizationId, repository }),
    Option.map((row) => row.addedByUserId),
  );
}

/**
 * Removes the repository from the workspace, where the account is a member
 * of it and it is still the adder's the caller checked, so a row added
 * again by someone else since is left standing.
 */
export function removeWorkspaceTokenRepository(
  userId: string,
  organizationId: string,
  repository: string,
  addedByUserId: string,
): TaskStoreEffect<void> {
  return deleteRow({ userId, organizationId, repository, addedByUserId });
}
