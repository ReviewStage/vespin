// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { afterEach, test, vi } from "vitest";
import {
  type DescriptionEditorHandle,
  type EditorAnchor,
  type EditorHistory,
  HISTORY_STEP,
  type HistoryStep,
} from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

/**
 * A description's undo history outlives its editor: an editor opened again
 * on the text the last one closed on takes its history up, ⌘Z taking back
 * the change made before the close and ⇧⌘Z putting it back, while an editor
 * opened on any other text drops it. Synthetic description.
 */

const TEXT = [
  "## Problem",
  "",
  "Only an admin can add someone,",
  "soft wrapped onto a second line with _em_ and __strong__.",
  "",
  "* one",
  "* two",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "<div>block html</div>",
  "",
  "## Decisions",
  "",
  "Model an invite as a `memberships` row.",
  "",
].join("\n");

const handles: DescriptionEditorHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** A comment thread on the decision's words, as the service anchors it in `TEXT`. */
const THREAD: EditorAnchor = {
  thread: "thread-decision",
  from: TEXT.indexOf("Model an invite"),
  to: TEXT.indexOf("Model an invite") + "Model an invite".length,
};

/** The editor on `markdown`, its open threads' words marked, taking up `kept` with `step` where given, and the drafts it handed over. */
function opened(
  markdown: string,
  kept?: EditorHistory,
  step?: HistoryStep,
  anchors?: readonly EditorAnchor[],
) {
  const drafts: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);

  const handle = mountDescriptionEditor(host, {
    markdown,
    placement: undefined,
    focus: false,
    label: "Description",
    className: "markdown description-unit",
    onDraft: (draft) => drafts.push(draft),
    onFinish: () => undefined,
    history: kept === undefined ? undefined : { kept, step },
    anchors,
  });

  handles.push(handle);
  const element = host.querySelector<TiptapEditorHTMLElement>(".description-document-text");
  const editor = element?.editor ?? assert.fail("the editor is running");

  return { handle, editor, drafts };
}

/** Where the text's list stands in the editor's document. */
function listOf(editor: ReturnType<typeof opened>["editor"]) {
  let list = { from: 0, to: 0 };
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "bulletList") list = { from: offset, to: offset + node.nodeSize };
  });

  return list;
}

/** The history of an editor on `TEXT` whose list was deleted, its caret in the list, and which was then taken down; its threads' words marked where given. */
function closedAfterDeleting(anchors?: readonly EditorAnchor[]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { handle, editor } = opened(TEXT, undefined, undefined, anchors);
  const list = listOf(editor);
  editor.commands.setTextSelection(list.from + 3);
  editor.commands.deleteRange(list);
  const typed = handle.markdown();
  const kept = handle.history();
  handles.splice(handles.indexOf(handle), 1);
  handle.destroy();
  vi.advanceTimersByTime(5_000);

  return { kept, typed };
}

test("an editor opened again on the text the last one closed on takes back the change made before the close, the block it brings back written as it was, and puts it back", () => {
  const { kept, typed } = closedAfterDeleting();

  const undone = opened(typed, kept, HISTORY_STEP.UNDO);
  const afterUndo = undone.handle.markdown();
  const draftAfterUndo = undone.drafts.at(-1);
  const keptAfterUndo = undone.handle.history();
  undone.handle.destroy();
  handles.splice(0);
  const redone = opened(afterUndo, keptAfterUndo, HISTORY_STEP.REDO);

  assert.deepEqual(
    { kept: kept.undoes, afterUndo, draftAfterUndo, redoes: keptAfterUndo.redoes },
    { kept: true, afterUndo: TEXT, draftAfterUndo: TEXT, redoes: true },
  );
  assert.equal(redone.handle.markdown(), typed);
});

test("⌘Z as the editor opens leaves the caret where the change was taken back, and ⇧⌘Z after it leaves the caret where the change was made, not where the editor opened", () => {
  const { kept, typed } = closedAfterDeleting();

  const { editor } = opened(typed, kept, HISTORY_STEP.UNDO);
  const list = listOf(editor);
  const undoneAt = editor.state.selection.from;
  editor.commands.redo();

  // The table followed the list, so the caret stands in it once the list is deleted again.
  assert.deepEqual(
    { undoneAt, redoneIn: editor.state.selection.$from.node(1).type.name },
    { undoneAt: list.from + 3, redoneIn: "table" },
  );
});

test("a thread closed while the editor was down leaves its history standing, since closing it moves no words", () => {
  const { kept, typed } = closedAfterDeleting([THREAD]);

  const { handle } = opened(typed, kept, HISTORY_STEP.UNDO, []);

  assert.equal(handle.markdown(), TEXT);
});

test("an editor opened on text changed since the last one closed drops its history, so ⌘Z there takes nothing back", () => {
  const { kept, typed } = closedAfterDeleting();
  const changed = `${typed}\nAn agent's line.\n`;

  const { handle, drafts } = opened(changed, kept, HISTORY_STEP.UNDO);

  assert.deepEqual(
    { text: handle.markdown(), drafts, undoes: handle.history().undoes },
    { text: changed, drafts: [], undoes: false },
  );
});
