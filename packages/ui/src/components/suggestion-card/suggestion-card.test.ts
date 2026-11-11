// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SuggestionCard, SuggestionCards } from "./suggestion-card.js";

/**
 * suggestion-card.test.ts -- the suggestions stand in a region named by
 * their heading, and each is one button a reader hears by its name and what
 * it does, whose press starts it.
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

test("a suggestion is one button named by its words under a region named by its heading, and its press starts it", () => {
  const started: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SuggestionCards, {
        title: "Suggested",
        children: createElement(SuggestionCard, {
          glyph: null,
          name: "Memory digest",
          detail: "Posts the week's memories.",
          onPress: () => started.push("Memory digest"),
        }),
      }),
    ),
  );

  const region = container.querySelector("section");
  const buttons = container.querySelectorAll("button");
  expect(region?.getAttribute("aria-label")).toBe("Suggested");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.textContent).toBe("Memory digestPosts the week's memories.");
  act(() => buttons[0]?.click());
  expect(started).toEqual(["Memory digest"]);
});
