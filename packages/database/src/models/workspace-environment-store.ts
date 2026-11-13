/**
 * workspace-environment-store.ts -- a workspace's shared environment variables: list them, set several at once, edit or remove one, and open them all for an agent's launch.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads, replaces, or removes another's
 * variables; who may call each is the caller's to check. A value goes in
 * sealed (`provider-key-seal.ts`'s `sealWorkspaceVariable`) and comes out
 * opened only through `openWorkspaceEnvironment`, which opens every value
 * with the ring it is handed; the list hands a config's sealed value back
 * for its caller to open, and never a secret's. Setting a name that stands
 * replaces its value, and a set or an edit never turns a secret into a
 * config.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Redacted, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { workspaceEnvironmentVariable as variable } from "../schemas/workspace-environment-variable.js";
import { InstantColumnSchema } from "./columns.js";
import {
  type KeyRing,
  openWorkspaceVariable,
  type SealedWorkspaceVariable,
} from "./provider-key-seal.js";

type EnvironmentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const creator = alias(user, "creator");
const updater = alias(user, "updater");

const SealedFieldsSchema = Schema.Struct({
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedValue: Schema.String,
});

const ListedRowSchema = Schema.Struct({
  name: Schema.String,
  secret: Schema.Boolean,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
  createdById: Schema.NullOr(Schema.String),
  createdByName: Schema.NullOr(Schema.String),
  updatedById: Schema.NullOr(Schema.String),
  updatedByName: Schema.NullOr(Schema.String),
  ...SealedFieldsSchema.fields,
});

/** A member a variable names, by their account's id and the name it holds now. */
export interface WorkspaceVariableMember {
  readonly userId: string;
  readonly name: string;
}

/**
 * One variable as the list answers it: its name, whether it is a secret,
 * when and by whom it was added and last changed, and a config's sealed
 * value, for its caller to open; never a secret's.
 */
export interface ListedWorkspaceVariable {
  readonly name: string;
  readonly secret: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Who added it; none where their account is gone or it was added before this was kept. */
  readonly createdBy: WorkspaceVariableMember | undefined;
  /** Who last changed it; none until its first change, and where their account is gone. */
  readonly updatedBy: WorkspaceVariableMember | undefined;
  /** A config's value, sealed; none for a secret. */
  readonly config: SealedWorkspaceVariable | undefined;
}

/** One variable a set names: its name and its value sealed under it. */
export interface SetWorkspaceVariable {
  readonly name: string;
  readonly sealed: SealedWorkspaceVariable;
}

/** What an edit changes: a new name, a new value, and a config turned secret. */
export interface WorkspaceVariableEdit {
  /** The new name, where it is renamed. */
  readonly name?: string | undefined;
  /** A new value, sealed under the name it ends with. */
  readonly sealed?: SealedWorkspaceVariable | undefined;
  /**
   * The value it holds, sealed again under its new name, where it is renamed
   * and keeps its value: handed the value as the row holds it under the
   * edit's lock, so no write between a read and the rename is undone, and
   * answering none where it cannot be opened.
   */
  readonly resealed?:
    | ((stored: SealedWorkspaceVariable) => SealedWorkspaceVariable | undefined)
    | undefined;
  /** True turns a config into a secret; a secret stays one either way. */
  readonly secret?: true | undefined;
}

/** How an edit went: done, no such variable, its new name another's, or a value it keeps that could not be opened. */
export const WORKSPACE_VARIABLE_EDIT = {
  EDITED: "edited",
  MISSING: "missing",
  NAME_TAKEN: "name-taken",
  UNREADABLE: "unreadable",
} as const;

export type WorkspaceVariableEditOutcome =
  (typeof WORKSPACE_VARIABLE_EDIT)[keyof typeof WORKSPACE_VARIABLE_EDIT];

const SealedSchema = Schema.Struct({ name: Schema.String, ...SealedFieldsSchema.fields });

const sealedColumns = {
  keyVersion: variable.keyVersion,
  sealedDataKey: variable.sealedDataKey,
  sealedValue: variable.sealedValue,
};

const findListed = SqlSchema.findAll({
  Request: Schema.String,
  Result: ListedRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          name: variable.name,
          secret: variable.secret,
          createdAt: variable.createdAt,
          updatedAt: variable.updatedAt,
          createdById: creator.id,
          createdByName: creator.name,
          updatedById: updater.id,
          updatedByName: updater.name,
          ...sealedColumns,
        })
        .from(variable)
        .leftJoin(creator, eq(creator.id, variable.createdBy))
        .leftJoin(updater, eq(updater.id, variable.updatedBy))
        .where(eq(variable.organizationId, organizationId))
        .orderBy(asc(variable.name)),
    ),
});

const findSealed = SqlSchema.findAll({
  Request: Schema.String,
  Result: SealedSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ name: variable.name, ...sealedColumns })
        .from(variable)
        .where(eq(variable.organizationId, organizationId))
        .orderBy(asc(variable.name)),
    ),
});

const findOne = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: Schema.Struct({ secret: Schema.Boolean, ...SealedFieldsSchema.fields }),
  execute: ({ organizationId, name }) =>
    Database.use((db) =>
      db
        .select({ secret: variable.secret, ...sealedColumns })
        .from(variable)
        .where(and(eq(variable.organizationId, organizationId), eq(variable.name, name))),
    ),
});

/** One variable's sealed value, its row locked until the transaction it is read in ends. */
const findLocked = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: SealedFieldsSchema,
  execute: ({ organizationId, name }) =>
    Database.use((db) =>
      db
        .select(sealedColumns)
        .from(variable)
        .where(and(eq(variable.organizationId, organizationId), eq(variable.name, name)))
        .for("update"),
    ),
});

