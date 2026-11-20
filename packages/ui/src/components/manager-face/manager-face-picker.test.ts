// @vitest-environment jsdom

import type { ManagerFace } from "@repo/features/manager-face";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ManagerFacePicker } from "./manager-face-picker.js";

/**
 * manager-face-picker.test.ts -- a picker on no face rings nothing, and a
 * color pressed there picks it on the first character; a press on a
 * character keeps the color standing, and an arrow along the colors chooses
 * as it lands, keeping the character; each row says which of its options is
 * chosen.
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

/** The picker over a face it keeps itself, starting on none. */
function Picker(): React.JSX.Element {
  const [face, setFace] = useState<ManagerFace | undefined>(undefined);

  return createElement(ManagerFacePicker, { face, onChange: setFace });
}

/** The names of the options each row says are chosen, Character's then Color's. */
function chosen(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="radio"][aria-checked="true"]')].map(
    (option) => option.getAttribute("aria-label") ?? "",
  );
}

function option(container: HTMLElement, group: string, name: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `[role="radiogroup"][aria-label="${group}"] [aria-label="${name}"]`,
  );

  if (found === null) throw new Error(`no ${name} in ${group}`);

  return found;
}

test("a color pressed on no face takes the first character, a character pressed keeps the color, and an arrow along the colors chooses as it lands", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Picker)));

  expect(chosen(container)).toEqual([]);

  act(() => option(container, "Color", "Pink").click());
  expect(chosen(container)).toEqual(["Ghost", "Pink"]);

  act(() => option(container, "Character", "Mug").click());
  expect(chosen(container)).toEqual(["Mug", "Pink"]);

  const pink = option(container, "Color", "Pink");
  act(() => pink.focus());
  act(() => {
    pink.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });

  expect(chosen(container)).toEqual(["Mug", "Purple"]);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Purple");
});
