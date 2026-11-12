import type {
  InstalledSkillCandidate,
  InstalledSkillPreview,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import { SKILL_PASTE_KIND } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
  type InstalledSkillFailedView,
  type InstalledSkillInstallParams,
} from "@repo/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
} from "@repo/features/installed-skill-wire";
import { formatBytes } from "@repo/features/number-format";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { SKILL_NAME_RULE } from "@repo/features/skill-file";
import {
  everyoneIn,
  failureLine,
  removeSkillQuestion,
  SKILLS_LINE,
} from "@repo/features/skills-settings-words";
import { readFailedWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { CONFIRM_LOSS, STATUS_TONE } from "@repo/ui";

/**
 * skills-model.ts -- Settings › Skills and its Add skill dialog as the window draws them, judged without drawing: a Delete's weight, a skill's file, and what a paste would install, over the page's shared words and rows (`@repo/features/skills-settings-words`).
 *
 * The page lists the workspace's skills, then the account's own, the same
 * split the Automations list makes, because whose a skill is decides who
 * may change it and whose agents load it. Each row says where its files
 * came from, a GitHub folder at the commit it is pinned to or a paste, and
 * who installed it. The dialog draws the service's preview of its one box:
 * a GitHub source's skills as one list to tick, or a skill's text as its
 * name and description to fill in, and what Install sends. Every refusal
 * the service names is said here in plain words, once.
 */

/** How many skills a source lists before the list offers a search. */
const SEARCHED_FROM = 8;

/**
 * What Remove asks first (`removeSkillQuestion`): a personal skill's
 * question is red, since its files are deleted past undoing; a workspace
 * skill's asks in the accent, as any act on others does.
 */
export function removeQuestion(
  skill: Pick<InstalledSkillSummary, "name" | "scope">,
  workspace: Pick<Workspace, "name">,
) {
  return {
    ...removeSkillQuestion(skill, workspace),
    loss:
      skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE
        ? CONFIRM_LOSS.AFFECTS_OTHERS
        : CONFIRM_LOSS.IRREVERSIBLE,
  };
}

/* ----- The dialog ----- */

/** The line under the box. */
export interface DetectedLine {
  readonly text: string;
  readonly tone: typeof STATUS_TONE.NEUTRAL | typeof STATUS_TONE.ATTENTION;
}

/** The failures of a preview that asking again may get past: the service was not reached, or GitHub did not answer. */
const RETRYABLE_FAILURES: ReadonlySet<InstalledSkillCallFailure> = new Set([
  INSTALLED_SKILL_CALL_FAILURE.UNANSWERED,
  INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED,
]);

/** Whether a failed preview offers Retry. */
export function previewRetries(failed: { readonly failure: InstalledSkillCallFailure }): boolean {
  return RETRYABLE_FAILURES.has(failed.failure);
}

/**
 * What the line under the box says of a preview, or of its wait: why it
 * failed, a paste we do not install from, or a repository with no skill;
 * nothing where the preview has something to show.
 */
export function previewLine(
  view: InstalledSkillPreview | InstalledSkillFailedView | undefined,
): DetectedLine | undefined {
  if (view === undefined) return { text: SKILLS_LINE.READING, tone: STATUS_TONE.NEUTRAL };

  if ("failure" in view) {
    const text =
      view.failure === INSTALLED_SKILL_CALL_FAILURE.UNANSWERED
        ? readFailedWords("that paste")
        : failureLine(view);

    return { text, tone: STATUS_TONE.ATTENTION };
  }

  if (view.kind === SKILL_PASTE_KIND.UNSUPPORTED) {
    return { text: SKILLS_LINE.UNSUPPORTED, tone: STATUS_TONE.ATTENTION };
  }

  if (view.kind !== SKILL_PASTE_KIND.SOURCE || view.skills.length > 0) return undefined;

  return { text: `No skills found in ${view.owner}/${view.repo}.`, tone: STATUS_TONE.ATTENTION };
}

/** The skills ticked as a preview lands: the ones the paste named, or the one skill there is. */
export function initialTicks(preview: InstalledSkillPreview | undefined): ReadonlySet<string> {
  if (preview?.kind !== SKILL_PASTE_KIND.SOURCE) return new Set();

  return new Set(preview.skills.filter((each) => each.selected).map((each) => each.name));
}

/** Whether a source's list offers a search, as it does once it is long. */
export function searchesSkills(skills: readonly InstalledSkillCandidate[]): boolean {
  return skills.length > SEARCHED_FROM;
}

/** The skills the search shows: each word of it in the name or the description, in any case. */
export function shownSkills(
  skills: readonly InstalledSkillCandidate[],
  query: string,
): readonly InstalledSkillCandidate[] {
  const tokens = searchTokens(query);

  return skills.filter((each) => matchesTokens([each.name, each.description ?? ""], tokens));
}

/** Where a found skill is and how large: "skills/review · 1.2 kB". */
export function candidateFacts(candidate: InstalledSkillCandidate): string {
  const where = candidate.path === "" ? "repository root" : candidate.path;

  return `${where} · ${formatBytes(candidate.bytes)}`;
}

/** The primary button's words: what Install will do. */
export function installLabel(install: readonly string[]): string {
  const [only] = install;

  if (only === undefined) return SKILLS_LINE.INSTALL;

  return install.length === 1 ? `Install ${only}` : `Install ${install.length} skills`;
}

/** The scopes the dialog offers: the account's own, and the workspace's to any member outside a personal workspace. */
export function installScopes(
  workspace: Workspace,
): readonly { readonly value: InstalledSkillScope; readonly label: string }[] {
  const mine = { value: INSTALLED_SKILL_SCOPE.PERSONAL, label: SKILLS_LINE.ONLY_YOU };

  if (workspace.personal === true) return [mine];

  return [mine, { value: INSTALLED_SKILL_SCOPE.WORKSPACE, label: everyoneIn(workspace) }];
}

/** A skill's text's name and description as the dialog's fields hold them. */
export interface TextFill {
  readonly name: string;
  readonly description: string;
}

/** The fields as a text's preview lands: what its frontmatter declares, else empty. */
export function textFill(preview: InstalledSkillPreview | undefined): TextFill {
  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return { name: "", description: "" };

  return { name: preview.name ?? "", description: preview.description ?? "" };
}

/**
 * The install the dialog's state asks for, or nothing while it would
 * install nothing: a source with nothing ticked, text whose name breaks
 * the rule or whose description is empty, or a preview not yet in. The
 * paste goes again whole, since the service reads it afresh, with the
 * commit the preview pinned.
 */
export function installRequest(state: {
  readonly workspaceId: string;
  readonly text: string;
  readonly scope: InstalledSkillScope;
  readonly preview: InstalledSkillPreview | undefined;
  readonly ticked: ReadonlySet<string>;
  readonly fill: TextFill;
}): InstalledSkillInstallParams | undefined {
  const { workspaceId, text, scope, preview, ticked, fill } = state;
  const base = { text, workspaceId, scope };

  if (preview?.kind === SKILL_PASTE_KIND.SOURCE) {
    const skills = preview.skills.filter((each) => ticked.has(each.name)).map((each) => each.name);

    return skills.length === 0 ? undefined : { ...base, skills, sha: preview.sha };
  }

  if (preview?.kind !== SKILL_PASTE_KIND.TEXT) return undefined;
  const name = fill.name.trim();
  const description = fill.description.trim();

  if (!SKILL_NAME_RULE.test(name) || description === "") return undefined;

  return { ...base, name, description };
}
