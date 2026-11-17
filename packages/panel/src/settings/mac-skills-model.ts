import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import type { MacSkillApp } from "@repo/features/installed-skill-wire";
import { SKILL_FILE_BOUNDS } from "@repo/features/skill-file";
import { MAC_SKILL_APP_NAME } from "@repo/features/skills-settings-words";
import {
  MAC_SKILL_LEFT,
  type MacSkill,
  type MacSkillLeft,
  type MacSkills,
} from "@repo/host/contract";
import { Result } from "effect";
import { Base64 } from "effect/encoding";

/**
 * mac-skills-model.ts -- Bring in from your Mac judged without drawing: what the Mac's skills folders offer, grouped by the agent that keeps them, what is left out and why, and the name each skill comes in under.
 *
 * The desktop reads the skills folders asked (`readMacSkills`): the one
 * agents share, and those of the agents the reader runs. This weighs what it
 * found against the reader's own skills. A skill whose name the reader
 * already has, with the same `SKILL.md` and the same files, is left out as
 * already installed; one whose name is taken by a different skill, the
 * reader's or one offered before it, comes in under the name with the first
 * free number after it (`release-notes-2`). Each folder that offers anything
 * is a group of its own, and every skill left out is listed apart, by the
 * folder it was found in and why in a word or two, so the member sees where
 * each skill came from and which did not come.
 */

/** Why a skill on the Mac is left out: the Mac's reasons, or one the reader's own skills make. */
export const MAC_SKILL_SKIPPED = {
  ...MAC_SKILL_LEFT,
  /** The reader has a skill of its name with the same `SKILL.md` and files. */
  ALREADY_INSTALLED: "already-installed",
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
  RENAMED: "Renamed",
  BRINGING: "Bringing in",
  UNDO: "Undo",
} as const;

/** One skill the Mac offers: the skill as read, and the name it comes in under, with the name it was read by where that differs. */
export interface OfferedSkill {
  readonly skill: MacSkill;
  readonly name: string;
  readonly renamedFrom?: string;
}

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
  readonly offered: readonly OfferedSkill[];
}

/** The whole review: each folder that offers anything, every skill left out, and every skill offered in order. */
export interface MacSkillsReview {
  readonly groups: readonly MacSkillGroup[];
  readonly skipped: readonly SkippedSkill[];
  readonly offered: readonly OfferedSkill[];
}

/** Why a skill is left out, as its badge says it. */
function whyLeft(reason: MacSkillSkipped, app: MacSkillApp): string {
  switch (reason) {
    case MAC_SKILL_SKIPPED.ALREADY_INSTALLED:
      return "Already installed";
    case MAC_SKILL_SKIPPED.SAME_FOLDER:
      return "Already listed";
    case MAC_SKILL_SKIPPED.APP_OWN:
      return `Built into ${MAC_SKILL_APP_NAME[app]}`;
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
    why: whyLeft(reason, left.app),
  };
}

/** A file's bytes from base64; none where the base64 is not. */
function bytesOf(base64: string): Uint8Array | undefined {
  const decoded = Base64.decode(base64);

  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** Whether the skill read from the Mac holds the same `SKILL.md` and files as the one installed. */
export function sameFiles(skill: MacSkill, installed: InstalledSkillContent): boolean {
  const sizes = skill.files.map((file) => ({ path: file.path, bytes: bytesOf(file.base64) }));
  const main = sizes.find((file) => file.path === "SKILL.md")?.bytes;

  if (main === undefined || new TextDecoder().decode(main) !== installed.skillFile) return false;

  const read = sizes
    .map((file) => `${file.path}:${file.bytes?.byteLength ?? -1}`)
    .sort()
    .join("\n");

  const held = installed.files
    .map((file) => `${file.path}:${file.bytes}`)
    .sort()
    .join("\n");

  return read === held;
}

/** The name with the first number after it that no name taken holds, cut to the longest a name may be. */
function freeName(name: string, taken: ReadonlySet<string>): string {
  for (let number = 2; ; number += 1) {
    const suffix = `-${number}`;

    const stem = name
      .slice(0, SKILL_FILE_BOUNDS.MAX_NAME_CHARS - suffix.length)
      .replace(/-+$/u, "");

    const candidate = `${stem}${suffix}`;

    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * What the Mac's skills folders offer the reader, weighed against their own
 * skills: `personal` is every skill of theirs, and `installed` each of them
 * read whole, by name, where a skill on the Mac has its name.
 */
export function macSkillsReview(
  read: MacSkills,
  personal: readonly InstalledSkillSummary[],
  installed: ReadonlyMap<string, InstalledSkillContent>,
): MacSkillsReview {
  const taken = new Set(personal.map((skill) => skill.name));
  const offered: (OfferedSkill & { readonly app: MacSkillApp })[] = [];
  const skipped: SkippedSkill[] = [];

  for (const skill of read.skills) {
    const held = installed.get(skill.name);

    if (held !== undefined && sameFiles(skill, held)) {
      skipped.push(skippedOf(skill, MAC_SKILL_SKIPPED.ALREADY_INSTALLED));
      continue;
    }

    const name = taken.has(skill.name) ? freeName(skill.name, taken) : skill.name;
    taken.add(name);
    offered.push({
      app: skill.app,
      skill,
      name,
      ...(name === skill.name ? undefined : { renamedFrom: skill.name }),
    });
  }

  for (const left of read.left) skipped.push(skippedOf(left, left.reason satisfies MacSkillLeft));

  const groups = read.sources.map((source) => ({
    app: source.app,
    title: MAC_SKILL_APP_NAME[source.app],
    folder: source.folder,
    offered: offered.filter((each) => each.app === source.app),
  }));

  return { groups: groups.filter((group) => group.offered.length > 0), skipped, offered };
}

/** The names of the skills whose installed files a review needs: the reader's own that share a name with a skill on the Mac. */
export function clashingNames(
  read: MacSkills,
  personal: readonly InstalledSkillSummary[],
): readonly InstalledSkillSummary[] {
  const found = new Set(read.skills.map((skill) => skill.name));

  return personal.filter((skill) => found.has(skill.name));
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
