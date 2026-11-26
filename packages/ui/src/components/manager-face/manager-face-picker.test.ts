// @vitest-environment jsdom

import type { ManagerFace } from "@repo/features/manager-face";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ManagerFacePicker } from "./manager-face-picker.js";

/**
 * manager-face-picker.test.ts -- the face standing is the one pressed; a
 * search keeps the faces whose name holds every word typed, in any order,
 * and Enter picks the first it found.
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

/** The picker over a face it keeps itself, starting on a blue ghost. */
function Picker(): React.JSX.Element {
  const [face, setFace] = useState<ManagerFace>({ character: "ghost", color: "blue" });

  return createElement(ManagerFacePicker, { face, onChange: setFace });
}

/** The names of the faces the grid offers. */
function offered(container: HTMLElement): string[] {
  return [...container.querySelectorAll("fieldset button")].map(
    (choice) => choice.getAttribute("aria-label") ?? "",
  );
}

/** The names of the faces pressed. */
function pressed(container: HTMLElement): string[] {
  return [...container.querySelectorAll('fieldset button[aria-pressed="true"]')].map(
    (choice) => choice.getAttribute("aria-label") ?? "",
  );
}

/** Types `words` into the search as a reader does. */
function search(field: HTMLInputElement, words: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("a search keeps the faces whose name holds every word typed, and Enter picks the first found", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Picker)));

  expect(offered(container)).toHaveLength(54);
  expect(pressed(container)).toEqual(["Blue ghost"]);

  const field = container.querySelector<HTMLInputElement>('input[type="search"], input');

  if (field === null) throw new Error("no search");
  search(field, "cat purple");
  expect(offered(container)).toEqual(["Purple cat"]);

  search(field, "bubble");
  expect(offered(container)).toEqual([
    "Red speech bubble",
    "Orange speech bubble",
    "Yellow speech bubble",
    "Green speech bubble",
    "Teal speech bubble",
    "Blue speech bubble",
    "Purple speech bubble",
    "Pink speech bubble",
    "Gray speech bubble",
  ]);

  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  expect(pressed(container)).toEqual(["Red speech bubble"]);
});
