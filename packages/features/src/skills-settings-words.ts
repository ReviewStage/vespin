/**
 * skills-settings-words.ts -- what Settings › Skills says, and how it groups and lines the account's skills, on the desktop, the web, and the iOS app alike.
 *
 * The page lists the workspace's skills, then the account's own, because
 * whose a skill is decides who may change it and whose agents load it. Each
 * row says where its files came from, a GitHub folder at the commit it is
 * pinned to or a paste, and who installed it. Every refusal the service
 * names is said here in plain words, once.
 */

import type { InstalledSkillSummary } from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
  type InstalledSkillFailedView,
} from "./installed-skill-view.js";
import {
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillSource,
} from "./installed-skill-wire.js";
import { fencedBlock } from "./markdown-fence.js";
import { TASK_SKILL_SOURCE, type TaskSkillSource } from "./task-wire.js";
import type { Workspace, WorkspaceMember } from "./workspace-wire.js";

/** How many characters of a commit a row shows. */
const SHORT_SHA = 7;

/** What the page and the dialog say that no row's data says. */
export const SKILLS_LINE = {
  PERSONAL: "Only you",
  PASTED: "Pasted",
  NONE: "No skills installed yet.",
  READ_FAILED: "Your skills could not be read.",
  ADD_SKILL: "Add skill",
  PASTE_LABEL: "GitHub repository or SKILL.md text",
  PASTE_HINT:
    "Paste owner/repo, a GitHub link to a repository or skill folder, an npx skills add line, or a skill's SKILL.md text.",
  READING: "Reading…",
  UNSUPPORTED: "Only GitHub repositories.",
  INSTALL: "Install",
  INSTALL_FOR: "Install for",
  ONLY_YOU: "Only you",
  VIEW: "Open",
  REMOVE: "Delete",
  FILES: "Files",
  VIEW_FAILED: "The skill could not be read.",
  SEARCH: "Search skills",
  NAME: "Name",
  NAME_HINT: "Lowercase words joined by hyphens, such as pr-style.",
  WHEN: "When should agents use it?",
  NO_MATCH: "No skills match.",
} as const;

/** The workspace's group heading. */
export function workspaceGroupTitle(workspace: Pick<Workspace, "name">): string {
  return workspace.name;
}

/** "Everyone in Stage": the dialog's workspace scope, named for the workspace. */
export function everyoneIn(workspace: Pick<Workspace, "name">): string {
  return `Everyone in ${workspace.name}`;
}

/** Where a skill's files came from: `owner/repo @ 3f9c2e1`, or Pasted. */
function sourceLine(source: InstalledSkillSource): string {
  if (source.type === INSTALLED_SKILL_SOURCE.TEXT) return SKILLS_LINE.PASTED;

  return `${source.owner}/${source.repo} @ ${source.sha.slice(0, SHORT_SHA)}`;
}

/* ----- The page ----- */

/** One skill's row as the page draws it. */
export interface SkillRow {
  readonly skill: InstalledSkillSummary;
  /** Whose it is, which its source badge says at its end and its card's head. */
  readonly source: TaskSkillSource;
  /** Where its files came from, and who installed it where that is someone else. */
  readonly line: string;
}

/** The page's two groups, the workspace's first; a group with no rows is still listed, for its heading. */
export interface SkillGroups {
  readonly workspace: readonly SkillRow[];
  readonly personal: readonly SkillRow[];
}

/** Who installed a skill as its line names them: by name where the members say, you for the reader, nobody once gone. */
function installerOf(
  skill: InstalledSkillSummary,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): string | undefined {
  if (skill.installedBy === null) return undefined;

  if (skill.installedBy === readerId) return "you";

  return members?.find((each) => each.userId === skill.installedBy)?.name;
}

/** One skill's row: its source and its line, where its files came from then who installed it. */
function rowOf(
  skill: InstalledSkillSummary,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): SkillRow {
  const workspace = skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE;
  const installer = workspace ? installerOf(skill, readerId, members) : undefined;

  return {
    skill,
    source: workspace ? TASK_SKILL_SOURCE.WORKSPACE : TASK_SKILL_SOURCE.PERSONAL,
    line:
      installer === undefined
        ? sourceLine(skill.source)
        : `${sourceLine(skill.source)} · by ${installer}`,
  };
}

