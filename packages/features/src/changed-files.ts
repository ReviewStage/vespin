/**
 * changed-files.ts -- a pull request's changed files as every client lists them: in the order a tree lists them, kept by a typed filter, which start folded, the letter and words each wears for what became of it, and what stands in a file's diff where it has none to draw.
 *
 * The files are listed folders before files at each level, as Pierre's tree
 * sorts them on desktop (`treeOrder`), so a key or a button stepping to the
 * next file steps to the next row of the list. A filter keeps the files
 * whose path holds what is typed, whatever its case (`filterFiles`). A file
 * starts folded where reading it is rarely the point, as GitHub keeps such a
 * diff folded until asked (`startsCollapsed`): one deleted, one changing
 * more than `LARGE_FILE_LINES` lines, and a package manager's lockfile,
 * which GitHub would mark generated. A file with no patch is never drawn as
 * unchanged: it says it is binary, too large to show, or, with an empty
 * patch, that its contents did not change (`fileNotice`).
 */

import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  PATCH_OMITTED,
} from "./agent-wire.js";
import { LOCKFILE_NAMES } from "./diff-hunks.js";

/** The most lines a file may add and remove together before it starts collapsed. */
const LARGE_FILE_LINES = 1000;

/** What the tab says where the changes cannot be drawn. */
export const CHANGES_WORDS = {
  READING: "Reading changes",
  FAILED: "The changes could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  EMPTY: "This pull request changes no files.",
  TRUNCATED: "Only the first files are shown; this pull request has more.",
  OMITTED: {
    [PATCH_OMITTED.BINARY]: "Binary file not shown.",
    [PATCH_OMITTED.TOO_LARGE]: "This file's diff is too large to show.",
    [PATCH_OMITTED.SECRET]: "This file is kept secret.",
  },
  UNCHANGED_CONTENTS: "File renamed without changes to its contents.",
  NO_HUNKS: "No changes to show in this file.",
  UNREADABLE: "This file's diff could not be read.",
  TOO_NARROW_TO_SPLIT: "Needs a wider panel",
  UNPLACED_THREADS: "Comments on lines this diff does not show",
} as const;

/** The letter a file wears for what became of it, as an editor's source control marks it. */
export const STATUS_LETTER = {
  [CHANGED_FILE_STATUS.ADDED]: "A",
  [CHANGED_FILE_STATUS.MODIFIED]: "M",
  [CHANGED_FILE_STATUS.DELETED]: "D",
  [CHANGED_FILE_STATUS.RENAMED]: "R",
} as const;

/** What the letter a file wears says in words, in its hint. */
export const STATUS_WORDS = {
  [CHANGED_FILE_STATUS.ADDED]: "Added",
  [CHANGED_FILE_STATUS.MODIFIED]: "Modified",
  [CHANGED_FILE_STATUS.DELETED]: "Deleted",
  [CHANGED_FILE_STATUS.RENAMED]: "Renamed",
} as const satisfies Record<ChangedFileStatus, string>;

/**
 * What a file's pane says in its patch's place, or nothing where it draws
 * its hunks: why it carries no patch, that a file only moved kept its
 * contents, or that a patch holds no hunk.
 */
export function fileNotice(file: AgentChangedFile): string | undefined {
  if (file.omitted !== null) return CHANGES_WORDS.OMITTED[file.omitted];

  if (file.patch === null) return CHANGES_WORDS.OMITTED[PATCH_OMITTED.TOO_LARGE];

  if (file.patch.trim() !== "") return undefined;

  return file.status === CHANGED_FILE_STATUS.RENAMED
    ? CHANGES_WORDS.UNCHANGED_CONTENTS
    : CHANGES_WORDS.NO_HUNKS;
}

/** The files whose path holds `query`, whatever its case, as the tree's search narrows its rows; every file for a query of nothing but spaces. */
export function filterFiles(
  files: readonly AgentChangedFile[],
  query: string,
): readonly AgentChangedFile[] {
  const asked = query.trim().toLowerCase();

  if (asked === "") return files;

  return files.filter((file) => file.path.toLowerCase().includes(asked));
}

/** One step of a path as the tree sorts its rows: folders before files, a dotted name before the rest, then by name whatever its case. */
function compareStep(a: string, aFolder: boolean, b: string, bFolder: boolean): number {
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  const aDot = a.startsWith(".");

  if (aDot !== b.startsWith(".")) return aDot ? -1 : 1;

  return a.toLowerCase().localeCompare(b.toLowerCase());
}

/** Two paths in the tree's order: at the first folder or name they part at, as `compareStep` sorts them. */
function compareTreePaths(a: string, b: string): number {
  const aSteps = a.split("/");
  const bSteps = b.split("/");

  for (let at = 0; at < Math.min(aSteps.length, bSteps.length); at += 1) {
    const aStep = aSteps[at] ?? "";
    const bStep = bSteps[at] ?? "";

    if (aStep === bStep) continue;

    return compareStep(aStep, at < aSteps.length - 1, bStep, at < bSteps.length - 1);
  }

  return aSteps.length - bSteps.length;
}

/** The files in the order the tree lists them, as Pierre's tree sorts its rows. */
export function treeOrder(files: readonly AgentChangedFile[]): readonly AgentChangedFile[] {
  return files.toSorted((a, b) => compareTreePaths(a.path, b.path));
}

/** Whether a file starts collapsed: deleted, changing more than `LARGE_FILE_LINES` lines, or a lockfile. Note that a file with no hunks never does, because what stands under its header is why. */
export function startsCollapsed(file: AgentChangedFile): boolean {
  if (fileNotice(file) !== undefined) return false;

  return (
    file.status === CHANGED_FILE_STATUS.DELETED ||
    file.additions + file.deletions > LARGE_FILE_LINES ||
    LOCKFILE_NAMES.has(file.path.split("/").at(-1) ?? "")
  );
}

/** One folder's files as a list of sections names them: the folder's path, empty for the repository's root, and each file with its name past that folder. */
export interface FolderSection {
  readonly folder: string;
  readonly files: readonly { readonly file: AgentChangedFile; readonly name: string }[];
}

/** The folder a path stands in, empty for one at the repository's root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * The files as sections, one per folder holding a changed file, in the
 * tree's order (`treeOrder`), so a phone's list reads as the desktop's tree
 * opened whole: a folder's files under its path, each named alone. Note
 * that a folder whose files the tree lists apart, around a deeper folder's,
 * is still one section, at the place of its first file.
 */
export function folderSections(files: readonly AgentChangedFile[]): readonly FolderSection[] {
  const sections = new Map<string, { file: AgentChangedFile; name: string }[]>();

  for (const file of treeOrder(files)) {
    const folder = folderOf(file.path);
    const name = folder === "" ? file.path : file.path.slice(folder.length + 1);
    const section = sections.get(folder);

    if (section === undefined) sections.set(folder, [{ file, name }]);
    else section.push({ file, name });
  }

  return [...sections].map(([folder, named]) => ({ folder, files: named }));
}

/** The hex of a text's SHA-256, as GitHub names a file's diff on its page. */
async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The address of one file's diff on its pull request's page on GitHub: the Files changed tab, scrolled to the file by the anchor GitHub names it by, `diff-` and its path's SHA-256. */
export async function gitHubFileDiffLink(pullRequestUrl: string, path: string): Promise<string> {
  return `${pullRequestUrl.replace(/\/$/u, "")}/files#diff-${await sha256Hex(path)}`;
}
