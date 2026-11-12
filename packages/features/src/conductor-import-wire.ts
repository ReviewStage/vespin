/**
 * conductor-import-wire.ts -- an import from Conductor as the settings form asks for it and reads it: the key checked, the run begun, and the run's progress.
 *
 * Every Conductor workspace a key sees becomes a task and each of its chats
 * an agent on it (`packages/service/src/integrations/conductor/`). The form
 * hands the key to the check and to the run, and never gets it back: no
 * answer carries it. A check or a run Conductor refused answers why, as one
 * of `CONDUCTOR_IMPORT_REFUSAL`, rather than failing.
 */

import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./task-wire.js";

/** The longest key a request takes: Conductor's keys are well under it. */
const CONDUCTOR_KEY_MAX_CHARS = 512;

/** What a Conductor id names: a workspace, which becomes a task, or a chat, which becomes an agent on it. */
export const CONDUCTOR_IMPORT_KIND = {
  WORKSPACE: "workspace",
  CHAT: "chat",
} as const;

export type ConductorImportKind =
  (typeof CONDUCTOR_IMPORT_KIND)[keyof typeof CONDUCTOR_IMPORT_KIND];

/** Where one workspace or chat of a run stands. */
export const CONDUCTOR_IMPORT_STATUS = {
  /** Sent to the queue and not yet taken. */
  QUEUED: "queued",
  /** Imported by this run. */
  IMPORTED: "imported",
  /** Imported before, by this run's member or another, and left as it stands. */
  SKIPPED: "skipped",
  /** Not imported, with why. */
  FAILED: "failed",
} as const;

export type ConductorImportStatus =
  (typeof CONDUCTOR_IMPORT_STATUS)[keyof typeof CONDUCTOR_IMPORT_STATUS];

/** Why a workspace or a chat was not imported. */
export const CONDUCTOR_IMPORT_FAILURE = {
  /** The workspace's repository is one the workspace's GitHub installation does not reach. */
  REPOSITORY_UNREACHED: "repository-unreached",
  /** Conductor refused the key partway, or no longer has the workspace or chat. */
  CONDUCTOR_REFUSED: "conductor-refused",
  /** Conductor did not answer, or answered in a shape this build does not read, after every retry. */
  CONDUCTOR_UNAVAILABLE: "conductor-unavailable",
  /** The task could not be made, such as for an assignee who left or a task id taken. */
  TASK_NOT_MADE: "task-not-made",
  /** The workspace's task was deleted since an earlier import, or its member cannot reach it. */
  TASK_GONE: "task-gone",
  /** The chat's transcript could not be written. */
  CHAT_NOT_WRITTEN: "chat-not-written",
  /** The run's sealed key was deleted, as a day after the run began, before this was taken. */
  RUN_EXPIRED: "run-expired",
} as const;

export type ConductorImportFailure =
  (typeof CONDUCTOR_IMPORT_FAILURE)[keyof typeof CONDUCTOR_IMPORT_FAILURE];

/** Why Conductor refused a check or a run before anything was written. */
export const CONDUCTOR_IMPORT_REFUSAL = {
  /** The key was refused. */
  BAD_KEY: "bad-key",
  /** Conductor asked us to slow down. */
  RATE_LIMITED: "rate-limited",
  /** Conductor did not answer, or answered in a shape this build does not read. */
  UNAVAILABLE: "unavailable",
} as const;

export type ConductorImportRefusal =
  (typeof CONDUCTOR_IMPORT_REFUSAL)[keyof typeof CONDUCTOR_IMPORT_REFUSAL];

/** The key, as the form hands it to a check or a run in its workspace. */
export const conductorImportRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  apiKey: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(CONDUCTOR_KEY_MAX_CHARS),
  ),
});

export type ConductorImportRequest = typeof conductorImportRequestSchema.Type;

/** The workspace whose newest run of the caller's the progress reads. */
export const conductorImportProgressRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

const refusedSchema = EffectSchema.Struct({
  refused: EffectSchema.Literals(Object.values(CONDUCTOR_IMPORT_REFUSAL)),
});

/**
 * What a check answers: how many workspaces the key sees, and the
 * repositories among theirs (`owner/name`) the workspace's GitHub
 * installation does not reach yet, which the form offers one install for;
 * or why Conductor refused.
 */
export const conductorImportCheckAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    workspaces: EffectSchema.Number,
    unreachedRepositories: EffectSchema.Array(EffectSchema.String),
  }),
  refusedSchema,
]);

export type ConductorImportCheckAnswer = typeof conductorImportCheckAnswerSchema.Type;

/** What a run answers once its workspaces are queued: the run, and how many workspaces it took; or why Conductor refused. */
export const conductorImportRunAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ runId: EffectSchema.String, workspaces: EffectSchema.Number }),
  refusedSchema,
]);

export type ConductorImportRunAnswer = typeof conductorImportRunAnswerSchema.Type;

/** One workspace or chat of a run as it stands: its Conductor id, the workspace a chat is of, its name, why it failed where it did, and for a workspace imported, by this run or an earlier one, the task it became. */
export const conductorImportItemSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(CONDUCTOR_IMPORT_KIND)),
  conductorId: EffectSchema.String,
  workspaceConductorId: EffectSchema.String,
  name: EffectSchema.NullOr(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(CONDUCTOR_IMPORT_STATUS)),
  failure: EffectSchema.NullOr(EffectSchema.Literals(Object.values(CONDUCTOR_IMPORT_FAILURE))),
  /** The task a workspace became; null for a chat, and for a workspace not imported. */
  taskId: EffectSchema.NullOr(EffectSchema.String),
});

export type ConductorImportItem = typeof conductorImportItemSchema.Type;

/** The caller's newest run in the workspace, with every workspace and chat it took, or none where they ran none. */
export const conductorImportProgressAnswerSchema = EffectSchema.Struct({
  run: EffectSchema.NullOr(
    EffectSchema.Struct({
      runId: EffectSchema.String,
      startedAt: EffectSchema.Number,
      /** Whether nothing of it is queued any more. */
      ended: EffectSchema.Boolean,
      items: EffectSchema.Array(conductorImportItemSchema),
    }),
  ),
});

export type ConductorImportProgressAnswer = typeof conductorImportProgressAnswerSchema.Type;
