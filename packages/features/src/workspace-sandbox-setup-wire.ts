import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { looseTaskSectionIconSchema, taskSectionIconSchema } from "./task-section-wire.js";
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
 * commands a member runs in one of its agents, each only when pressed, from
 * the Run menu over the agent's tabs, behind the Run actions experiment: in
 * a cloud agent's sandbox, or on the Mac a local agent runs on, as each
 * action's availability allows; `PUT /api/workspaces/sandbox-setup/run-actions`
 * saves one repository's whole list in its order, to an owner or admin, an
 * empty list removing it, and `PATCH /api/workspaces/sandbox-setup/run-action`
 * adds, changes, moves, or removes one action of it, read and written
 * under the repository's lock so two edits at once both land. Every answer is the setup as it then stands, each
 * script with how it last ran in a sandbox where it has.
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

/** Which of the workspace's scripts a run was of: its install script, or a repository's setup or archive script. */
export const CLOUD_SETUP_SCRIPT = {
  INSTALL: "install",
  ...REPOSITORY_SCRIPT_KIND,
} as const;

export type CloudSetupScript = (typeof CLOUD_SETUP_SCRIPT)[keyof typeof CLOUD_SETUP_SCRIPT];

const scriptSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS),
);

/**
 * How a script last ran in a cloud sandbox: when it started, how it exited,
 * and the agent whose sandbox it ran in, whose Terminal reads what it
 * printed for as long as the sandbox stands. Facts alone, never what the
 * script printed, which may carry a workspace variable's value.
 */
const scriptRunSchema = EffectSchema.Struct({
  /** When the run started, in epoch milliseconds: a script saved since has not run as it stands. */
  ranAt: countedNumber,
  exitCode: EffectSchema.Int,
  /** The agent whose sandbox it ran in, by its id, its task's, and the name every place gives it. */
  agent: EffectSchema.Struct({
    id: EffectSchema.String,
    taskId: EffectSchema.String,
    name: EffectSchema.String,
  }),
});

export type CloudSetupScriptRun = typeof scriptRunSchema.Type;

const savedScriptSchema = EffectSchema.Struct({
  script: EffectSchema.String,
  /** When the script was last saved, in epoch milliseconds. */
  updatedAt: countedNumber,
  /** How the script, as saved now or before, last ran; absent where it never has, and from a service from before runs were kept. */
  lastRun: EffectSchema.optionalKey(scriptRunSchema),
});

const repositorySetupSchema = EffectSchema.Struct({
  ...savedScriptSchema.fields,
  /** `owner/name` as its latest save spelled it. */
  repository: EffectSchema.String,
});

/** Where a run action runs: in a cloud agent's sandbox, or on the Mac a local agent runs on. */
export const RUN_ACTION_PLACE = {
  CLOUD: "cloud",
  LOCAL: "local",
} as const;

export type RunActionPlace = (typeof RUN_ACTION_PLACE)[keyof typeof RUN_ACTION_PLACE];

/**
 * Where a run action may run: in cloud agents alone, in local agents alone,
 * or in both, which is what an action that says nothing means. It limits
 * where the action is offered and where it runs.
 */
export const RUN_ACTION_AVAILABILITY = {
  BOTH: "both",
  ...RUN_ACTION_PLACE,
} as const;

export type RunActionAvailability =
  (typeof RUN_ACTION_AVAILABILITY)[keyof typeof RUN_ACTION_AVAILABILITY];

const runActionAvailabilitySchema = EffectSchema.Literals(Object.values(RUN_ACTION_AVAILABILITY));

/** Where an action may run, both where it says nothing. */
export function runActionAvailability(action: {
  readonly availableIn?: RunActionAvailability | undefined;
}): RunActionAvailability {
  return action.availableIn ?? RUN_ACTION_AVAILABILITY.BOTH;
}

/** Whether an action may run in the place given. */
export function runActionRunsIn(
  action: { readonly availableIn?: RunActionAvailability | undefined },
  place: RunActionPlace,
): boolean {
  const availability = runActionAvailability(action);

  return availability === RUN_ACTION_AVAILABILITY.BOTH || availability === place;
}

