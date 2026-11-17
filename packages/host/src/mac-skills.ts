/**
 * mac-skills.ts -- the skills this Mac's coding agents keep, read from each one's skills folder under the home folder, as Settings › Skills offers them to bring in.
 *
 * Each agent's folder (`MAC_SKILL_FOLDER`) is read in turn, and each folder
 * in it that holds a `SKILL.md` is a skill, read whole: every file under it
 * but the version control's and the package manager's own, named from the
 * skill's folder. A skill is offered with its files in base64, or left out
 * with why, so the member sees both:
 *
 * - a folder whose name a dot leads is one the agent keeps itself, such as
 *   Codex's `.system`, and each skill under it is left out as the agent's own;
 * - a folder already offered from another agent's skills folder, which a
 *   link reaches (`npx skills add` keeps a skill in `~/.agents/skills` and
 *   links it into each agent's), is left out as the same folder, once;
 * - a skill past the bounds one request carries (`INSTALLED_SKILL_BOUNDS`),
 *   or one the install's check would refuse
 *   (`@repo/features/installed-skill-check`), is left out for that reason.
 *
 * A folder the Mac does not hold, or will not let the app read, is told as
 * absent, and a file it will not read leaves its skill out as too large to
 * read whole, so a read never fails on one folder. Every folder is named from
 * the home folder, `~/…`, as the port carries it. Nothing here writes.
 */

import {
  fileText,
  type SkillFile,
  skillHead,
  skillRefusal,
} from "@repo/features/installed-skill-check";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_MAIN_FILE,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import { Effect, Option, Path } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import {
  MAC_SKILL_FOLDER,
  MAC_SKILL_LEFT,
  MAC_SKILL_READ_ORDER,
  type MacSkill,
  type MacSkillLeft,
  type MacSkillLeftOut,
  type MacSkills,
} from "./contract/mac-skills.js";

/** Folders under a skill that are never its own files: a checkout's history and installed packages. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Files a Mac leaves in any folder, which are no part of a skill. */
const SKIPPED_FILES: ReadonlySet<string> = new Set([".DS_Store"]);

/** The most bytes one read offers together, past which further skills are left out as too large; well under the port's budget. */
const READ_BUDGET_BYTES = 40_000_000;

/** One skill's folder found in an agent's skills folder: where it is, as the Mac names it and from the home folder, and the folder it really is. */
interface FoundFolder {
  readonly app: MacSkillApp;
  readonly path: string;
  readonly folder: string;
  readonly real: string;
  readonly name: string;
  /** Whether the agent keeps it itself, under a folder a dot leads. */
  readonly appOwn: boolean;
}

/** A skill's folder read: its files, or why it is left out. */
type FolderRead =
  | { readonly files: readonly SkillFile[]; readonly bytes: number }
  | { readonly left: MacSkillLeft };

type Services = FileSystem.FileSystem | Path.Path;

/** What a read of the file system answers, or nothing where the Mac refused it. */
function quietly<A>(effect: Effect.Effect<A, unknown, Services>) {
  return Effect.option(effect);
}

/** Whether the path is a folder, following a link; false where it cannot be read. */
const isFolder = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.map(
      quietly(fs.stat(path)),
      (info) => Option.isSome(info) && info.value.type === "Directory",
    ),
  );

/** Whether a file of the name stands in the folder. */
const holdsFile = (folder: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const info = yield* quietly(fs.stat(path.join(folder, name)));

    return Option.isSome(info) && info.value.type === "File";
  });

/** The folders in the folder, by name, in name order; none where it cannot be read. */
const foldersIn = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = Option.getOrElse(yield* quietly(fs.readDirectory(folder)), () => []);
    const sorted = [...names].sort((one, other) => one.localeCompare(other));

    return yield* Effect.filter(sorted, (name) => isFolder(path.join(folder, name)));
  });

/** Every skill folder in one agent's skills folder, a dot-led folder's skills marked as the agent's own. */
const foldersOf = (home: string, app: MacSkillApp) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.join(home, MAC_SKILL_FOLDER[app]);
    const tilde = `~/${MAC_SKILL_FOLDER[app]}`;
    const found: FoundFolder[] = [];

    const add = (name: string, at: string, folder: string, appOwn: boolean) =>
      Effect.gen(function* () {
        if (!(yield* holdsFile(at, INSTALLED_SKILL_MAIN_FILE))) return;
        const real = Option.getOrElse(yield* quietly(fs.realPath(at)), () => at);

        found.push({ app, path: at, folder, real, name, appOwn });
      });

    for (const name of yield* foldersIn(root)) {
      const at = path.join(root, name);

      if (!name.startsWith(".")) {
        yield* add(name, at, `${tilde}/${name}`, false);
        continue;
      }

      // Note that a dot-led folder holds the agent's own skills one level down, as Codex's `.system` does.
      for (const inner of yield* foldersIn(at)) {
        yield* add(inner, path.join(at, inner), `${tilde}/${name}/${inner}`, true);
      }
    }

    return { app, present: yield* isFolder(root), folder: tilde, found };
  });

