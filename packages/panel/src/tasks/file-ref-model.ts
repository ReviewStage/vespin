/**
 * file-ref-model.ts -- how a file is named apart from drawing it: its name and folder, and what a copy of the lines pointed at carries; how its lines are said is `@repo/features/code-ref-words`'s.
 */

import { fileName } from "@repo/features/code-ref-words";
import type { CodeRef } from "@repo/features/task-wire";
import type { SnippetLines } from "./code-snippet-model.js";

/** Whether `line` of the file is one the reference points at. */
function isPointed(ref: CodeRef, line: number): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) return false;
  return line >= ref.startLine && line <= ref.endLine;
}

/** What a card's copy carries: the lines pointed at as plain text, or every line the card draws for a whole file. */
export function copiedLines(code: SnippetLines): string {
  const kept = code.lines.filter(
    (_line, at) => code.ref.startLine === undefined || isPointed(code.ref, code.firstLine + at),
  );
  return kept.join("\n");
}

/** The folder a file stands in, its path short of its name, as a row says it after the name; none at the repository's root. */
export function fileFolder(path: string): string | undefined {
  return path.slice(0, -fileName(path).length - 1) || undefined;
}
