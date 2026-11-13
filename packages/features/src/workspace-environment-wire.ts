import { Schema as EffectSchema } from "effect";
import { countedNumber, memberRefSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-environment-wire.ts -- a workspace's shared environment variables, as Settings lists, sets, edits, and removes them.
 *
 * Every member's cloud agents are handed the variables of their workspace.
 * `GET /api/workspaces/environment` answers them to any member; `PUT` sets
 * one, `POST /api/workspaces/environment/save` sets several at once,
 * `POST /api/workspaces/environment/edit` renames or changes one, and
 * `POST /api/workspaces/environment/delete` removes one, each to an owner
 * or admin. Every answer is the variables as they then stand, each with
 * when and by whom it was added and last changed. A secret's value travels
 * once, in the body of the write that sets it, and never again; a
 * config's (`secret` false), such as `NODE_ENV`, is answered to every
 * member. A config may become a secret, and a secret never a config.
 */

/** The query the list names its workspace by. */
export const WORKSPACE_ENVIRONMENT_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const WORKSPACE_ENVIRONMENT_BOUNDS = {
  /** The longest name taken. */
  MAX_NAME_CHARS: 256,
  /** The longest value taken: 32 KB of characters. */
  MAX_VALUE_CHARS: 32 * 1024,
  /** The most variables one save sets. */
  MAX_SAVED: 100,
} as const;

/** A POSIX environment name: a letter or underscore, then letters, digits, and underscores. */
export const workspaceVariableNameSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS),
  EffectSchema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u),
);

/** A variable's value, at most its bound. */
export const workspaceVariableValueSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS),
);

const workspaceVariableSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  /** When the variable was last set, in epoch milliseconds; its `createdAt` until its first change. */
  updatedAt: countedNumber,
  /** Whether its value is never answered; absent from a service before configs, where every variable is one. */
  secret: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** A config's value; never present for a secret. */
  value: EffectSchema.optionalKey(EffectSchema.String),
  /** When it was added, in epoch milliseconds; absent from a service before it was answered. */
  createdAt: EffectSchema.optionalKey(countedNumber),
  /** Who added it; absent where their account is gone, or it was added before this was kept. */
  createdBy: EffectSchema.optionalKey(memberRefSchema),
  /** Who last changed it; absent until its first change, and where their account is gone. */
  updatedBy: EffectSchema.optionalKey(memberRefSchema),
});

export type WorkspaceVariable = typeof workspaceVariableSchema.Type;

/** The workspace's variables in name order (GET, and every write's answer). */
export const workspaceEnvironmentAnswerSchema = EffectSchema.Struct({
  variables: EffectSchema.Array(workspaceVariableSchema),
});

export type WorkspaceEnvironmentAnswer = typeof workspaceEnvironmentAnswerSchema.Type;

/**
 * Setting a variable (PUT), replacing the value of one of that name. A new
 * one is a secret unless `secret` is false; one that stands keeps what it
 * is unless `secret` is true, which turns a config into a secret.
 */
export const workspaceVariablePutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceVariableNameSchema,
  value: workspaceVariableValueSchema,
  secret: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** One variable a save sets. */
const workspaceVariableSavedSchema = EffectSchema.Struct({
  name: workspaceVariableNameSchema,
  value: workspaceVariableValueSchema,
});

/**
 * Setting several variables at once (POST to `/save`), all or none, each
 * replacing the value of one of its name, as a put of each would: a new
 * one is what `secret` says, and one that stands becomes a secret where
 * `secret` is true and keeps what it is otherwise. No name twice.
 */
export const workspaceVariablesSaveRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  secret: EffectSchema.Boolean,
  variables: EffectSchema.Array(workspaceVariableSavedSchema).check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_SAVED),
    // Note that no name comes twice, since one save's two values for a name would leave whichever landed last.
    EffectSchema.makeFilter(
      (variables: readonly { readonly name: string }[]) =>
        new Set(variables.map((each) => each.name)).size === variables.length,
    ),
  ),
});

export type WorkspaceVariablesSaveRequest = typeof workspaceVariablesSaveRequestSchema.Type;

/**
 * Editing one variable (POST to `/edit`): a new name, a new value, or a
 * config turned secret, each where given; a rename keeps the value where
 * none is given. A rename onto a name that stands is refused.
 */
export const workspaceVariableEditRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceVariableNameSchema,
  rename: EffectSchema.optionalKey(workspaceVariableNameSchema),
  value: EffectSchema.optionalKey(workspaceVariableValueSchema),
  secret: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type WorkspaceVariableEditRequest = typeof workspaceVariableEditRequestSchema.Type;

/** Removing a variable (POST to `/delete`). */
export const workspaceVariableDeleteRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceVariableNameSchema,
});