/** Every file under the skill's folder, by its path from it with `/` between folders; none where the folder cannot be read. */
const filesUnder = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const listed = Option.getOrElse(
      yield* quietly(fs.readDirectory(folder, { recursive: true })),
      () => [],
    );

    const kept = listed
      .map((entry) => entry.split(path.sep).join("/"))
      .filter((entry) => {
        const parts = entry.split("/");

        return (
          !parts.some((part) => SKIPPED_FOLDERS.has(part)) &&
          !SKIPPED_FILES.has(parts.at(-1) ?? "") &&
          !entry.includes("\\")
        );
      })
      .sort();

    return yield* Effect.filter(kept, (entry) => holdsFile(folder, entry));
  });

/** A skill's folder read whole, within the bounds one request carries, or why it is left out. */
const readFolder = (found: FoundFolder) =>
  Effect.gen(function* (): Effect.fn.Return<FolderRead, never, Services> {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const paths = yield* filesUnder(found.path);

    if (paths.length > INSTALLED_SKILL_BOUNDS.MAX_IMPORT_FILES) {
      return { left: MAC_SKILL_LEFT.TOO_LARGE };
    }

    const sizes = yield* Effect.forEach(paths, (each) =>
      quietly(fs.stat(path.join(found.path, each))),
    );

    const bytes = sizes.reduce(
      (total, info) => total + (Option.isSome(info) ? Number(info.value.size) : 0),
      0,
    );

    // Note that the sizes are read before any file is, so a folder past the bound is never read whole.
    if (bytes > INSTALLED_SKILL_BOUNDS.MAX_IMPORT_BYTES) return { left: MAC_SKILL_LEFT.TOO_LARGE };

    const files: SkillFile[] = [];

    for (const each of paths) {
      const read = yield* quietly(fs.readFile(path.join(found.path, each)));

      if (Option.isNone(read)) return { left: MAC_SKILL_LEFT.TOO_LARGE };
      files.push({ path: each, bytes: read.value });
    }

    return { files, bytes: files.reduce((total, file) => total + file.bytes.byteLength, 0) };
  });

/** The skill a folder read offers, or why it is left out by the install's own check. */
function offered(found: FoundFolder, read: FolderRead): MacSkill | MacSkillLeftOut {
  if ("left" in read) {
    return { app: found.app, folder: found.folder, name: found.name, reason: read.left };
  }

  const main = read.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  const head = skillHead(main === undefined ? "" : fileText(main.bytes), found.name);
  const refusal = skillRefusal(head, read.files);

  if (refusal !== undefined) {
    return { app: found.app, folder: found.folder, name: head.name, reason: refusal };
  }

  return {
    app: found.app,
    folder: found.folder,
    name: head.name,
    description: head.description,
    bytes: read.bytes,
    files: read.files.map((file) => ({ path: file.path, base64: Base64.encode(file.bytes) })),
  };
}

/** Why a folder found is left out before it is read: the agent's own, or a folder already offered from another agent's, by a link. */
function leftUnread(
  found: FoundFolder,
  offeredFrom: string | undefined,
): MacSkillLeftOut | undefined {
  const named = { app: found.app, folder: found.folder, name: found.name };

  if (found.appOwn) return { ...named, reason: MAC_SKILL_LEFT.APP_OWN };

  if (offeredFrom !== undefined) {
    return { ...named, reason: MAC_SKILL_LEFT.SAME_FOLDER, sameAs: offeredFrom };
  }

  return undefined;
}

/** The skills the folders asked hold under the home folder given: each folder, the skills offered, and those left out, in the folders' order. */
export const readMacSkills = (home: string, asked: readonly MacSkillApp[]) =>
  Effect.gen(function* (): Effect.fn.Return<MacSkills, never, Services> {
    // Note that the folders are read in their own order whatever order is asked, so the folder agents share comes first.
    const apps = MAC_SKILL_READ_ORDER.filter((app) => asked.includes(app));
    const sources = yield* Effect.forEach(apps, (app) => foldersOf(home, app));
    const skills: MacSkill[] = [];
    const left: MacSkillLeftOut[] = [];
    // The folder each real folder was first offered from, so a link to it is told as the same.
    const offeredAt = new Map<string, string>();
    let budget = READ_BUDGET_BYTES;

    for (const found of sources.flatMap((source) => source.found)) {
      const unread = leftUnread(found, offeredAt.get(found.real));

      if (unread !== undefined) {
        left.push(unread);
        continue;
      }

      offeredAt.set(found.real, found.folder);
      const made = offered(found, yield* readFolder(found));

      // Note that a read past its budget leaves the rest out as too large, so the port never carries more than it holds.
      if (!("reason" in made) && made.bytes > budget) {
        left.push({
          app: found.app,
          folder: found.folder,
          name: made.name,
          reason: MAC_SKILL_LEFT.TOO_LARGE,
        });
      } else if ("reason" in made) {
        left.push(made);
      } else {
        budget -= made.bytes;
        skills.push(made);
      }
    }

    return {
      sources: sources.map(({ app, folder, present }) => ({ app, folder, present })),
      skills,
      left,
    };
  });
