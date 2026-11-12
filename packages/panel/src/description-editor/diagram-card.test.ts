// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { DescriptionEditorHandle, EditorDiagram } from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

/**
 * diagram-card.test.ts -- a Mermaid code block in the description editor is
 * drawn as the read view's diagram card, handed its code card to stand in
 * its code's place: Show code shows the code, a caret landing in the code
 * shows it until it leaves, Show diagram hides it again with the caret put
 * after the block, and the text saves as written. A block in another
 * language stays a code card. The panel's drawings stand in as what they
 * were handed. Synthetic description.
 */

const FLOW = "flowchart LR\n  Invite --> Join";

const TEXT = `## Flow\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nAfter.\n\n\`\`\`sh\npnpm install\n\`\`\`\n`;

const editors: DescriptionEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text, each diagram card's latest drawing kept. */
function mounted(markdown: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const cards: EditorDiagram[] = [];
  const latest = () => cards.at(-1);

  const handle = mountDescriptionEditor(host, {
    markdown,
    placement: undefined,
    focus: true,
    label: "Description",
    className: "markdown description-unit",
    onDraft: () => undefined,
    onFinish: () => undefined,
    drawCodeHeader: () => ({ redraw: () => undefined, undraw: () => undefined }),
    drawDiagram: (element, diagram) => {
      element.append(diagram.source);
      cards.push(diagram);

      return { redraw: (next) => cards.push(next), undraw: () => undefined };
    },
  });

  editors.push(handle);
  const editor = host.querySelector<TiptapEditorHTMLElement>(".description-document-text")?.editor;
  assert.ok(editor, "the editor is running");

  return { host, handle, editor, latest, cards };
}

test("a Mermaid block is drawn as its diagram card holding its code card, and a block in another language is not", () => {
  const { host, handle, latest, cards } = mounted(TEXT);

  assert.equal(cards.length, 1);
  assert.equal(latest()?.code, FLOW);
  assert.equal(latest()?.showingCode, false);
  assert.equal(latest()?.source.querySelector("pre")?.textContent, FLOW);
  assert.deepEqual(
    [...host.querySelectorAll("pre")].map((pre) => pre.textContent),
    [FLOW, "pnpm install"],
  );
  assert.equal(handle.markdown(), TEXT);
});

test("Show code shows the code, and Show diagram hides it and puts a caret standing in it after the block", () => {
  const { editor, latest } = mounted(TEXT);

  latest()?.showCode(true);
  assert.equal(latest()?.showingCode, true);

  let end: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") {
      end = position + node.nodeSize - 1;
    }
  });
  assert.ok(end !== undefined, "the text holds the Mermaid block");
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  editor.view.dispatch(editor.state.tr.insertText("\n  Join --> Member"));
  assert.equal(latest()?.code, `${FLOW}\n  Join --> Member`);

  latest()?.showCode(false);

  assert.equal(latest()?.showingCode, false);
  assert.equal(editor.state.selection.$head.parent.textContent, "After.");
});

test("Show diagram on the text's last block puts a caret standing in its code before it", () => {
  const { editor, latest } = mounted(`Intro.\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n`);
  const end = editor.state.doc.content.size - 1;

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  latest()?.showCode(false);

  assert.equal(latest()?.showingCode, false);
  assert.equal(editor.state.selection.$head.parent.textContent, "Intro.");
});

test("a caret landing in the code shows it until it leaves", () => {
  const { editor, latest } = mounted(TEXT);
  let start: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") start = position + 1;
  });
  assert.ok(start !== undefined, "the text holds the Mermaid block");

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start)));
  assert.equal(latest()?.showingCode, true);

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
  assert.equal(latest()?.showingCode, false);
});
