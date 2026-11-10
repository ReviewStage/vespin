// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CodeEditor } from "./code-editor.js";

/**
 * code-editor.test.ts -- a code editor handed colors for older words draws
 * the words typed, never the ones its colors were for, so the colored layer
 * under the caret always spells what the field holds; and a numbered one
 * numbers each line the field holds, its empty ones and a closing empty one
 * included, so each number stands beside the line the caret is on.
 * Synthetic code.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("colors for older words leave the drawn words those typed", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  // The colors were answered for "pnpm install\nuv sync"; the second line has since been typed over.
  const lines = [
    [{ text: "pnpm", color: "#ffa657" }, { text: " install" }],
    [{ text: "uv", color: "#ffa657" }, { text: " sync" }],
  ];
  const typed = "pnpm install\ndocker compose pull";
  act(() =>
    root.render(
      createElement(CodeEditor, { label: "Script", value: typed, onChange: () => {}, lines }),
    ),
  );
  const drawn = document.querySelector("pre")?.textContent ?? expect.fail("No drawn lines");
  expect(drawn).toBe(`${typed}\n`);
});

test("a numbered editor numbers every line it holds, empty ones included", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  // Four lines as the text area holds them: two with words, an empty one between, and the empty one a closing newline opens.
  const typed = "pnpm install\n\nuv sync\n";
  act(() =>
    root.render(
      createElement(CodeEditor, {
        label: "Script",
        value: typed,
        onChange: () => {},
        lineNumbers: true,
      }),
    ),
  );
  const drawn = [...(document.querySelector("pre")?.children ?? [])].map(
    (line) => line.firstElementChild?.textContent,
  );
  expect(drawn).toEqual(["1", "2", "3", "4"]);
});