const upsertRow = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    name: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedValue: Schema.String,
    secret: Schema.UndefinedOr(Schema.Boolean),
    by: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ now, by, secret, ...row }) =>
    Database.use((db) =>
      db
        .insert(variable)
        .values({
          ...row,
          secret: secret ?? true,
          createdBy: by,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [variable.organizationId, variable.name],
          set: {
            keyVersion: row.keyVersion,
            sealedDataKey: row.sealedDataKey,
            sealedValue: row.sealedValue,
            updatedBy: by,
            updatedAt: now,
            // Note that a secret stays one whatever a set says, so a value once hidden is never shown; Drizzle leaves a column it is handed undefined as it stands.
            secret: secret === undefined ? undefined : sql`${variable.secret} or ${secret}`,
          },
        }),
    ),
});

const updateRow = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    name: Schema.String,
    rename: Schema.UndefinedOr(Schema.String),
    sealed: Schema.UndefinedOr(SealedFieldsSchema),
    secret: Schema.UndefinedOr(Schema.Literal(true)),
    by: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ name: Schema.String }),
  execute: ({ organizationId, name, rename, sealed, secret, by, now }) =>
    Database.use((db) =>
      db
        .update(variable)
        .set({
          // Note that Drizzle leaves a column it is handed undefined as it stands.
          name: rename,
          ...sealed,
          secret,
          updatedBy: by,
          updatedAt: now,
        })
        .where(and(eq(variable.organizationId, organizationId), eq(variable.name, name)))
        .returning({ name: variable.name }),
    ),
});

const deleteRow = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: Schema.Struct({ name: Schema.String }),
  execute: ({ organizationId, name }) =>
    Database.use((db) =>
      db
        .delete(variable)
        .where(and(eq(variable.organizationId, organizationId), eq(variable.name, name)))
        .returning({ name: variable.name }),
    ),
});

function memberOf(userId: string | null, name: string | null): WorkspaceVariableMember | undefined {
  return userId === null || name === null ? undefined : { userId, name };
}

/** The workspace's variables in name order, each with who added and last changed it, and a config's sealed value. */
export function listWorkspaceVariables(
  organizationId: string,
): EnvironmentEffect<readonly ListedWorkspaceVariable[]> {
  return Effect.map(findListed(organizationId), (rows) =>
    rows.map((row) => ({
      name: row.name,
      secret: row.secret,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: memberOf(row.createdById, row.createdByName),
      updatedBy: memberOf(row.updatedById, row.updatedByName),
      config: row.secret
        ? undefined
        : {
            keyVersion: row.keyVersion,
            sealedDataKey: row.sealedDataKey,
            sealedValue: row.sealedValue,
          },
    })),
  );
}

/**
 * The variables set to their sealed values by one member, all or none,
 * each replacing the value of one of its name. A new variable is a secret
 * unless `secret` says otherwise; one that stands keeps what it is unless
 * `secret` turns it into a secret, never the other way.
 */
export function setWorkspaceVariables(
  organizationId: string,
  variables: readonly SetWorkspaceVariable[],
  secret: boolean | undefined,
  by: string,
  now: Date,
): EnvironmentEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.forEach(
        variables,
        ({ name, sealed }) => upsertRow({ organizationId, name, ...sealed, secret, by, now }),
        { discard: true },
      ),
    ),
  );
}

/**
 * One variable edited by one member: renamed, given a new value, or turned
 * secret, its row locked from the read of its value to the write; refused
 * where it stands not, where its new name is another's, or where a value a
 * rename keeps cannot be opened.
 */
export function editWorkspaceVariable(
  organizationId: string,
  name: string,
  edit: WorkspaceVariableEdit,
  by: string,
  now: Date,
): EnvironmentEffect<WorkspaceVariableEditOutcome> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const stored = yield* findLocked({ organizationId, name });

        if (Option.isNone(stored)) return WORKSPACE_VARIABLE_EDIT.MISSING;
        const rename = edit.name === undefined || edit.name === name ? undefined : edit.name;

        if (rename !== undefined) {
          const taken = yield* findOne({ organizationId, name: rename });

          if (Option.isSome(taken)) return WORKSPACE_VARIABLE_EDIT.NAME_TAKEN;
        }

        const sealed = edit.sealed ?? edit.resealed?.(stored.value);

        if (edit.sealed === undefined && edit.resealed !== undefined && sealed === undefined) {
          return WORKSPACE_VARIABLE_EDIT.UNREADABLE;
        }

        yield* updateRow({ organizationId, name, rename, sealed, secret: edit.secret, by, now });

        return WORKSPACE_VARIABLE_EDIT.EDITED;
      }),
    ),
  );
}

/** The workspace's variable of that name removed, answering whether one stood. */
export function removeWorkspaceVariable(
  organizationId: string,
  name: string,
): EnvironmentEffect<boolean> {
  return Effect.map(deleteRow({ organizationId, name }), (rows) => rows.length > 0);
}

/**
 * Every variable of the workspace opened with the ring, by name, for an
 * agent's environment. A value the ring cannot open is left out and logged
 * by its name alone.
 */
export const openWorkspaceEnvironment = /* @__PURE__ */ Effect.fnUntraced(function* (
  ring: KeyRing,
  organizationId: string,
): Effect.fn.Return<Record<string, string>, StoreFailure, DatabaseServices> {
  const rows = yield* findSealed(organizationId);
  const environment: Record<string, string> = {};

  for (const row of rows) {
    const opened = openWorkspaceVariable(ring, { organizationId, name: row.name }, row);

    if (Result.isFailure(opened)) {
      yield* Effect.logWarning(`The workspace variable ${row.name} cannot be opened.`);
      continue;
    }

    environment[row.name] = Redacted.value(opened.success);
  }

  return environment;
});
