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
 * the same checkout changes nothing. A link of ours to a skill the member has
 * since uninstalled is taken out, with its line in `info/exclude`. A link is
 * ours only where it leads to the installed folder's skill of its own name,
 * as `linkedAt` makes it, so nothing else there is ever touched.
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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

/** The names of the skills installed under `skills`; none where the folder is gone. */
function installedIn(skills: string): readonly string[] {
  if (!existsSync(skills)) return [];

  return readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
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

/** Takes out each link of ours in `folder` to a skill no longer among `installed`, and answers their names. */
function unlinkedStale(folder: string, skills: string, installed: readonly string[]): string[] {
  const stale = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink() && !installed.includes(entry.name))
    .map((entry) => entry.name)
    .filter((name) => readlinkSync(join(folder, name)) === join(skills, name));

  for (const name of stale) unlinkSync(join(folder, name));

  return stale;
}

/** Each pattern listed in the exclude file at `file` taken out of it, where the file lists any. */
function unexcluded(file: string, patterns: readonly string[]): void {
  if (patterns.length === 0 || !existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split("\n");
  const kept = lines.filter((line) => !patterns.includes(line.trim()));

  if (kept.length < lines.length) writeFileSync(file, kept.join("\n"));
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
 * into the checkout at `cwd`, and our links to skills since uninstalled
 * taken out, as above; nothing where the config names no folder, or the
 * member installed no skills and the checkout has no folder of them. The
 * links are excluded where they really stand, so a `.agents/skills` the
 * repository links to another folder of its own excludes them there, and
 * one that leads out of the checkout is left alone, since git could not
 * exclude a link there.
 */
export function linkInstalledSkills(cwd: string, installedSkills: string | undefined): void {
  if (installedSkills === undefined) return;
  const skills = join(installedSkills, INSTALLED_SKILLS.SKILLS);
  const installed = installedIn(skills);
  const folder = join(cwd, ...PROJECT_SKILLS);

  if (installed.length === 0 && !existsSync(folder)) return;
  mkdirSync(folder, { recursive: true });
  const within = relative(realpathSync(cwd), realpathSync(folder));

  if (within.startsWith("..") || isAbsolute(within)) return;

  // Our links to skills since uninstalled are taken out, then each installed skill is linked.
  const stale = unlinkedStale(folder, skills, installed);
  const linked = installed.filter((name) => linkedAt(join(skills, name), join(folder, name)));
  const exclude = excludeFileOf(cwd);

  if (exclude === undefined) return;
  const patternOf = (name: string) => `/${[...within.split(sep), name].join("/")}`;
  unexcluded(exclude, stale.map(patternOf));
  excluded(exclude, linked.map(patternOf));
}
