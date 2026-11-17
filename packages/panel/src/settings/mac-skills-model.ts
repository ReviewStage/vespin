import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_REFUSAL,
  type InstalledSkillRefusal,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import { MAC_SKILL_APP_NAME } from "@repo/features/skills-settings-words";
import type { MacSkill, MacSkills } from "@repo/host/contract";

/**
 * mac-skills-model.ts -- Bring in from your Mac judged without drawing: what the Mac's skills folders offer, grouped by the folder that keeps them, and what is left out and why.
 *
 * The desktop reads the skills folders asked (`readMacSkills`): the one
 * agents share, and those of the agents the reader runs. This weighs what it
 * found against the reader's own skills: a skill whose name the reader
 * already has is left out, never renamed or overwritten, as other tools that
 * install skills do, and so is a second skill of a name found earlier. Each
 * folder that offers anything is a group of its own, and every skill left
 * out is listed apart, by the folder it was found in and why in a word or
 * two, so the member sees where each skill came from and which did not come.
 */

/** Why a skill on the Mac is left out: the install's own refusals, or a name the reader already has. */
export const MAC_SKILL_SKIPPED = {
  ...INSTALLED_SKILL_REFUSAL,
  /** The reader already has a skill of its name, or one of the Mac's took it first. */
  NAME_HELD: "name-held",
} as const;

export type MacSkillSkipped = (typeof MAC_SKILL_SKIPPED)[keyof typeof MAC_SKILL_SKIPPED];

/** What the dialog says that no row's data says. */
export const MAC_SKILLS_LINE = {
  ROW_LABEL: "Bring in from your Mac",
  ROW_DESCRIPTION: "Copy the skills already on your Mac, so every agent can use them.",
  LOOK: "Look for skills",
  TITLE: "Skills on your Mac",
  READING: "Reading your agents' skills folders",
  READ_FAILED: "Your Mac's skills folders could not be read.",
  LEFT_OUT: "Left out",
  NONE_FOUND: "No skills found in your agents' skills folders.",
  BRINGING: "Bringing in",
} as const;

/** One skill left out: its name, the folder it was found in by name, and why, in a word or two. */
export interface SkippedSkill {
  readonly name: string;
  readonly folder: string;
  readonly from: string;
  readonly why: string;
}

/** One skills folder that offers anything: its name, where it is, and what it offers. */
export interface MacSkillGroup {
  readonly app: MacSkillApp;
  readonly title: string;
  readonly folder: string;
  readonly offered: readonly MacSkill[];
}

/** The whole review: each folder that offers anything, every skill left out, and every skill offered in order. */
export interface MacSkillsReview {
  readonly groups: readonly MacSkillGroup[];
  readonly skipped: readonly SkippedSkill[];
  readonly offered: readonly MacSkill[];
}

/** Why a skill is left out, as its badge says it. */
function whyLeft(reason: MacSkillSkipped): string {
  switch (reason) {
    case MAC_SKILL_SKIPPED.NAME_HELD:
      return "Already have one";
    case MAC_SKILL_SKIPPED.NO_SKILL_FILE:
      return "No SKILL.md";
    case MAC_SKILL_SKIPPED.SKILL_FILE_INVALID:
      return "No name or description";
    case MAC_SKILL_SKIPPED.TOO_LARGE:
      return "Too large";
    case MAC_SKILL_SKIPPED.CREDENTIAL:
      return "Holds a credential";
  }
}

/** A skill left out, as its row draws it. */
function skippedOf(
  left: { readonly app: MacSkillApp; readonly name: string; readonly folder: string },
  reason: MacSkillSkipped,
): SkippedSkill {
  return {
    name: left.name,
    folder: left.folder,
    from: MAC_SKILL_APP_NAME[left.app],
    why: whyLeft(reason),
  };
}

/** What the Mac's skills folders offer the reader, weighed against the names of their own skills. */
export function macSkillsReview(
  read: MacSkills,
  personal: readonly InstalledSkillSummary[],
): MacSkillsReview {
  const taken = new Set(personal.map((skill) => skill.name));
  const offered: MacSkill[] = [];
  const skipped: SkippedSkill[] = [];

  for (const skill of read.skills) {
    if (taken.has(skill.name)) {
      skipped.push(skippedOf(skill, MAC_SKILL_SKIPPED.NAME_HELD));
      continue;
    }

    taken.add(skill.name);
    offered.push(skill);
  }

  for (const left of read.left) {
    skipped.push(skippedOf(left, left.reason satisfies InstalledSkillRefusal));
  }

  const groups = read.sources.map((source) => ({
    app: source.app,
    title: MAC_SKILL_APP_NAME[source.app],
    folder: source.folder,
    offered: offered.filter((each) => each.app === source.app),
  }));

  return { groups: groups.filter((group) => group.offered.length > 0), skipped, offered };
}

/** "3 skills", or "1 skill". */
export function skillCount(count: number): string {
  return `${count} skill${count === 1 ? "" : "s"}`;
}

/** The line over the review: how many it found to bring in, and how many it left out. */
export function summaryLine(review: MacSkillsReview): string {
  const left = review.skipped.length;
  const found = `Found ${skillCount(review.offered.length)} to bring in`;

  return left === 0 ? `${found}.` : `${found}, and left out ${left}.`;
}
