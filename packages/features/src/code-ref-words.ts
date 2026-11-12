/**
 * code-ref-words.ts -- how code is named in words, wherever it is named: a file's lines, a reference to them, and a commit.
 */

/** A reference as a place names it, read from a call's input or a stored note, its lines absent for a whole file. */
export interface NamedLines {
  readonly path: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

/** The characters of a commit's SHA a line names it by, as GitHub abbreviates one. */
const SHORT_COMMIT_CHARS = 7;

/**
 * The lines a reference points at, as every place naming them says them, a
 * file's chip and an inbox item's code alike: "Lines 40–58", "Line 7", or
 * nothing for a whole file.
 */
export function lineRangeText(ref: Omit<NamedLines, "path">): string | undefined {
  if (ref.startLine === undefined || ref.endLine === undefined) return undefined;

  return ref.startLine === ref.endLine
    ? `Line ${ref.startLine}`
    : `Lines ${ref.startLine}–${ref.endLine}`;
}

/** A reference as words, where its path and its lines are said in one breath: "src/invite.ts, Lines 40–58", or the path alone for a whole file. */
export function fileRefText(ref: NamedLines): string {
  const lines = lineRangeText(ref);

  return lines === undefined ? ref.path : `${ref.path}, ${lines}`;
}

/** A commit as a line names it: its SHA cut as GitHub abbreviates one. */
export function shortCommit(sha: string): string {
  return sha.slice(0, SHORT_COMMIT_CHARS);
}

/** A file's name, the last part of its path, as its tab and its chip are labeled. */
export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}
