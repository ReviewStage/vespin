// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { OPTION_MEDIA_KIND, OptionMedia } from "../../index.js";

/**
 * option-media.test.ts -- an option's media lines are presses named for
 * what each is and its title, listed under the option's name, each opening
 * its own.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("each line is a press saying its kind and title, listed under the option, opening its own", () => {
  const opened: string[] = [];
  const lines = [
    { id: "page", kind: OPTION_MEDIA_KIND.PAGE, title: "Directions", thumb: null },
    { id: "link", kind: OPTION_MEDIA_KIND.LINK, title: "The preview", thumb: null },
  ].map((line) => ({ ...line, onOpen: () => opened.push(line.id) }));
  const drawn = mount(createElement(OptionMedia, { label: "A card", lines }));
  const list = drawn.querySelector("ul");
  expect(list?.getAttribute("aria-label")).toBe("A card media");
  const presses = [...drawn.querySelectorAll("button")];
  expect(presses.map((press) => press.textContent)).toEqual([
    "Page · Directions",
    "Link · The preview",
  ]);
  act(() => presses[1]?.click());
  expect(opened).toEqual(["link"]);
});
