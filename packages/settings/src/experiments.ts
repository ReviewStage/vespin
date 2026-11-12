// experiments.ts -- the features a developer can turn on before they are finished, and how a choice of them is read.

import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/**
 * Every experiment's key: what its gate names, what the account stores its
 * choice under, and what it is counted as. A key is deleted when its feature
 * graduates, which is what makes every gate left behind fail to compile.
 */
export const EXPERIMENT = {
  /** A workspace's memory: its coding agents keep and recall facts with remember and recall, reviewed in Settings › Memory. */
  MEMORY: "memory",
  /** Skills: the skills a member installs into the app for their agents, managed in Settings › Skills, and the `/` list of skills in a box written to an agent. */
  SKILLS: "skills",
  /** Descriptions: a task's description its coding agents keep current as they work, its comments and version history, and the tools and instructions they write it and answer its comments with. */
  DESCRIPTIONS: "descriptions",
  /** Rewind restores files: a rewind or an edit of a message may put the agent's files back as they stood before it, from the checkout its runner records before each turn. */
  REWIND_FILES: "rewind-files",
  /** Done and follow-ups: an agent ends a turn with a short summary, and the bar over its box says what it needs from you, or that it is done, with what is still open and the follow-ups it offers. */
  TURN_END: "turn-end",
  /** Run actions: each repository's commands, kept in Settings › Cloud environment, that a member runs from the Run button over an agent's tabs, ⌘K, or a phone's ⋯: in a cloud agent's sandbox, or on the Mac a local agent runs on, as each action allows. */
  RUN_ACTIONS: "run-actions",
  /** Merge queue: every pull request GitHub's merge queues hold across the repositories the workspace's tasks work in, on a page of its own. */
  MERGE_QUEUE: "merge-queue",
} as const;

export type Experiment = (typeof EXPERIMENT)[keyof typeof EXPERIMENT];

/** Whose choice an experiment is: a workspace's, made by its admins for every member and agent in it, or each account's own. */
export const EXPERIMENT_SCOPE = {
  WORKSPACE: "workspace",
  ACCOUNT: "account",
} as const;

export type ExperimentScope = (typeof EXPERIMENT_SCOPE)[keyof typeof EXPERIMENT_SCOPE];

/**
 * The experiments a workspace turns on for everyone in it: each changes what
 * its members share and what every agent in it reads and writes, so one
 * member's choice cannot stand apart from another's. Every experiment not
 * listed here is each account's own.
 */
export const WORKSPACE_EXPERIMENT_LIST = [
  EXPERIMENT.REWIND_FILES,
  EXPERIMENT.RUN_ACTIONS,
  EXPERIMENT.DESCRIPTIONS,
  EXPERIMENT.MEMORY,
  EXPERIMENT.TURN_END,
] as const;

export type WorkspaceExperiment = (typeof WORKSPACE_EXPERIMENT_LIST)[number];

export type AccountExperiment = Exclude<Experiment, WorkspaceExperiment>;

const isWorkspaceExperimentKey = Schema.is(Schema.Literals(WORKSPACE_EXPERIMENT_LIST));

/** Whether an experiment is a workspace's choice rather than an account's. */
export function isWorkspaceExperiment(experiment: Experiment): experiment is WorkspaceExperiment {
  return isWorkspaceExperimentKey(experiment);
}

/** Whose choice an experiment is. */
export function experimentScope(experiment: Experiment): ExperimentScope {
  return isWorkspaceExperiment(experiment) ? EXPERIMENT_SCOPE.WORKSPACE : EXPERIMENT_SCOPE.ACCOUNT;
}

/** One experiment as the Experimental page lists it. */
export interface ExperimentEntry {
  readonly key: Experiment;
  /** The feature's own name, as the row and its gated surfaces call it. */
  readonly name: string;
  /** One line on what turning it on brings. */
  readonly detail: string;
  /** Who decides when it graduates or goes. */
  readonly owner: string;
  /** The day it was added, so a release's review sees how long each one has stood. */
  readonly since: string;
}

/**
 * The experiments standing now, newest first: the order the Experimental page
 * lists them. An entry exists only while its feature is experimental, so
 * there is no status to drift and every experiment is off until turned on.
 */
