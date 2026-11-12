// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { DescriptionEditorHandle, EditorCodeBlock } from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

/**
 * code-block-view.test.ts -- a fenced block open in the description editor
 * has its header drawn by the panel, an empty one as any other, and a
 * language picked there is written to its fence, the block's lines and the
 * rest of the text kept as written. The panel's drawing stands in as the
 * block's language and lines in words. Synthetic description.
 */

const TEXT = "## Setup\n\n```\npnpm install\n```\n\n```\n```\n";

const editors: DescriptionEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

test("each block's header is drawn, and a language picked there is written to its fence", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const drawn = new Map<HTMLElement, EditorCodeBlock>();

  const handle = mountDescriptionEditor(host, {
    markdown: TEXT,
    placement: undefined,
    focus: true,
    label: "Description",
    className: "markdown description-unit",
    onDraft: () => undefined,
    onFinish: () => undefined,
    drawCodeHeader: (element, block) => {
      drawn.set(element, block);

      return {
        redraw: (next) => drawn.set(element, next),
        undraw: () => drawn.delete(element),
      };
    },
  });

  editors.push(handle);
  const headers = () => [...drawn.values()].map(({ language, code }) => ({ language, code }));

  assert.deepEqual(headers(), [
    { language: "", code: "pnpm install" },
    { language: "", code: "" },
  ]);
  [...drawn.values()][0]?.setLanguage("sh");

  assert.deepEqual(headers(), [
    { language: "sh", code: "pnpm install" },
    { language: "", code: "" },
  ]);
  assert.equal(handle.markdown(), "## Setup\n\n```sh\npnpm install\n```\n\n```\n```\n");
});
