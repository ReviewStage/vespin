/**
 * mac-skills.ts -- the skills this Mac's own coding agents keep, read from their skills folders under the home folder, as a procedure.
 *
 * Settings › Skills asks it as its Bring in from your Mac opens
 * (`packages/panel/src/settings/mac-skills-dialog.tsx`); main answers it
 * with the read in `../mac-skills.ts`, and a browser tab and the iOS app
 * refuse it, since neither runs on the Mac. A skill offered comes with
 * every file of its folder, in base64, for the service to install as it
 * stands (`installedSkills.importFolder`); a folder an install would refuse
 * is left out with why, so the member sees what was not offered as well as
 * what was, while a link to a folder already offered, and an agent's own
 * skills, are passed over unsaid. Every folder
 * is named from the home folder (`~/.claude/skills`), so no account's name
 * on the Mac crosses the port.
 */

import {
  INSTALLED_SKILL_REFUSAL,
  MAC_SKILL_APP,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_SKILLS_ACT_KIND } from "./kinds.js";

/**
 * Each skills folder, from the home folder, in the order they are read and
 * listed: the folder agents share first, since `npx skills add` keeps a
 * skill there and links it into each agent's, so a skill is offered from
 * where it really is.
 */
export const MAC_SKILL_FOLDER = {
  [MAC_SKILL_APP.AGENTS]: ".agents/skills",
  [MAC_SKILL_APP.CLAUDE_CODE]: ".claude/skills",
  [MAC_SKILL_APP.CODEX]: ".codex/skills",
  [MAC_SKILL_APP.CURSOR]: ".cursor/skills",
} as const satisfies Record<MacSkillApp, string>;

/** The order the folders are read and listed in, as `MAC_SKILL_FOLDER` says why. */
export const MAC_SKILL_READ_ORDER = [
  MAC_SKILL_APP.AGENTS,
  MAC_SKILL_APP.CLAUDE_CODE,
  MAC_SKILL_APP.CODEX,
  MAC_SKILL_APP.CURSOR,
] as const satisfies readonly MacSkillApp[];

const appSchema = EffectSchema.Literals(Object.values(MAC_SKILL_APP));

/** A folder from the home folder. */
const tildeFolder = EffectSchema.String.check(EffectSchema.isPattern(/^~\//u));

/** One agent's skills folder: where it is, and whether the Mac holds it at all. */
const macSkillSourceSchema = EffectSchema.Struct({
  app: appSchema,
  folder: tildeFolder,
  present: EffectSchema.Boolean,
});

/** One file of a skill offered: its path from the skill's folder, and its bytes in base64. */
const macSkillFileSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  base64: EffectSchema.String,
});

/** One skill offered: the agent whose folder held it, its folder, what its `SKILL.md` says of it, and every file. */
const macSkillSchema = EffectSchema.Struct({
  app: appSchema,
  folder: tildeFolder,
  name: EffectSchema.String,
  description: EffectSchema.String,
  /** Its files' bytes together. */
  bytes: EffectSchema.Number,
  files: EffectSchema.Array(macSkillFileSchema),
});

export type MacSkill = typeof macSkillSchema.Type;

/** One skill's folder left out, and the check an install would refuse it for. */
const macSkillLeftOutSchema = EffectSchema.Struct({
  app: appSchema,
  folder: tildeFolder,
  name: EffectSchema.String,
  reason: EffectSchema.Literals(Object.values(INSTALLED_SKILL_REFUSAL)),
});

export type MacSkillLeftOut = typeof macSkillLeftOutSchema.Type;

/** What the Mac's skills folders hold: each folder looked in, the skills offered, and those left out. */
const macSkillsSchema = EffectSchema.Struct({
  sources: EffectSchema.Array(macSkillSourceSchema),
  skills: EffectSchema.Array(macSkillSchema),
  left: EffectSchema.Array(macSkillLeftOutSchema),
});

export type MacSkills = typeof macSkillsSchema.Type;

/** Which folders to read: the agents the reader runs, a harness behind an experiment only while it is on, and the folder they share. */
const macSkillsReadSchema = EffectSchema.Struct({
  apps: EffectSchema.Array(appSchema),
});

export type MacSkillsRead = typeof macSkillsReadSchema.Type;

export const macSkillsActsContract = {
  [MAC_SKILLS_ACT_KIND.MAC_SKILLS_READ]: actProcedure("Could not read the skills on this Mac.")
    .input(exactInput(macSkillsReadSchema))
    .output(macSkillsSchema),
};
