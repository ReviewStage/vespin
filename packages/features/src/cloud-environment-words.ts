/**
 * cloud-environment-words.ts -- what Settings › Cloud environment says of a workspace's sandbox size, variables, and scripts, and how a variable's line and a script's last run read, on the desktop, the web, and the iOS app alike.
 */

import { RUNNER_ENV } from "@repo/agent-runner/protocol";
import { Schema } from "effect";
import { PRODUCT_NAME } from "./product-name.js";
import {
  type WorkspaceVariable,
  workspaceVariableNameSchema,
} from "./workspace-environment-wire.js";
import type { CloudSetupScriptRun } from "./workspace-sandbox-setup-wire.js";

/** Each section's heading, in the page's order. */
export const CLOUD_ENVIRONMENT_HEAD = {
  SANDBOX: "Sandbox",
  VARIABLES: "Variables",
  INSTALL: "Install software",
  SETUP: "Setup scripts",
} as const;

/** What Sandbox says: its caption, its row, and why a member who is no owner or admin cannot change it. */
export const SANDBOX_SIZE_WORDS = {
  CAPTION: "Running cloud agents switch to a new size the next time they start.",
  SIZE: "Size",
  DEFAULT: "Default",
  LOCKED: "Only an owner or admin can change this",
  READ_FAILED: "The sandbox size could not be read.",
} as const;

/** What Variables says of the variables themselves, wherever they are listed. */
export const VARIABLE_WORDS = {
  CAPTION: "Cloud agents, setup scripts, and run actions start with these.",
  NONE: "No variables yet.",
  READ_FAILED: "The variables could not be read.",
  ADDED: "Added",
  UPDATED: "Updated",
  BY: "by",
  DELETE: "Delete variable",
  ADD: "Add variable",
  NEXT: "Next",
  VALUE: "Value",
  NAME_SPELLING: "Use letters, digits, and _, not starting with a digit.",
} as const;

/** What a secret is, as Add's choice of kind says it. */
export const SECRET_VARIABLE_WORDS = {
  LABEL: "Secret",
  DETAIL: "Its value is hidden once it's saved. Agents still get it.",
} as const;

/** What the scripts' sections say. */
export const CLOUD_SCRIPT_WORDS = {
  INSTALL_CAPTION: "Installs tools in every new cloud sandbox. Runs with sudo.",
  INSTALL_NONE: "No install script yet.",
  INSTALL_NAME: "Install script",
  SETUP_CAPTION: "Run in each new cloud sandbox after its repository is checked out.",
  SETUP_NONE: "No setup scripts yet.",
  READ_FAILED: "The scripts could not be read.",
  NOT_RUN_SINCE: "Hasn't run since it was saved.",
} as const;

/**
 * The names we set for our own agents as each launches, which replace a
 * workspace variable of the same name (`runner-sessions.ts`'s launch, its
 * own after the workspace's), each with what its mark says.
 */
const SET_BY_VESPIN: ReadonlyMap<string, string> = new Map([
  [
    RUNNER_ENV.API_KEY,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.API_KEY} for agents on an Anthropic API key, replacing this value.`,
  ],
  [
    RUNNER_ENV.OPENAI_API_KEY,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.OPENAI_API_KEY} for agents on an OpenAI API key, replacing this value.`,
  ],
  [
    RUNNER_ENV.CLAUDE_TOKEN,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.CLAUDE_TOKEN} for Claude agents on a plan, replacing this value.`,
  ],
  [
    RUNNER_ENV.BEARER,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.BEARER} for every agent, so agents never see this value.`,
  ],
]);

/** What a variable's mark says where we set its name for our agents ourselves; none for any other name. */
export function setByVespinNote(name: string): string | undefined {
  return SET_BY_VESPIN.get(name);
}

/** When a variable was added, or last set where a service before it answers no add. */
export function variableCreatedAt(variable: WorkspaceVariable): number {
  return variable.createdAt ?? variable.updatedAt;
}

/** Whether a variable changed since it was added, which its line says as Updated. */
export function variableChanged(variable: WorkspaceVariable): boolean {
  return variable.updatedBy !== undefined || variable.updatedAt > variableCreatedAt(variable);
}

/** The member a variable's line names: who last changed it, or who added it until it changed. */
export function variableChanger(variable: WorkspaceVariable): WorkspaceVariable["createdBy"] {
  return variableChanged(variable) ? variable.updatedBy : variable.createdBy;
}

/** The word a variable's line opens with: Updated once it changed, Added until then. */
export function variableChangeWord(variable: WorkspaceVariable): string {
  return variableChanged(variable) ? VARIABLE_WORDS.UPDATED : VARIABLE_WORDS.ADDED;
}

/** What deleting the variable called `name` asks first. */
export function variableDeleteTitle(name: string): string {
  return `Delete ${name}?`;
}

/** Whether a name is one the service takes. */
const isVariableName = Schema.is(workspaceVariableNameSchema);

/**
 * Why a variable cannot be added under `name` beside the variables saved,
 * or none where it can: a name the service would refuse, or one saved
 * already, which an add that asks no kind leaves to be replaced where its
 * kind is chosen, so a secret is never overwritten by a slip.
 */
export function variableAddProblem(
  name: string,
  saved: readonly WorkspaceVariable[],
): string | undefined {
  if (!isVariableName(name)) return VARIABLE_WORDS.NAME_SPELLING;

  if (saved.some((variable) => variable.name === name)) return `${name} is saved already.`;

  return undefined;
}

/**
 * How a saved script last ran, in words: that it has not run since it was
 * saved where its last run is older than the save, since what ran is no
 * longer what is saved, or when, in which agent's sandbox, and how it
 * exited, `ran` saying when as its reader tells time.
 */
export function scriptLastRunWords(run: CloudSetupScriptRun, savedAt: number, ran: string): string {
  if (run.ranAt < savedAt) return CLOUD_SCRIPT_WORDS.NOT_RUN_SINCE;

  return `Last ran ${ran} in ${run.agent.name}, exited ${run.exitCode}`;
}