/** The actions of a list that may run in the place given, in their order: the ones an agent there is offered. */
export function runActionsIn<
  Action extends { readonly availableIn?: RunActionAvailability | undefined },
>(actions: readonly Action[], place: RunActionPlace): Action[] {
  return actions.filter((action) => runActionRunsIn(action, place));
}

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

/**
 * One run action as it is kept: its id, which a run of it is known by while
 * the list around it changes, its label, its command, the icon it wears
 * where it wears one, a sidebar section's kind of icon, whether it is the
 * repository's default, the Run button's and ⌥⌘R's, and where it may run.
 */
export const runActionSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  label: EffectSchema.String,
  command: EffectSchema.String,
  icon: EffectSchema.optionalKey(looseTaskSectionIconSchema),
  /** Present, and true, on the list's one default; absent on every other action. */
  isDefault: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Where it may run (`RUN_ACTION_AVAILABILITY`); absent where it may run in both, and from a service older than the choice. */
  availableIn: EffectSchema.optionalKey(runActionAvailabilitySchema),
});

export type RunAction = typeof runActionSchema.Type;

const repositoryRunActionsSchema = EffectSchema.Struct({
  /** `owner/name` as its latest save spelled it. */
  repository: EffectSchema.String,
  /** Its actions in their order: the default is the Run button's, or the first where none is. */
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
  /** Absent from a service older than run actions, which reads as none. */
  runActions: EffectSchema.optionalKey(EffectSchema.Array(repositoryRunActionsSchema)),
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

/** One run action as a save names it: the id it was read with, to keep its runs known as it, or none for an action new to the list, which the service names; its icon, none for the menu's own; whether it is the default, the first so named being kept as it where several are; and where it may run, both where unsaid. */
const runActionPutSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(wireUuidSchema),
  label: runActionLabelSchema,
  command: runActionCommandSchema,
  icon: EffectSchema.optionalKey(taskSectionIconSchema),
  isDefault: EffectSchema.optionalKey(EffectSchema.Boolean),
  availableIn: EffectSchema.optionalKey(runActionAvailabilitySchema),
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

/**
 * Editing one of a repository's run actions (PATCH to `/run-action`), as
 * the service reads the list as it stands and writes it back: with no
 * `actionId` an action is added, naming its label and command; with one,
 * that action is changed, only in what the edit names, or removed. Making
 * one the default makes no other the default.
 */
export const workspaceRunActionEditRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  /** The action edited, by the id the setup answered; absent to add one. */
  actionId: EffectSchema.optionalKey(wireUuidSchema),
  /** True to remove the action `actionId` names, whatever else the edit names. */
  remove: EffectSchema.optionalKey(EffectSchema.Boolean),
  label: EffectSchema.optionalKey(runActionLabelSchema),
  command: EffectSchema.optionalKey(runActionCommandSchema),
  /** Its icon, or null for the menu's own. */
  icon: EffectSchema.optionalKey(EffectSchema.NullOr(taskSectionIconSchema)),
  /** True to make it the repository's default, false to make it no longer the default. */
  isDefault: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Its place in the list after the edit, from 0, a place past the end being the last: an added action is last and a changed one stays where it stood where unsaid. */
  position: EffectSchema.optionalKey(
    EffectSchema.Int.check(
      EffectSchema.isGreaterThanOrEqualTo(0),
      EffectSchema.isLessThanOrEqualTo(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS - 1),
    ),
  ),
});

export type WorkspaceRunActionEdit = typeof workspaceRunActionEditRequestSchema.Type;

/** An edit's answer: the setup as it then stands, and the id of the action it added or changed; none for a remove. */
export const workspaceRunActionEditAnswerSchema = EffectSchema.Struct({
  ...workspaceSandboxSetupAnswerSchema.fields,
  actionId: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceRunActionEditAnswer = typeof workspaceRunActionEditAnswerSchema.Type;
