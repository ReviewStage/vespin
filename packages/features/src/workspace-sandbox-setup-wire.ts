import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-sandbox-setup-wire.ts -- a workspace's cloud sandbox setup, as Settings reads and saves it: its install script, and each repository's setup script.
 *
 * As Conductor Cloud keeps them, in the workspace's settings: the install
 * script runs once per build of each of the workspace's repositories' base
 * snapshots, and a repository's setup script runs once in each new agent
 * sandbox of it, after its checkout. `GET /api/workspaces/sandbox-setup`
 * answers both to any member; `PUT /api/workspaces/sandbox-setup/install`
 * and `PUT /api/workspaces/sandbox-setup/repository` save one, each to an
 * owner or admin, an empty script removing it. Every answer is the setup as
 * it then stands.
 */

/** The query the read names its workspace by. */
export const WORKSPACE_SANDBOX_SETUP_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const WORKSPACE_SANDBOX_SETUP_BOUNDS = {
  /** The longest script taken: 64 KB of characters. */
  MAX_SCRIPT_CHARS: 64 * 1024,
} as const;

const scriptSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS),
);

const savedScriptSchema = EffectSchema.Struct({
  script: EffectSchema.String,
  /** When the script was last saved, in epoch milliseconds. */
  updatedAt: countedNumber,
});

const repositorySetupSchema = EffectSchema.Struct({
  ...savedScriptSchema.fields,
  /** `owner/name` as its latest save spelled it. */
  repository: EffectSchema.String,
});

/** The workspace's sandbox setup (GET, and every save's answer): its install script where one is saved, and each repository's setup script in the order of their names. */
export const workspaceSandboxSetupAnswerSchema = EffectSchema.Struct({
  install: EffectSchema.NullOr(savedScriptSchema),
  setups: EffectSchema.Array(repositorySetupSchema),
});

export type WorkspaceSandboxSetupAnswer = typeof workspaceSandboxSetupAnswerSchema.Type;

/** Saving the install script (PUT to `/install`), replacing the one that stood; an empty script removes it. */
export const workspaceInstallScriptPutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  script: scriptSchema,
});

/** Saving a repository's setup script (PUT to `/repository`), replacing the one that stood under any casing of its name; an empty script removes it. */
export const workspaceRepositorySetupPutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  script: scriptSchema,
});
