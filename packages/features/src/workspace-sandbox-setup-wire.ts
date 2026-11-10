import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-sandbox-setup-wire.ts -- a workspace's cloud sandbox setup, as Settings reads and saves it: its install script, each repository's setup and archive scripts, and each repository's run actions.
 *
 * As Conductor Cloud keeps them, in the workspace's settings: the install
 * script runs once per build of each of the workspace's repositories' base
 * snapshots, a repository's setup script runs once in each new agent
 * sandbox of it, after its checkout, and its archive script once in each
 * just before the sandbox is deleted for good, as its agent is archived.
 * `GET /api/workspaces/sandbox-setup` answers them all to any member;
 * `PUT /api/workspaces/sandbox-setup/install` and
 * `PUT /api/workspaces/sandbox-setup/repository` save one, each to an owner
 * or admin, an empty script removing it. A repository's run actions are the
 * commands a member runs in one of its cloud agents' sandboxes, each only
 * when pressed, from the Run menu in the agent's message box, behind the
 * Run actions experiment; `PUT /api/workspaces/sandbox-setup/run-actions`
 * saves one repository's whole list in its order, to an owner or admin, an
 * empty list removing it. Every answer is the setup as it then stands.
 */

/** The query the read names its workspace by. */
export const WORKSPACE_SANDBOX_SETUP_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const WORKSPACE_SANDBOX_SETUP_BOUNDS = {
  /** The longest script taken: 64 KB of characters. */
  MAX_SCRIPT_CHARS: 64 * 1024,
  /** The most run actions a repository keeps. */
  MAX_RUN_ACTIONS: 20,
  /** The longest run action's label taken, as the Run menu and a Terminal tab's title draw it. */
  MAX_RUN_ACTION_LABEL_CHARS: 40,
  /** The longest run action's command taken: 4 KB of characters. */
  MAX_RUN_ACTION_COMMAND_CHARS: 4 * 1024,
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

/** A run action's label: words to draw, with something in them. */
const runActionLabelSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS),
);

/** A run action's command: the bash it runs from the checkout, with something in it. */
const runActionCommandSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS),
  EffectSchema.isPattern(/\S/u),
);

/** One run action as it is kept: its id, which a run of it is known by while the list around it changes, its label, and its command. */
export const runActionSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  label: EffectSchema.String,
  command: EffectSchema.String,
});

export type RunAction = typeof runActionSchema.Type;

const repositoryRunActionsSchema = EffectSchema.Struct({
  /** `owner/name` as its latest save spelled it. */
  repository: EffectSchema.String,
  /** Its actions in their order: the first is the Run button's. */
  actions: EffectSchema.Array(runActionSchema),
  /** When the list was last saved, in epoch milliseconds. */
  updatedAt: countedNumber,
});

export type RepositoryRunActions = typeof repositoryRunActionsSchema.Type;

/** The workspace's sandbox setup (GET, and every save's answer): its install script where one is saved, each repository's setup script and archive script, and each repository's run actions, each list in the order of their names. */
export const workspaceSandboxSetupAnswerSchema = EffectSchema.Struct({
  install: EffectSchema.NullOr(savedScriptSchema),
  setups: EffectSchema.Array(repositorySetupSchema),
  archives: EffectSchema.Array(repositorySetupSchema),
  runActions: EffectSchema.Array(repositoryRunActionsSchema),
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

/** One run action as a save names it: the id it was read with, to keep its runs known as it, or none for an action new to the list, which the service names. */
const runActionPutSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(wireUuidSchema),
  label: runActionLabelSchema,
  command: runActionCommandSchema,
});

/** Saving a repository's run actions (PUT to `/run-actions`), the whole list in its order, replacing the one that stood under any casing of its name; an empty list removes it. */
export const workspaceRunActionsPutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  actions: EffectSchema.Array(runActionPutSchema).check(
    EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS),
  ),
});

export type RunActionPut = typeof runActionPutSchema.Type;
