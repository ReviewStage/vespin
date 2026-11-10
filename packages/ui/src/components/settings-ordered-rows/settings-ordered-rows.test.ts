// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SETTINGS_ORDER_HANDLE, SettingsOrderedRows } from "./settings-ordered-rows.js";

/**
 * settings-ordered-rows.test.ts -- a run of rows the reader orders is a
 * named list whose rows are each led by a grip a drag starts on, hidden
 * from a reader, and a run of one, which has nowhere to go, draws none.
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

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const rows = (names: readonly string[]) => names.map((name) => ({ key: name, row: name }));

test("each row of a run is an item of a named list led by a grip hidden from a reader, and a run of one draws none", () => {
  const pressed: string[] = [];
  const page = mount(
    createElement(SettingsOrderedRows, {
      label: "ChatGPT plans",
      rows: rows(["first", "second"]),
      onPointerDown: () => pressed.push("pressed"),
    }),
  );
  const list = page.querySelector('ol[aria-label="ChatGPT plans"]');
  expect([...(list?.querySelectorAll(":scope > li") ?? [])].map((row) => row.textContent)).toEqual([
    "first",
    "second",
  ]);
  const grips = [...page.querySelectorAll(SETTINGS_ORDER_HANDLE)];
  expect(grips).toHaveLength(2);
  expect(grips.every((grip) => grip.getAttribute("aria-hidden") === "true")).toBe(true);
  act(() => grips[0]?.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(pressed).toEqual(["pressed"]);

  const alone = mount(
    createElement(SettingsOrderedRows, {
      label: "Claude plans",
      rows: rows(["only"]),
      onPointerDown: () => pressed.push("alone"),
    }),
  );
  expect(alone.querySelector(SETTINGS_ORDER_HANDLE)).toBeNull();
});
