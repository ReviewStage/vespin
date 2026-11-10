// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { RESOURCE_SORT, type ResourceSort, ResourcesPopover } from "./resources-popover.js";

/**
 * resources-popover.test.ts -- a press on the button opens a dialog named
 * Resources listing the rows, and a heading's press sorts by its column,
 * which its cell then says to a reader. Synthetic rows.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

/** jsdom has no ResizeObserver; the layer's and the names' measures are not what this test reads. */
class StandInResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  if (root !== undefined) act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The popover with its open state and sort held as an owner holds them. */
function Owned(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<ResourceSort>(RESOURCE_SORT.MEMORY);
  return createElement(ResourcesPopover, {
    label: "Resources",
    open,
    onOpenChange: setOpen,
    facts: [{ label: "CPU", icon: null, value: "12.0%" }],
    headings: { name: "Name", cpu: "CPU", memory: "Mem" },
    sort,
    onSort: setSort,
    rows: [{ key: "1", name: "Renderer", depth: 0, cpu: "2.0%", memory: "1.0 GB" }],
    empty: "Reading",
    copy: { text: "", what: "processes", run: async () => undefined },
  });
}

function heading(words: string): HTMLElement {
  const found = [...document.querySelectorAll("th")].find((cell) =>
    cell.textContent?.startsWith(words),
  );
  assert.ok(found, `no ${words} heading`);
  return found;
}

test("opens on a press and sorts by the heading pressed", () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Owned)));
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Resources"]');
  assert.ok(button);
  act(() => button.click());

  assert.ok(document.querySelector('[role="dialog"]'));
  assert.ok(document.body.textContent?.includes("Renderer"));
  assert.equal(heading("Mem").getAttribute("aria-sort"), "descending");

  act(() => heading("Name").querySelector("button")?.click());
  assert.equal(heading("Name").getAttribute("aria-sort"), "ascending");
  assert.equal(heading("Mem").getAttribute("aria-sort"), null);
});
