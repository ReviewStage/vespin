// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { OPTION_MEDIA_KIND, OptionMedia } from "../../index.js";

/**
 * option-media.test.ts -- an option's media tiles are presses named for
 * what each is and its caption, listed under the option's name, each
 * opening its own.
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

test("each piece is a press named for its kind and caption, or its kind alone without one, listed under the option, opening its own", () => {
  const opened: string[] = [];

  const pieces = [
    { id: "page", kind: OPTION_MEDIA_KIND.PAGE, caption: "Directions", thumb: null },
    { id: "shot", kind: OPTION_MEDIA_KIND.PICTURE, caption: undefined, thumb: null },
  ].map((piece) => ({ ...piece, onOpen: () => opened.push(piece.id) }));

  const drawn = mount(createElement(OptionMedia, { label: "A card", pieces }));
  expect(drawn.querySelector("ul")?.getAttribute("aria-label")).toBe("A card media");
  const presses = [...drawn.querySelectorAll("button")];
  expect(presses.map((press) => press.getAttribute("aria-label"))).toEqual([
    "Page: Directions",
    "Picture: Picture",
  ]);
  act(() => presses[1]?.click());
  expect(opened).toEqual(["shot"]);
});
