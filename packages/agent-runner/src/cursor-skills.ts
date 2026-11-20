/**
 * cursor-skills.ts -- the member's installed skills where Cursor's SDK finds them: a link to each in the checkout's `.agents/skills`, kept out of git.
 *
 * Claude Code loads the installed folder as a local plugin and Codex takes
 * its `skills/` as an extra skills root (`INSTALLED_SKILLS`), but Cursor's
 * SDK takes no folder of skills from its caller: it finds a project's in the
 * checkout's `.cursor/skills` or `.agents/skills`, and follows a link there
 * to a skill's folder. So a launch links each installed skill into the
 * checkout's `.agents/skills` under its name, and lists each link in the
 * repository's `info/exclude`, which git reads beside `.gitignore`, so no
 * commit, and no snapshot of the checkout, takes it.
 *
 * A name the repository already holds there is the repository's: its skill
 * stands and the member's is not linked, as the repository's own skills win
 * in the other harnesses. A link of ours from an earlier launch is left as it
 * stands and a line already excluded is not written again, so a relaunch in
 * the same checkout changes nothing.
 */

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { installedSkillsPath } from "./launch.js";
import { INSTALLED_SKILLS } from "./protocol.js";

/** The checkout's folder of skills Cursor's SDK reads, of those it reads the one every harness shares. */
const PROJECT_SKILLS = [".agents", "skills"] as const;

/** What a `.git` file names its repository's folder with, in a worktree. */
const GIT_DIR_LINE = /^gitdir: (.+)$/mu;

/**
 * The repository's `info/exclude` for the checkout at `cwd`: under its
 * `.git`, or, in a worktree, under the folder its worktree shares with the
 * clone, where git reads it; none where the checkout is no repository.
 */
function excludeFileOf(cwd: string): string | undefined {
  const dotGit = join(cwd, ".git");
  const stat = statSync(dotGit, { throwIfNoEntry: false });

  if (stat === undefined) return undefined;

  if (stat.isDirectory()) return join(dotGit, "info", "exclude");

  const named = GIT_DIR_LINE.exec(readFileSync(dotGit, "utf8"))?.[1];

  if (named === undefined) return undefined;
  const gitDir = resolve(cwd, named.trim());
  const common = join(gitDir, "commondir");
  const shared = existsSync(common) ? resolve(gitDir, readFileSync(common, "utf8").trim()) : gitDir;

  return join(shared, "info", "exclude");
}

/** Whether the skill stands linked at `link` once this returns: linked where nothing stood, ours from an earlier launch kept, and false where the repository holds the name. */
function linkedAt(target: string, link: string): boolean {
  const standing = lstatSync(link, { throwIfNoEntry: false });

  if (standing === undefined) {
    symlinkSync(target, link, "dir");

    return true;
  }

  return standing.isSymbolicLink() && readlinkSync(link) === target;
}

/** Each pattern listed in the exclude file at `file` where it is not already, the file and its folder made where missing. */
function excluded(file: string, patterns: readonly string[]): void {
  const standing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const listed = new Set(standing.split("\n").map((line) => line.trim()));
  const missing = patterns.filter((pattern) => !listed.has(pattern));

  if (missing.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  // Note that a file whose last line has no newline gets one first, so our first pattern is a line of its own.
  const lead = standing === "" || standing.endsWith("\n") ? "" : "\n";
  appendFileSync(file, `${lead}${missing.join("\n")}\n`);
}

/**
 * The installed skills under `installedSkills` (`INSTALLED_SKILLS`) linked
 * into the checkout at `cwd`, as above; nothing where the config names no
 * folder or the member installed no skills. The links are excluded where
 * they really stand, so a `.agents/skills` the repository links to another
 * folder of its own excludes them there, and one that leads out of the
 * checkout is left alone, since git could not exclude a link there.
 */
export function linkInstalledSkills(cwd: string, installedSkills: string | undefined): void {
  const skills = installedSkillsPath(installedSkills, INSTALLED_SKILLS.SKILLS);

  if (skills === undefined) return;
  const folder = join(cwd, ...PROJECT_SKILLS);
  mkdirSync(folder, { recursive: true });
  const within = relative(realpathSync(cwd), realpathSync(folder));

  if (within.startsWith("..") || isAbsolute(within)) return;

  const linked = readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => linkedAt(join(skills, name), join(folder, name)));

  const exclude = excludeFileOf(cwd);

  if (exclude === undefined || linked.length === 0) return;
  excluded(
    exclude,
    linked.map((name) => `/${[...within.split(sep), name].join("/")}`),
  );
}
