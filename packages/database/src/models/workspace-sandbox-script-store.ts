/**
 * workspace-sandbox-script-store.ts -- a workspace's sandbox scripts: read them, set or remove its install script, and set or remove a repository's setup or archive script.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads, replaces, or removes another's scripts;
 * who may call each is the caller's to check. A repository's script is
 * named by its kind (`REPOSITORY_SCRIPT_KIND`), and a repository is matched
 * however its name is cased, since GitHub's names ignore case, each script
 * keeping the spelling of its latest save.
 */

import {
  REPOSITORY_SCRIPT_KIND,
  type RepositoryScriptKind,
} from "@repo/features/workspace-sandbox-setup-wire";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import {
  workspaceInstallScript as install,
  workspaceRepositorySetup as setup,
} from "../schemas/workspace-sandbox-script.js";
import { InstantColumnSchema } from "./columns.js";

type ScriptEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const InstallSchema = Schema.Struct({ script: Schema.String, updatedAt: InstantColumnSchema });

/** The workspace's install script as it was last saved. */
export type WorkspaceInstallScript = typeof InstallSchema.Type;

const KindSchema = Schema.Literals(Object.values(REPOSITORY_SCRIPT_KIND));

const SetupSchema = Schema.Struct({
  repository: Schema.String,
  kind: KindSchema,
  script: Schema.String,
  updatedAt: InstantColumnSchema,
});

/** A repository's setup or archive script as it was last saved, with the repository as that save spelled it. */
export type WorkspaceRepositorySetup = typeof SetupSchema.Type;

const RepositoryKeySchema = Schema.Struct({
  organizationId: Schema.String,
  repository: Schema.String,
  kind: KindSchema,
});

const ScriptWriteSchema = Schema.Struct({
  organizationId: Schema.String,
  script: Schema.String,
  now: Schema.Date,
});

/** The row of the kind naming the repository however its letters are cased. */
function namedRepository(
  organizationId: string,
  repository: string,
  kind: RepositoryScriptKind,
): SQL | undefined {
  return and(
    eq(setup.organizationId, organizationId),
    sql`lower(${setup.repository}) = lower(${repository})`,
    eq(setup.kind, kind),
  );
}

const SETUP_COLUMNS = {
  repository: setup.repository,
  kind: setup.kind,
  script: setup.script,
  updatedAt: setup.updatedAt,
};

const findInstall = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: InstallSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ script: install.script, updatedAt: install.updatedAt })
        .from(install)
        .where(eq(install.organizationId, organizationId)),
    ),
});

const findSetups = SqlSchema.findAll({
  Request: Schema.String,
  Result: SetupSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select(SETUP_COLUMNS)
        .from(setup)
        .where(eq(setup.organizationId, organizationId))
        .orderBy(asc(sql`lower(${setup.repository})`), asc(setup.kind)),
    ),
});

const findSetup = SqlSchema.findOneOption({
  Request: RepositoryKeySchema,
  Result: SetupSchema,
  execute: ({ organizationId, repository, kind }) =>
    Database.use((db) =>
      db
        .select(SETUP_COLUMNS)
        .from(setup)
        .where(namedRepository(organizationId, repository, kind)),
    ),
});

const upsertInstall = SqlSchema.void({
  Request: ScriptWriteSchema,
  execute: ({ organizationId, script, now }) =>
    Database.use((db) =>
      db
        .insert(install)
        .values({ organizationId, script, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: install.organizationId, set: { script, updatedAt: now } }),
    ),
});

const deleteInstall = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .delete(install)
        .where(eq(install.organizationId, organizationId))
        .returning({ organizationId: install.organizationId }),
    ),
});

const SetupWriteSchema = Schema.Struct({
  ...ScriptWriteSchema.fields,
  ...RepositoryKeySchema.fields,
});

const updateSetup = SqlSchema.findAll({
  Request: SetupWriteSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ organizationId, repository, kind, script, now }) =>
    Database.use((db) =>
      db
        .update(setup)
        .set({ repository, script, updatedAt: now })
        .where(namedRepository(organizationId, repository, kind))
        .returning({ id: setup.id }),
    ),
});

const insertSetup = SqlSchema.void({
  Request: SetupWriteSchema,
  execute: ({ organizationId, repository, kind, script, now }) =>
    Database.use((db) =>
      db
        .insert(setup)
        .values({ organizationId, repository, kind, script, createdAt: now, updatedAt: now }),
    ),
});

const deleteSetup = SqlSchema.findAll({
  Request: RepositoryKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ organizationId, repository, kind }) =>
    Database.use((db) =>
      db
        .delete(setup)
        .where(namedRepository(organizationId, repository, kind))
        .returning({ id: setup.id }),
    ),
});

/** The workspace's install script, where one is saved. */
export function readInstallScript(
  organizationId: string,
): ScriptEffect<Option.Option<WorkspaceInstallScript>> {
  return findInstall(organizationId);
}

/** Every repository's setup and archive script in the workspace, in the order of the repositories' names. */
export function listRepositorySetups(
  organizationId: string,
): ScriptEffect<readonly WorkspaceRepositorySetup[]> {
  return findSetups(organizationId);
}

/** The repository's script of the kind in the workspace, where one is saved. */
export function readRepositorySetup(
  organizationId: string,
  repository: string,
  kind: RepositoryScriptKind,
): ScriptEffect<Option.Option<WorkspaceRepositorySetup>> {
  return findSetup({ organizationId, repository, kind });
}

/** The workspace's install script set, replacing the one that stood. */
export function setInstallScript(
  organizationId: string,
  script: string,
  now: Date,
): ScriptEffect<void> {
  return upsertInstall({ organizationId, script, now });
}

/** The workspace's install script removed, answering whether one stood. */
export function removeInstallScript(organizationId: string): ScriptEffect<boolean> {
  return Effect.map(deleteInstall(organizationId), (rows) => rows.length > 0);
}

/**
 * The repository's script of the kind set, replacing the one of that kind
 * that stood under any casing of its name. Note that the update is tried before the insert,
 * because the unique index is on the lowered name, which no conflict target
 * names; two saves racing on a repository with none end on one row, the
 * loser refused by the index.
 */
export const setRepositorySetup = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  repository: string,
  kind: RepositoryScriptKind,
  script: string,
  now: Date,
): Effect.fn.Return<void, StoreFailure, DatabaseServices> {
  const write = { organizationId, repository, kind, script, now };
  const updated = yield* updateSetup(write);
  if (updated.length > 0) return;
  yield* insertSetup(write);
});

/** The repository's script of the kind removed, answering whether one stood. */
export function removeRepositorySetup(
  organizationId: string,
  repository: string,
  kind: RepositoryScriptKind,
): ScriptEffect<boolean> {
  return Effect.map(deleteSetup({ organizationId, repository, kind }), (rows) => rows.length > 0);
}
