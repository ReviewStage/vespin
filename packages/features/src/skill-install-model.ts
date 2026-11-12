/**
 * skill-install-model.ts -- Settings › Skills' Add skill judged without drawing, on the desktop, the web, and the iOS app alike: what the line under the paste says of its preview, the skills ticked as it lands, the search over a long list, each found skill's facts, Install's words, whom it installs for, and what Install sends.
 *
 * The service previews the one box: a GitHub source's skills as one list
 * to tick, or a skill's text as its name and description to fill in. Every
 * refusal the service names is said here in plain words, once
 * (`failureLine`).
 */

import type {
  InstalledSkillCandidate,
  InstalledSkillPreview,
} from "./installed-skill-route-wire.js";
import { SKILL_PASTE_KIND } from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
  type InstalledSkillFailedView,
  type InstalledSkillInstallParams,
} from "./installed-skill-view.js";
import { INSTALLED_SKILL_SCOPE, type InstalledSkillScope } from "./installed-skill-wire.js";
import { formatBytes } from "./number-format.js";
import { matchesTokens, searchTokens } from "./search-tokens.js";
import { SKILL_NAME_RULE } from "./skill-file.js";
import { everyoneIn, failureLine, SKILLS_LINE } from "./skills-settings-words.js";
import { readFailedWords } from "./words.js";
import type { Workspace } from "./workspace-wire.js";

/** How many skills a source lists before the list offers a search. */
const SEARCHED_FROM = 8;

/** How the line under the box reads: plain while it waits, or a problem that wants the reader. */
export const SKILL_LINE_TONE = {
  NEUTRAL: "neutral",
  ATTENTION: "attention",
} as const;

export type SkillLineTone = (typeof SKILL_LINE_TONE)[keyof typeof SKILL_LINE_TONE];

/** The line under the box. */
export interface DetectedLine {
  readonly text: string;
  readonly tone: SkillLineTone;
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
  if (view === undefined) return { text: SKILLS_LINE.READING, tone: SKILL_LINE_TONE.NEUTRAL };

  if ("failure" in view) {
    const text =
      view.failure === INSTALLED_SKILL_CALL_FAILURE.UNANSWERED
        ? readFailedWords("that paste")
        : failureLine(view);

    return { text, tone: SKILL_LINE_TONE.ATTENTION };
  }

  if (view.kind === SKILL_PASTE_KIND.UNSUPPORTED) {
    return { text: SKILLS_LINE.UNSUPPORTED, tone: SKILL_LINE_TONE.ATTENTION };
  }

  if (view.kind !== SKILL_PASTE_KIND.SOURCE || view.skills.length > 0) return undefined;

  return {
    text: `No skills found in ${view.owner}/${view.repo}.`,
    tone: SKILL_LINE_TONE.ATTENTION,
  };
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