export const EXPERIMENTS = [
  {
    key: EXPERIMENT.MERGE_QUEUE,
    name: "Merge queue",
    detail:
      "See every pull request waiting in GitHub's merge queues across your workspace's repositories, with the task each belongs to.",
    owner: "Charles",
    since: "2026-11-12",
  },
  {
    key: EXPERIMENT.REWIND_FILES,
    name: "Rewind restores files",
    detail:
      "Rewinding or editing a message can also put the agent's files back to how they stood before it.",
    owner: "Dean",
    since: "2026-11-10",
  },
  {
    key: EXPERIMENT.TURN_END,
    name: "Done and follow-ups",
    detail:
      "When an agent finishes, the bar over its box says what it needs from you, or that it's done, with follow-ups to send.",
    owner: "Dean",
    since: "2026-11-10",
  },
  {
    key: EXPERIMENT.RUN_ACTIONS,
    name: "Run actions",
    detail:
      "Keep each repository's commands, such as its dev server, in Cloud environment, " +
      "and run one in a cloud agent's sandbox from the Run button over its tabs or ⌘K.",
    owner: "Dean",
    since: "2026-11-10",
  },
  {
    key: EXPERIMENT.DESCRIPTIONS,
    name: "Task descriptions",
    detail: "Tasks get a description their agents keep up to date, with comments and history.",
    owner: "Dean",
    since: "2026-11-05",
  },
  {
    key: EXPERIMENT.SKILLS,
    name: "Skills",
    detail: "Install skills for your agents, and use one by typing / in a message.",
    owner: "Charles",
    since: "2026-10-30",
  },
  {
    key: EXPERIMENT.MEMORY,
    name: "Memory",
    detail: "Agents remember how your team works and use it in later tasks.",
    owner: "Dean",
    since: "2026-10-23",
  },
] as const satisfies readonly ExperimentEntry[];

/**
 * What an account has chosen: each experiment it turned on or back off.
 * An experiment it never touched is absent, which reads as off.
 */
export type ExperimentChoices = Readonly<Partial<Record<Experiment, boolean>>>;

/** No experiment chosen: every one off. */
export const NO_EXPERIMENTS: ExperimentChoices = {};

/** Whether a value names an experiment this build lists. */
export const isExperiment = Schema.is(Schema.Literals(Object.values(EXPERIMENT)));
const isChoice = Schema.is(Schema.Boolean);
const choicesRecord = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A choice of experiments as it arrives from the account's store or across
 * the wire, keeping every known experiment's on or off and ignoring the
 * rest. It refuses nothing but a value that is not a record at all: a key it
 * does not know is a newer build's experiment or a graduated one's, and
 * refusing the whole answer over it would cost an older Mac every choice it
 * does know.
 */
export function experimentChoicesFrom(value: UnparsedWireValue): ExperimentChoices | undefined {
  const decoded = Schema.decodeUnknownOption(choicesRecord)(value);

  if (Option.isNone(decoded)) return undefined;
  const choices: Partial<Record<Experiment, boolean>> = {};

  for (const [key, choice] of Object.entries(decoded.value)) {
    if (isExperiment(key) && isChoice(choice)) choices[key] = choice;
  }

  return choices;
}

/** What an account has chosen of its own experiments, with every workspace experiment its store still keeps for an older build left out. */
export type AccountExperimentChoices = { readonly [Key in AccountExperiment]?: boolean };

/** What a workspace's owners and admins have chosen for everyone in it; an experiment never chosen is absent, which reads as off. */
export type WorkspaceExperimentChoices = { readonly [Key in WorkspaceExperiment]?: boolean };

/** No workspace experiment chosen: every one off. */
export const NO_WORKSPACE_EXPERIMENTS: WorkspaceExperimentChoices = {};

/**
 * An account's choices of its own experiments alone. Note that its store
 * keeps its old choice of a workspace experiment for an older build, which
 * must never be read as the workspace's.
 */
export function accountExperimentChoices(choices: ExperimentChoices): AccountExperimentChoices {
  return Object.fromEntries(
    Object.entries(choices).filter(([key]) => isExperiment(key) && !isWorkspaceExperiment(key)),
  );
}

/**
 * A workspace's choices as its entry on the list carries them, keeping each
 * workspace experiment's on or off and ignoring a key this build does not
 * list as one, a newer build's or a graduated one's.
 */
export function workspaceExperimentChoicesFrom(
  entries: readonly { readonly experiment: string; readonly on: boolean }[] | undefined,
): WorkspaceExperimentChoices {
  const choices: Partial<Record<WorkspaceExperiment, boolean>> = {};

  for (const { experiment, on } of entries ?? []) {
    if (isWorkspaceExperimentKey(experiment)) choices[experiment] = on;
  }

  return choices;
}

/**
 * The experiments on where a member works in one workspace: the account's
 * choice of its own experiments, and the workspace's of the workspace's.
 */
export function experimentsIn(
  account: ExperimentChoices,
  workspace: WorkspaceExperimentChoices,
): ExperimentChoices {
  return { ...accountExperimentChoices(account), ...workspace };
}

/**
 * Whether a choice has an experiment on. Note that the experiment is one the
 * choice can hold, so an account's choices refuse a workspace experiment at
 * compile time rather than reading it as off.
 */
export function experimentOn<Key extends Experiment>(
  choices: { readonly [Each in Key]?: boolean },
  experiment: NoInfer<Key>,
): boolean {
  return choices[experiment] === true;
}
