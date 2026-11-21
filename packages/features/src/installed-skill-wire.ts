import { Schema as EffectSchema } from "effect";

/**
 * installed-skill-wire.ts -- a skill a member installs into the app: whose it is, where it came from, and how large its files may be.
 *
 * A repository's skills are read from GitHub at session start; an installed
 * skill is kept by the service itself, its files stored beside it, and
 * offered to agents beside the repository's. It is one member's, account-wide
 * and following them into every workspace (`personal`), or one workspace's,
 * offered to every member's agents there (`workspace`). Its source says where
 * its files came from: a GitHub folder pinned to the commit it was read at,
 * or files the member handed the app themselves, a `SKILL.md` pasted or a
 * skill's folder read from their Mac. The shapes here are what the store keeps
 * (`packages/database/src/schemas/installed-skill.ts`) and what the routes
 * answer, declared once. The name rule and the `SKILL.md` bound are the
 * repository skills' own, which the store's checks hold too.
 */

/** Whose an installed skill is. */
export const INSTALLED_SKILL_SCOPE = {
  /** Its installer's alone, in every workspace they are a member of. */
  PERSONAL: "personal",
  /** Its workspace's: every member installs one and their agents use it; its installer and the workspace's owners and admins change it. */
  WORKSPACE: "workspace",
} as const;

export type InstalledSkillScope =
  (typeof INSTALLED_SKILL_SCOPE)[keyof typeof INSTALLED_SKILL_SCOPE];

export const installedSkillScopeSchema = EffectSchema.Literals(
  Object.values(INSTALLED_SKILL_SCOPE),
);

/** Where an installed skill's files came from. */
export const INSTALLED_SKILL_SOURCE = {
  /** A folder of a GitHub repository, read at one commit. */
  GITHUB: "github",
  /** Files the member handed the app: a `SKILL.md` pasted, or a skill's folder read from their Mac, which its `mac` names. */
  TEXT: "text",
} as const;

/** Where on a Mac a skill may be brought in from: the skills folder of a coding agent the app runs, or the folder agents share. */
export const MAC_SKILL_APP = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CURSOR: "cursor",
  /** The folder agents share, which `npx skills add` writes to. */
  AGENTS: "agents",
} as const;

export type MacSkillApp = (typeof MAC_SKILL_APP)[keyof typeof MAC_SKILL_APP];

/** The longest folder a skill read from a Mac names, as macOS's `PATH_MAX` bounds a path. */
const MAC_FOLDER_MAX_CHARS = 1024;

/**
 * Where on a Mac a skill's folder was read: the agent whose skills folder
 * held it, and the folder, from the home folder (`~/.claude/skills/pr-review`),
 * so no account's name on the Mac is kept.
 */
export const macSkillOriginSchema = EffectSchema.Struct({
  app: EffectSchema.Literals(Object.values(MAC_SKILL_APP)),
  folder: EffectSchema.String.check(
    EffectSchema.isPattern(/^~\//u),
    EffectSchema.isMaxLength(MAC_FOLDER_MAX_CHARS),
  ),
});

/** A skill read from GitHub: the repository, its folder, the ref asked for, and the commit it resolved to, which the files are pinned at. */
const installedSkillGithubSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.GITHUB),
  owner: EffectSchema.String,
  repo: EffectSchema.String,
  /** The skill's folder from the repository's root, such as `skills/frontend-design`. */
  path: EffectSchema.String,
  /** The branch, tag, or commit asked for; the default branch's name where none was. */
  ref: EffectSchema.String,
  /** The commit `ref` resolved to when the files were read. */
  sha: EffectSchema.String,
});

/**
 * A skill the member handed the app: pasted as text, or read from their
 * Mac where `mac` says where. Note that a skill read from a Mac is this
 * source with `mac` beside its type rather than a source of its own,
 * because a desktop released before it reads an unknown type as no list at
 * all, while it reads an unknown key as a pasted skill.
 */
const installedSkillTextSourceSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(INSTALLED_SKILL_SOURCE.TEXT),
  mac: EffectSchema.optionalKey(macSkillOriginSchema),
});

export const installedSkillSourceSchema = EffectSchema.Union([
  installedSkillGithubSourceSchema,
  installedSkillTextSourceSchema,
]);

export type InstalledSkillSource = typeof installedSkillSourceSchema.Type;

/** The file every skill holds at its folder's root: its frontmatter and its procedure. */
export const INSTALLED_SKILL_MAIN_FILE = "SKILL.md";

/** The bound on an installed skill's files, past which an install or update is refused: each file's bytes, whatever the skill holds together. */
export const INSTALLED_SKILL_BOUNDS = {
  /** The most bytes one file holds: 3 MB, which a Mac takes whole in one queued message once base64 swells it to 4 MB. */
  MAX_FILE_BYTES: 3_000_000,
  /**
   * The most bytes a skill's folder brought in from a Mac holds together:
   * the folder is sent whole in one request, which base64 swells to 4 MB,
   * under a function's 4.5 MB body. A skill installed from GitHub is read by
   * the service itself and holds no such bound, and neither bound counts files.
   */
  MAX_IMPORT_BYTES: 3_000_000,
  /** The longest path a file of a skill brought in from a Mac has, from its folder. */
  MAX_IMPORT_PATH_CHARS: 256,
} as const;

/** Whether any of the files, by their sizes, is larger than one may be. */
export function holdsFileTooLarge(sizes: readonly number[]): boolean {
  return sizes.some((bytes) => bytes > INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES);
}

/** Why a skill was refused: the one set the store, the service, and the window each name a refusal by. */
export const INSTALLED_SKILL_REFUSAL = {
  /** None of its files is `SKILL.md` at its root. */
  NO_SKILL_FILE: "no-skill-file",
  /** Its `SKILL.md` names no valid skill, or carries no description. */
  SKILL_FILE_INVALID: "skill-file-invalid",
  /** A file larger than `INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES`, a `SKILL.md` larger than a repository's, or a repository past its archive's bound. */
  TOO_LARGE: "too-large",
  /** A file holds a literal shaped like a provider's credential, which a skill must never carry. */
  CREDENTIAL: "credential-shaped",
} as const;

export type InstalledSkillRefusal =
  (typeof INSTALLED_SKILL_REFUSAL)[keyof typeof INSTALLED_SKILL_REFUSAL];
