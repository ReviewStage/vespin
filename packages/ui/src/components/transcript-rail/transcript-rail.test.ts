// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { TranscriptRail, type TranscriptRailMark } from "./transcript-rail.js";

/**
 * transcript-rail.test.ts -- the rail is one press opening a list of the
 * lines sent into a conversation, each named by who sent it and its words,
 * whose keys go to a line; on a phone it is one press listing them, and a
 * line chosen there asks to go to it too. Synthetic lines.
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
  { key: "ask", sender: "You", words: "Build the invite flow.", shown: false },
  { key: "review", sender: "review-bot", words: "One note on expiry.", shown: true },
  { key: "fix", sender: "You", words: "Answer a used link with a 409.", shown: true },
];

/** The rail drawn over `MARKS`, in a phone's room where `narrow`, noting each line it asks to go to in `went`. */
function drawRail(narrow: boolean, went: string[]): void {
  // Note that the rail and its menu size themselves to what they hold, which jsdom never lays out.
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TranscriptRail, {
        marks: MARKS,
        narrow,
        onJump: (key: string) => went.push(key),
      }),
    ),
  );
}

test("the rail is one press opening a list of every line by who sent it and its words, its keys and a press going to a line", () => {
  const went: string[] = [];
  drawRail(false, went);
  const press = document.querySelector('nav[aria-label="Messages to the agent"] button');
  act(() => (press instanceof HTMLElement ? press.focus() : undefined));
  const options = [...document.querySelectorAll('[role="option"]')];
  expect(options.map((option) => option.textContent)).toEqual([
    "YouBuild the invite flow.",
    "review-botOne note on expiry.",
    "YouAnswer a used link with a 409.",
  ]);
  // The keyboard opens on the last line in view, the arrows walk the lines, and Enter goes to one.
  act(() => {
    press?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  act(() => {
    press?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(went).toEqual(["review"]);
});

test("on a phone the rail is one press listing every line, and a line chosen there goes to it", () => {
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
