/**
 * workspace-sandbox-script-store.ts -- a workspace's sandbox scripts: read them, set or remove its install script, set or remove a repository's setup or archive script, and set a repository's run actions.
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
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import {
  workspaceInstallScript as install,
  workspaceRepositoryRunAction as runAction,
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

const RunActionSchema = Schema.Struct({
  id: Schema.String,
  repository: Schema.String,
  label: Schema.String,
  command: Schema.String,
  updatedAt: InstantColumnSchema,
});

/** One of a repository's run actions as its list was last saved, with the repository as that save spelled it. */
export type WorkspaceRunAction = typeof RunActionSchema.Type;

/** One action as a save writes it: the id it keeps, where it keeps one, its label, and its command. */
export interface RunActionWrite {
  readonly id?: string | undefined;
  readonly label: string;
  readonly command: string;
}

const RUN_ACTION_COLUMNS = {
  id: runAction.id,
  repository: runAction.repository,
  label: runAction.label,
  command: runAction.command,
  updatedAt: runAction.updatedAt,
};

const RunActionsKeySchema = Schema.Struct({
  organizationId: Schema.String,
  repository: Schema.String,
});

/** The repository's run actions however its letters are cased. */
function namedRunActions(organizationId: string, repository: string): SQL | undefined {
  return and(
    eq(runAction.organizationId, organizationId),
    sql`lower(${runAction.repository}) = lower(${repository})`,
  );
}

const findRunActions = SqlSchema.findAll({
  Request: Schema.String,
  Result: RunActionSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select(RUN_ACTION_COLUMNS)
        .from(runAction)
        .where(eq(runAction.organizationId, organizationId))
        .orderBy(asc(sql`lower(${runAction.repository})`), asc(runAction.position)),
    ),
});

const findRepositoryRunActions = SqlSchema.findAll({
  Request: RunActionsKeySchema,
  Result: RunActionSchema,
  execute: ({ organizationId, repository }) =>
    Database.use((db) =>
      db
        .select(RUN_ACTION_COLUMNS)
        .from(runAction)
        .where(namedRunActions(organizationId, repository))
        .orderBy(asc(runAction.position)),
    ),
});

const deleteRunActions = SqlSchema.void({
  Request: RunActionsKeySchema,
  execute: ({ organizationId, repository }) =>
    Database.use((db) => db.delete(runAction).where(namedRunActions(organizationId, repository))),
});

const insertRunAction = SqlSchema.void({
  Request: Schema.Struct({
    ...RunActionsKeySchema.fields,
    id: Schema.optionalKey(Schema.String),
    position: Schema.Number,
    label: Schema.String,
    command: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ now, ...row }) =>
    Database.use((db) => db.insert(runAction).values({ ...row, createdAt: now, updatedAt: now })),
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

/** Every repository's run actions in the workspace, in the order of the repositories' names and then of each list. */
export function listRunActions(
  organizationId: string,
): ScriptEffect<readonly WorkspaceRunAction[]> {
  return findRunActions(organizationId);
}

/** The repository's run actions in the workspace, in their order; none where no list is saved. */
export function readRunActions(
  organizationId: string,
  repository: string,
): ScriptEffect<readonly WorkspaceRunAction[]> {
  return findRepositoryRunActions({ organizationId, repository });
}

/**
 * The repository's run actions set, the whole list in its order, replacing
 * the one that stood under any casing of its name; an empty list removes it.
 * An action keeps the id it is given only where that id is one of the
 * repository's actions already, and only at its first place in the list, so
 * a run going on is still known as its action; any other is named afresh, so
 * no save reaches another repository's or workspace's action. Note that the
 * old list is read, deleted, and the new one written in one transaction, so
 * a reader sees one list or the other, never a mix; and that it is held under
 * the repository's lock, so two saves of one repository land one after the
 * other, the later reading and replacing what the earlier wrote.
 */
export function setRunActions(
  organizationId: string,
  repository: string,
  actions: readonly RunActionWrite[],
  now: Date,
): ScriptEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // The repository's lock, its name however cased, so a save waiting on another reads the list that one wrote.
        yield* client`select pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(lower(${repository})))`;
        const standing = yield* findRepositoryRunActions({ organizationId, repository });
        const keepable = new Set(standing.map((row) => row.id));
        yield* deleteRunActions({ organizationId, repository });
        for (const [position, action] of actions.entries()) {
          const keeps = action.id !== undefined && keepable.delete(action.id);
          yield* insertRunAction({
            organizationId,
            repository,
            position,
            label: action.label,
            command: action.command,
            now,
            ...(keeps && action.id !== undefined ? { id: action.id } : {}),
          });
        }
      }),
    ),
  );
}