/**
 * The skills as the page groups them: the workspace's, then the account's
 * own, each by name. A personal skill's installer is always the reader, so
 * only a workspace row names who installed it.
 */
export function skillGroups(
  skills: readonly InstalledSkillSummary[],
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
): SkillGroups {
  const sorted = [...skills].sort((one, other) => one.name.localeCompare(other.name));
  const rows = sorted.map((skill) => rowOf(skill, readerId, members));

  return {
    workspace: rows.filter((row) => row.skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE),
    personal: rows.filter((row) => row.skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL),
  };
}

/* ----- A row's menu ----- */

/** What a row's ⋯ may hold. */
export const SKILL_ACTION = {
  VIEW: "view",
  REMOVE: "remove",
} as const;

export type SkillAction = (typeof SKILL_ACTION)[keyof typeof SKILL_ACTION];

/**
 * What a row's ⋯ holds: View for every row, since anyone who sees a skill
 * may read it; then, a rule apart, Remove. A row the account may not
 * remove holds View alone.
 */
export function skillActions(row: SkillRow): readonly (readonly SkillAction[])[] {
  if (!row.skill.manageable) return [[SKILL_ACTION.VIEW]];

  return [[SKILL_ACTION.VIEW], [SKILL_ACTION.REMOVE]];
}

type RemoveQuestionResult = {
  readonly title: string;
  readonly body: string;
  readonly verb: string;
  readonly running: string;
};

/** What Remove asks first: the skill and its files are deleted, past undoing; a workspace skill is every member's agents', so it says whose. */
export function removeSkillQuestion(
  skill: Pick<InstalledSkillSummary, "name" | "scope">,
  workspace: Pick<Workspace, "name">,
): RemoveQuestionResult {
  const shared = skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE;

  return {
    title: `Delete ${skill.name}?`,
    body: shared
      ? `${everyoneIn(workspace)} loses ${skill.name}: agents they start afterwards no longer load it, and its files are deleted.`
      : "Its files are deleted, and agents started afterwards no longer load it. Installing it again takes the paste again.",
    verb: "Delete skill",
    running: "Deleting",
  };
}

/**
 * A skill's `SKILL.md` as Markdown that draws it as written: one fenced
 * block, its fence a backtick longer than any run of them in the text, so
 * nothing inside can close it early, and its trailing newlines left out so
 * the block ends on its last line.
 */
export function fencedSkillFile(text: string): string {
  return fencedBlock(text.replace(/\n+$/u, ""), "markdown");
}

/* ----- Words for what went wrong ----- */

/** What a failed call says, each after the skill it names where the service named one. */
const FAILURE_WORDS = {
  [INSTALLED_SKILL_CALL_FAILURE.UNANSWERED]: () =>
    "Could not connect. Check your internet connection and try again.",
  [INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND]: () =>
    "That skill or workspace is no longer yours to reach.",
  [INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED]: () =>
    "Only whoever installed this skill, or the workspace's owners and admins, can remove it.",
  [INSTALLED_SKILL_CALL_FAILURE.INVALID]: () =>
    "The skill could not be installed. Check what you pasted.",
  [INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN]: (skill: string) =>
    `${skill} is already installed there. Remove it first, or install for the other scope.`,
  [INSTALLED_SKILL_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: () =>
    "That repository or branch could not be reached on GitHub. A private repository needs the workspace's GitHub connected.",
  [INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED]: () =>
    "GitHub didn't answer, or is limiting requests. Try again later.",
  [INSTALLED_SKILL_CALL_FAILURE.NO_SKILL_FILE]: (skill: string) =>
    `${skill} has no SKILL.md in its folder.`,
  [INSTALLED_SKILL_CALL_FAILURE.SKILL_FILE_INVALID]: (skill: string) =>
    `${skill} needs a valid name and a description in its SKILL.md.`,
  [INSTALLED_SKILL_CALL_FAILURE.TOO_LARGE]: (skill: string) => `${skill} is too large to install.`,
  [INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL]: (skill: string) =>
    `${skill} holds what looks like a credential. A skill must never carry one.`,
} as const satisfies Record<InstalledSkillCallFailure, (skill: string) => string>;

/** What a failed call says, naming the skill where the service did. */
export function failureLine(
  failed: Pick<InstalledSkillFailedView, "failure" | "skillName">,
): string {
  return FAILURE_WORDS[failed.failure](failed.skillName ?? "This skill");
}
