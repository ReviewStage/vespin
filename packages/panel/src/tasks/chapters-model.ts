import type { AgentChangedFile, ReviewThread } from "@repo/features/agent-wire";
import { patchHunks } from "@repo/features/diff-hunks";
import type { ModelProvider } from "@repo/features/models-wire";
import {
  type Chapter,
  type ChapterHunk,
  chapterPatches,
  LINE_REF_SIDE,
  type LineRef,
  threadInChapter,
} from "@repo/features/pull-request-chapters";
import type { ChaptersRunsOn } from "@repo/features/pull-request-chapters-wire";
import type { DiffLineSpan } from "../diff-view/contract.js";

/**
 * chapters-model.ts -- a pull request's chapters as the panel's Chapters view draws them: the model a Generate runs on, which files each chapter holds, and whether the member has viewed them.
 *
 * Which state the view draws, whether the chapters are stale, and the order
 * they are read in are every client's (`@repo/features/pull-request-chapters-shown`).
 * A Generate runs on the model and key the read names, or the one the
 * member last picked where they may pick (`pickedRunsOn`). A chapter is viewed once every file it holds is
 * marked viewed on GitHub (`chapterViewed`), and marking it marks each of
 * them, or unmarks them all where all were (`chapterMarks`), so a file two
 * chapters hold is shared by both. A key change's press brings its first
 * lines in the chapter's reading order into view (`firstLineRef`), lit where
 * the chapter's diff draws them (`drawnLines`), else its file's header.
 * Nothing here reads the DOM.
 */

/**
 * What a Generate runs on as the view draws it: where the member may pick,
 * the choice of the provider they last picked, which their preferences row
 * draws the moment they pick; else, and before that row is read, what the
 * read says.
 */
export function pickedRunsOn(
  runsOn: ChaptersRunsOn | undefined,
  choices: readonly ChaptersRunsOn[] | undefined,
  picked: ModelProvider | undefined,
): ChaptersRunsOn | undefined {
  return choices?.find((choice) => choice.provider === picked) ?? runsOn;
}

/** The paths of the files a chapter draws, in the order it first names each. */
export function chapterPaths(
  chapter: Chapter,
  files: readonly AgentChangedFile[],
): readonly string[] {
  return chapterPatches(chapter, files).map((file) => file.path);
}

/** Whether every file of a chapter is marked viewed; never for a chapter that holds none. */
export function chapterViewed(
  paths: readonly string[],
  viewed: (path: string) => boolean,
): boolean {
  return paths.length > 0 && paths.every(viewed);
}

/**
 * The files a press of Mark chapter viewed turns: each one not yet viewed,
 * or, where every one is, all of them, so the press unmarks the chapter.
 */
export function chapterMarks(
  paths: readonly string[],
  viewed: (path: string) => boolean,
): readonly string[] {
  return chapterViewed(paths, viewed) ? paths : paths.filter((path) => !viewed(path));
}

/** How many of the review threads stand in a chapter. */
export function chapterThreadCount(
  chapter: Chapter,
  threads: readonly ReviewThread[],
  hunks: readonly ChapterHunk[],
): number {
  return threads.filter((thread) => threadInChapter(thread, chapter, hunks)).length;
}

/** The line or the lines a key change points at, as its pill names them after its file. */
export function lineRefLines(ref: LineRef): string {
  return ref.startLine === ref.endLine ? `L${ref.startLine}` : `L${ref.startLine}–${ref.endLine}`;
}

/** Lines a key change points at, named whole: the file's path, then the line or the lines. */
export function lineRefLabel(ref: LineRef): string {
  return `${ref.path} · ${lineRefLines(ref)}`;
}

/** Where a line ref stands among others of its file at the same line: a removed line before an added one, as a unified diff draws them. */
const SIDE_RANK = { [LINE_REF_SIDE.DELETIONS]: 0, [LINE_REF_SIDE.ADDITIONS]: 1 } as const;

/**
 * The lines of a key change its press brings into view: the first in the
 * chapter's reading order, as ReviewStage orders them, by the file the
 * chapter draws first (`paths`), then by line, a removed line before an
 * added one at the same number, then the shorter run. Lines of files the
 * chapter does not draw come last, in the order the key change names them.
 */
export function firstLineRef(
  refs: readonly LineRef[],
  paths: readonly string[],
): LineRef | undefined {
  const rank = (ref: LineRef) => {
    const at = paths.indexOf(ref.path);

    return at === -1 ? paths.length : at;
  };

  const sorted = [...refs].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);

    if (a.path !== b.path) return 0;

    if (a.startLine !== b.startLine) return a.startLine - b.startLine;

    if (a.side !== b.side) return SIDE_RANK[a.side] - SIDE_RANK[b.side];

    return a.endLine - b.endLine;
  });

  return sorted[0];
}

/**
 * The lines of `ref` the chapter's diff draws of `file`, the file as the
 * chapter draws it (`chapterPatches`): from its first line to its last, or
 * to the end of the hunk holding its first where it runs past it; none
 * where the file draws no lines, or no hunk it draws holds the first line
 * on its side, which brings the file's header into view instead. Note that
 * a hunk draws every line it counts on a side, its unchanged lines among
 * them, so a run may start on one.
 */
export function drawnLines(
  file: AgentChangedFile | undefined,
  ref: LineRef,
): DiffLineSpan | undefined {
  if (file === undefined || file.path !== ref.path) return undefined;

  if (file.omitted !== null || file.patch === null) return undefined;
  const additions = ref.side === LINE_REF_SIDE.ADDITIONS;

  for (const hunk of patchHunks(file.patch) ?? []) {
    const first = additions ? hunk.newStart : hunk.oldStart;
    const last = first + (additions ? hunk.newLines : hunk.oldLines) - 1;

    if (ref.startLine < first || ref.startLine > last) continue;

    return { side: ref.side, startLine: ref.startLine, endLine: Math.min(ref.endLine, last) };
  }

  return undefined;
}

/** The chapter `step` on from `at` among `count`, held at either end. */
export function steppedChapter(at: number, step: number, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, at + step));
}
