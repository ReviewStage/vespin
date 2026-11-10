// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ChipPopover } from "./chip-popover.js";

/**
 * chip-popover.test.ts -- a press on the chip opens a dialog named by its
 * title listing its facts, and where a menu stands under them, a pick
 * hands the row's id and puts the popover away. Synthetic words.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** jsdom has no ResizeObserver; the layer's measures are not what this test reads. */
class StandInResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Draws a chip whose menu, where `picked` is handed, lists two places, and presses it. */
function opened(picked?: string[]): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ChipPopover, {
        label: "Runs on",
        glyph: null,
        words: "Cloud",
        hint: "Runs on: Cloud",
        title: "Cloud sandbox",
        facts: [{ label: "CPU", icon: null, value: "4 vCPUs" }],
        menu:
          picked === undefined
            ? undefined
            : {
                heading: "Move to",
                rows: [
                  { id: "cloud", label: "Cloud" },
                  { id: "studio", label: "Studio" },
                ],
                value: "cloud",
                noMatch: "No places",
                onPick: (id: string) => picked.push(id),
              },
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]')?.click());
}

/** The open popover's facts, each its label and its value. */
function facts(): readonly (readonly [string, string])[] {
  return [...document.querySelectorAll('[role="dialog"] .ui-fact')].map(
    (fact) =>
      [
        fact.querySelector("dt")?.textContent ?? "",
        fact.querySelector("dd")?.textContent ?? "",
      ] as const,
  );
}

test("a press opens a dialog named by its title listing the facts, and a pick in its menu hands the row and closes it", () => {
  opened();
  assert.equal(
    document.querySelector('[role="dialog"]')?.textContent?.includes("Cloud sandbox"),
    true,
  );
  assert.deepEqual(facts(), [["CPU", "4 vCPUs"]]);

  const picked: string[] = [];
  opened(picked);
  assert.deepEqual(facts(), [["CPU", "4 vCPUs"]]);
  act(() =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((row) => row.textContent?.includes("Studio"))
      ?.click(),
  );
  assert.deepEqual(picked, ["studio"]);
  assert.equal(
    document.querySelectorAll('button[aria-expanded="true"]').length,
    0,
    "the popover is put away",
  );
});
