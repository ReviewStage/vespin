// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { SettingsDialog, type SettingsDialogSection } from "./settings-dialog.js";

/**
 * settings-dialog.test.ts -- the card is named by the dialog's title, the
 * section shown is the place its list announces as the page and names the
 * region beside the list, and pressing another place turns the dialog to
 * it; and where the list and the section take the card's room in turn, as
 * on a phone, the keyboard follows: to the way back as a section opens, and
 * back to the place it opened from as the list returns. jsdom lays nothing
 * out, so every element reads as undrawn, as the one hidden on a phone is.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

const SECTIONS: readonly SettingsDialogSection<string>[] = [
  { id: "general", title: "General", icon: null },
  { id: "people", title: "People", icon: null },
];

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks: nothing is laid out here. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

/** An owner holding which section shows, drawing a line naming it as the section's content. */
function Owner(): React.JSX.Element {
  const [current, setCurrent] = useState("general");

  return createElement(SettingsDialog<string>, {
    open: true,
    title: "Release Manager",
    sections: SECTIONS,
    current,
    onChoose: setCurrent,
    onDismiss: () => undefined,
    children: createElement("p", null, `${current} rows`),
  });
}

/** The dialog drawn open into the document. */
function render(): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Owner)));
}

/** The text of the element `id` names, as an accessible name reads it. */
function named(element: Element | null): string | undefined {
  const id = element?.getAttribute("aria-labelledby");

  return id === null || id === undefined ? undefined : document.getElementById(id)?.textContent;
}

/** The list's place named `name`. */
function place(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("li button")].find(
    (button) => button.textContent === name,
  );

  if (found === undefined) throw new Error(`no place named ${name}`);

  return found;
}

test("the card is named by its title, and pressing a place turns the section shown to it", () => {
  render();

  expect(named(document.querySelector("[role=dialog]"))).toBe("Release Manager");
  expect(place("General").getAttribute("aria-current")).toBe("page");
  expect(named(document.querySelector("section"))).toBe("General");

  act(() => place("People").click());

  expect(place("People").getAttribute("aria-current")).toBe("page");
  expect(place("General").getAttribute("aria-current")).toBeNull();
  expect(named(document.querySelector("section"))).toBe("People");
  expect(document.querySelector("section")?.textContent).toContain("people rows");
});

test("on a phone, the keyboard goes to the way back as a section opens, and back to its place as the list returns", () => {
  render();

  act(() => {
    place("People").focus();
    place("People").click();
  });

  const back = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Release Manager",
  );

  expect(back).toBeDefined();
  expect(document.activeElement).toBe(back);

  act(() => back?.click());

  expect(document.activeElement).toBe(place("People"));
});
