import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-sandbox-setup-wire.ts -- a workspace's cloud sandbox setup, as Settings reads and saves it: its install script, and each repository's setup and archive scripts.
 *
 * As Conductor Cloud keeps them, in the workspace's settings: the install
 * script runs once per build of each of the workspace's repositories' base
 * snapshots, a repository's setup script runs once in each new agent
 * sandbox of it, after its checkout, and its archive script once in each
 * just before the sandbox is deleted for good, as its agent is archived.
 * `GET /api/workspaces/sandbox-setup` answers them all to any member;
 * `PUT /api/workspaces/sandbox-setup/install` and
 * `PUT /api/workspaces/sandbox-setup/repository` save one, each to an owner
 * or admin, an empty script removing it. Every answer is the setup as it
 * then stands.
 */

/** The query the read names its workspace by. */
export const WORKSPACE_SANDBOX_SETUP_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const WORKSPACE_SANDBOX_SETUP_BOUNDS = {
  /** The longest script taken: 64 KB of characters. */
  MAX_SCRIPT_CHARS: 64 * 1024,
} as const;

/** Which of a repository's scripts a row holds: the one its new sandboxes run after their checkout, or the one each runs just before it is deleted for good. */
export const REPOSITORY_SCRIPT_KIND = {
  SETUP: "setup",
  ARCHIVE: "archive",
} as const;

export type RepositoryScriptKind =
  (typeof REPOSITORY_SCRIPT_KIND)[keyof typeof REPOSITORY_SCRIPT_KIND];

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

/** The workspace's sandbox setup (GET, and every save's answer): its install script where one is saved, and each repository's setup script and archive script, each list in the order of their names. */
export const workspaceSandboxSetupAnswerSchema = EffectSchema.Struct({
  install: EffectSchema.NullOr(savedScriptSchema),
  setups: EffectSchema.Array(repositorySetupSchema),
  archives: EffectSchema.Array(repositorySetupSchema),
});

export type WorkspaceSandboxSetupAnswer = typeof workspaceSandboxSetupAnswerSchema.Type;

/** Saving the install script (PUT to `/install`), replacing the one that stood; an empty script removes it. */
export const workspaceInstallScriptPutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  script: scriptSchema,
});

/** Saving a repository's setup script, or its archive script where `kind` names it (PUT to `/repository`), replacing the one of that kind that stood under any casing of its name; an empty script removes it. */
export const workspaceRepositorySetupPutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  script: scriptSchema,
  /** Which of the repository's scripts is saved; its setup script where unsaid. */
  kind: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(REPOSITORY_SCRIPT_KIND))),
});
