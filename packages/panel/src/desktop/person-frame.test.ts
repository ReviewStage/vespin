// @vitest-environment jsdom

import { motionRows } from "@repo/ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PERSON_SECTION_FOLD, PersonBody, PersonSectionFrame } from "./person-frame.js";

/**
 * person-frame.test.ts -- a section of a person's page folded glides the
 * section under it as one, its head and its rows together, rather than its
 * rows gliding past a head that jumped. jsdom lays nothing out and plays
 * nothing, so each row's place is given and each motion recorded.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** How tall a row is drawn in the layout given. */
const ROW = 40;

/** The motion tokens the body reads, as an app's sheets set them. */
const TOKENS = {
  "--ui-duration-exit": "90ms",
  "--ui-motion-exit": "ease",
  "--ui-duration-quick": "140ms",
  "--ui-duration-shape": "460ms",
  "--ui-spring": "ease-out",
} as const;

let root: Root | undefined;
let played: { element: Element; keyframes: Keyframe[] }[] = [];

/** How tall the layout given draws an element: a row's height, or its children's together. */
function heightOf(element: Element): number {
  if (element.matches("p")) return ROW;

  return [...element.children].reduce((sum, child) => sum + heightOf(child), 0);
}

/** Where the layout given draws an element's top: under what stands before it in its parent. */
function topOf(element: Element): number {
  const parent = element.parentElement;

  if (parent === null) return 0;
  const before = [...parent.children].slice(0, [...parent.children].indexOf(element));

  return topOf(parent) + before.reduce((sum, each) => sum + heightOf(each), 0);
}

beforeEach(() => {
  played = [];

  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }

  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      played.push({ element: this, keyframes });

      return { onfinish: null, cancel: () => undefined };
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, topOf(this), 200, heightOf(this));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();

  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
});

/** A section named `title` whose rows move, as the page's lists do. */
function section(title: string, rows: readonly string[]): ReactNode {
  return createElement(PersonSectionFrame, {
    key: title,
    label: title,
    title,
    fold: PERSON_SECTION_FOLD,
    children: createElement(
      "div",
      motionRows(),
      rows.map((words) => createElement("p", { key: words }, words)),
    ),
  });
}

test("a section folded glides the section under it up as one, its rows carried with its head", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(PersonBody, {
        children: [section("Waiting", ["First", "Second"]), section("Assigned", ["Third"])],
      }),
    ),
  );

  act(() => document.querySelector<HTMLElement>('[aria-expanded="true"]')?.click());

  const under = document.querySelector('section[aria-label="Assigned"]');
  const row = [...document.querySelectorAll("p")].find((each) => each.textContent === "Third");
  expect(played.filter((each) => each.element === under).map((each) => each.keyframes)).toEqual([
    [{ transform: `translate(0px, ${2 * ROW}px)` }, { transform: "none" }],
  ]);
  expect(played.filter((each) => each.element === row)).toEqual([]);
});
