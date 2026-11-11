/**
 * turn-files.ts -- the files a turn changed, as its own edits name them: each path with the lines the turn's patches added to it and removed from it, and the turn's totals.
 *
 * A turn's edits are its `apply_patch` and `write_file` calls, which every
 * harness's file edits are read as (`native-tool-calls.ts`), so the files are
 * had from the transcript as it stands and nothing is read from the checkout:
 * a file a shell command wrote is not among them, as it is not in the
 * harness's own view of its edits either. A patch counts the lines it adds
 * and removes; a written file counts its lines as added, since what it wrote
 * over is not in the call. A file edited twice in the turn is one file with
 * its counts summed, in the order the turn first named it, and one the patch
 * moved is named where it moved to. A patch whose root names another checkout
 * names no file of the task's (`tool-call-model.ts`), so it adds none, and
 * nor does a call that failed or never answered, whose edit did not land.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import { AGENT_PART, type AgentPart } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { TOOL_BLOCK, TOOL_STATE } from "./tool-call-block.js";
import { patchFiles, toolCallView } from "./tool-call-model.js";
import { CALL_KIND } from "./turn-rows.js";

/** One file a turn changed: its path, and the lines the turn added to it and removed from it. */
export interface TurnFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/** The files a turn changed, and the lines it added and removed over all of them. */
export interface TurnFiles {
  readonly files: readonly TurnFile[];
  readonly added: number;
  readonly removed: number;
}

/** How many lines a written file holds: none for an empty one, and a last line with no newline counted. */
function writtenLines(content: string): number {
  if (content === "") return 0;
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}

/** The files one call changed, with their counts; none for a call that changed no file. */
function filesOfCall(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
): readonly TurnFile[] {
  const view = toolCallView({ tool: part.tool, input: part.input, output: part.output });
  if (view.kind === CALL_KIND.EDIT) {
    // A patch names another checkout's files as none of the task's, which the view already read out.
    const named = new Set(view.files ?? []);
    return view.input.kind === TOOL_BLOCK.PATCH
      ? patchFiles(view.input.text).filter((file) => named.has(file.path))
      : [];
  }
  if (view.kind === CALL_KIND.WRITE_FILE) {
    const path = view.files?.[0];
    if (path === undefined) return [];
    const content = view.input.kind === TOOL_BLOCK.TEXT ? view.input.text : "";
    return [{ path, added: writtenLines(content), removed: 0 }];
  }
  return [];
}

/** The files the turn's parts changed, as above; none where the turn changed no file. */
export function turnFiles(parts: readonly AgentPart[]): TurnFiles | undefined {
  const byPath = new Map<string, { added: number; removed: number }>();
  for (const part of parts) {
    if (part.kind !== AGENT_PART.TOOL || part.state !== TOOL_STATE.OUTPUT_AVAILABLE) continue;
    for (const file of filesOfCall(part)) {
      const standing = byPath.get(file.path) ?? { added: 0, removed: 0 };
      standing.added += file.added;
      standing.removed += file.removed;
      byPath.set(file.path, standing);
    }
  }
  if (byPath.size === 0) return undefined;
  const files = [...byPath].map(([path, counts]) => ({ path, ...counts }));
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

/**
 * The developer's line that opened each reply's turn, by the reply's id: the
 * nearest line before the reply that opened a turn, which a line that
 * arrived inside one did not; none for a reply before any such line. The
 * turn's changes are read by that line (`agents.turnChanges`).
 */
export function turnLinesOf(
  messages: readonly AgentTranscriptMessage[],
): ReadonlyMap<string, string> {
  const lines = new Map<string, string>();
  let opened: string | undefined;
  for (const message of messages) {
    if (message.role === MESSAGE_ROLE.USER) {
      if (message.arrivedIn === undefined) opened = message.id;
      continue;
    }
    if (opened !== undefined) lines.set(message.id, opened);
  }
  return lines;
}
