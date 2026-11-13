// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { TranscriptRail, type TranscriptRailMark } from "./transcript-rail.js";

/**
 * transcript-rail.test.ts -- the rail is one navigation of the lines sent
 * into a conversation, each a press named by who sent it and its words,
 * which asks to go to that line; on a phone it is one press listing them,
 * and a line chosen there asks to go to it too. Synthetic lines.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const MARKS: readonly TranscriptRailMark[] = [
  { key: "ask", own: true, sender: "You", words: "Build the invite flow.", shown: false },
  { key: "review", own: false, sender: "review-bot", words: "One note on expiry.", shown: true },
  { key: "fix", own: true, sender: "You", words: "Answer a used link with a 409.", shown: true },
];

/** The rail drawn over `MARKS`, in a phone's room where `narrow`, noting each line it asks to go to in `went`. */
function drawRail(narrow: boolean, went: string[]): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TranscriptRail, {
        marks: MARKS,
        narrow,
        cardOf: () => null,
        onJump: (key: string) => went.push(key),
      }),
    ),
  );
}

test("each line is a press named by who sent it and its words, going to that line", () => {
  const went: string[] = [];
  drawRail(false, went);
  const rail = document.querySelector('nav[aria-label="Messages to the agent"]');
  const presses = [...(rail?.querySelectorAll("button") ?? [])];
  expect(presses.map((press) => press.getAttribute("aria-label"))).toEqual([
    "You: Build the invite flow.",
    "review-bot: One note on expiry.",
    "You: Answer a used link with a 409.",
  ]);
  act(() => presses[1]?.click());
  expect(went).toEqual(["review"]);
});

test("on a phone the rail is one press listing every line, and a line chosen there goes to it", () => {
  // Note that the menu sizes itself to what it holds, which jsdom never lays out.
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const went: string[] = [];
  drawRail(true, went);
  const press = document.querySelector('button[aria-label="Messages to the agent"]');
  expect(press).toBeInstanceOf(HTMLButtonElement);
  act(() => {
    if (press instanceof HTMLButtonElement) press.click();
  });
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
    "You, Build the invite flow.",
    "review-bot, One note on expiry.",
    "You, Answer a used link with a 409.",
  ]);
  const chosen = items[2];
  act(() => {
    if (chosen instanceof HTMLElement) chosen.click();
  });
  expect(went).toEqual(["fix"]);
});
