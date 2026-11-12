// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CodePreview } from "./code-preview.js";

/**
 * code-preview.test.ts -- a preview of a longer script shows only its first
 * lines and says that more follow, while a short one shows whole and says
 * nothing follows. Synthetic code.
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

function drawn(code: string): { lines: string[]; more: boolean } {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(CodePreview, { code, shown: 2 })));
  const preview = container.querySelector("code") ?? expect.fail("No preview");

  return {
    lines: [...preview.children].map((line) => line.textContent ?? ""),
    more: preview.dataset.more === "true",
  };
}

test("a script longer than the preview shows its first lines and marks the rest as cut", () => {
  expect(drawn("set -e\npnpm install\npnpm build\npnpm start")).toEqual({
    lines: ["set -e", "pnpm install"],
    more: true,
  });
  expect(drawn("pnpm dev")).toEqual({ lines: ["pnpm dev"], more: false });
});
