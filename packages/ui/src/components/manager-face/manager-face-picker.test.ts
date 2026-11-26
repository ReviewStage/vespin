// @vitest-environment jsdom

import type { ManagerFace } from "@repo/features/manager-face";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { onQueryClient } from "../../testing/confirm-act.js";
import { ManagerFacePicker, type ManagerFaceRecent } from "./manager-face-picker.js";

/**
 * manager-face-picker.test.ts -- a face pressed asks its colors, gray first
 * then the section colors, and the color pressed picks the face in it and
 * keeps it first in Recent; a search finds an emoji typed first, then the
 * characters, then the emoji by name, and Enter presses the first found; an
 * emoji picked keeps the character standing beside it; and the Emoji tab's
 * category bar stands beside the grid, never among its choices.
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

/** Stands in for the browser's ResizeObserver, which jsdom lacks and a face's colors place themselves by. */
function standInResizeObserver(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

/** Recent as a window keeps it, in memory. */
function memoryRecent(faces: readonly ManagerFace[]): ManagerFaceRecent & { faces: ManagerFace[] } {
  const kept = { faces: [...faces] };

  return {
    get faces() {
      return kept.faces;
    },
    read: () => kept.faces,
    write: (next) => {
      kept.faces = [...next];
    },
  };
}

/** Mounts the picker over a face it keeps itself, starting on `start`, and hands back each face picked. */
function mount(start: ManagerFace, recent: ManagerFaceRecent): ManagerFace[] {
  const picked: ManagerFace[] = [];

  function Picker(): React.JSX.Element {
    const [face, setFace] = useState<ManagerFace>(start);

    return createElement(ManagerFacePicker, {
      face,
      recent,
      onChange: (next) => {
        picked.push(next);
        setFace(next);
      },
    });
  }

  standInResizeObserver();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onQueryClient(createElement(Picker))));

  return picked;
}

/** The names of the grid's groups, in order. */
function groups(): string[] {
  return [...document.querySelectorAll("fieldset section")].map(
    (group) => group.getAttribute("aria-label") ?? "",
  );
}

/** The names of the choices under the group named `name`. */
function offered(name: string): string[] {
  const group = document.querySelector(`fieldset section[aria-label="${name}"]`);

  return [...(group?.querySelectorAll("button") ?? [])].map(
    (choice) => choice.getAttribute("aria-label") ?? "",
  );
}

/** The names of the grid's choices pressed. */
function pressed(): string[] {
  return [...document.querySelectorAll('fieldset button[aria-pressed="true"]')].flatMap((choice) =>
    choice.closest(".ui-icon-picker-flyout") === null
      ? [choice.getAttribute("aria-label") ?? ""]
      : [],
  );
}

/** The names of the colors standing popped up, those pressed alone where `pressedOnly`. */
function colorNames(pressedOnly = false): string[] {
  const selector = pressedOnly ? 'button[aria-pressed="true"]' : "button";

  return [...document.querySelectorAll(`.ui-icon-picker-flyout ${selector}`)].map(
    (one) => one.getAttribute("aria-label") ?? "",
  );
}

/** The button named `label`, wherever it stands. */
function button(label: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  if (found === null) throw new Error(`no ${label}`);

  return found;
}

/** Types `words` into the search as a reader does. */
function search(words: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>("input");

  if (field === null) throw new Error("no search");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  return field;
}

test("a character pressed asks its colors, gray first, and the color pressed picks it and keeps it first in Recent", async () => {
  const recent = memoryRecent([{ character: "mug", color: "red" }]);
  const picked = mount({ character: "ghost", color: "blue" }, recent);

  expect(groups()).toEqual(["Recent", "Characters"]);
  expect(offered("Recent")).toEqual(["Red mug"]);
  expect(offered("Characters")).toEqual([
    "Ghost",
    "Planet",
    "Cat",
    "Backpack",
    "Mug",
    "Speech bubble",
  ]);
  expect(pressed()).toEqual(["Ghost"]);

  await act(async () => button("Cat").click());
  expect(colorNames()).toEqual([
    "Gray",
    "Red",
    "Orange",
    "Yellow",
    "Green",
    "Teal",
    "Blue",
    "Purple",
    "Pink",
  ]);
  expect(colorNames(true)).toEqual(["Gray"]);

  await act(async () => button("Teal").click());
  expect(picked).toEqual([{ character: "cat", color: "teal" }]);
  expect(colorNames()).toEqual([]);
  expect(recent.faces).toEqual([
    { character: "cat", color: "teal" },
    { character: "mug", color: "red" },
  ]);

  // The face standing asks its colors from its own.
  await act(async () => button("Cat").click());
  expect(colorNames(true)).toEqual(["Teal"]);
});

test("a search finds an emoji typed first, then the characters, then the emoji by name, and Enter presses the first; an emoji picked keeps the character standing", async () => {
  const recent = memoryRecent([]);
  const picked = mount({ character: "ghost", color: "blue" }, recent);

  search("🐱");
  await vi.waitFor(() => expect(groups()).toEqual(["Emoji"]));
  expect(offered("Emoji")).toEqual(["🐱"]);

  search("cat");
  await vi.waitFor(() => expect(groups()).toEqual(["Characters", "Emoji"]));
  expect(offered("Characters")).toEqual(["Cat"]);
  expect(offered("Emoji")).toContain("cat face");

  const field = search("fox");
  await vi.waitFor(() => expect(offered("Emoji")[0]).toBe("fox"));
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(colorNames(true)).toEqual(["Gray"]);

  await act(async () => button("Purple").click());
  expect(picked).toEqual([{ character: "ghost", color: "purple", emoji: "🦊" }]);
  expect(recent.faces).toEqual([{ character: "ghost", color: "purple", emoji: "🦊" }]);
});

test("the Emoji tab offers Slack's categories in a bar beside the grid, and Enter with nothing searched still presses the grid's first emoji", async () => {
  mount({ character: "ghost", color: "blue" }, memoryRecent([]));

  await act(async () =>
    document.querySelector<HTMLElement>('[role="tab"]:not([aria-selected="true"])')?.click(),
  );
  await vi.waitFor(() => expect(groups()[0]).toBe("Smileys & People"));

  const bar = [...document.querySelectorAll('[role="toolbar"] button')];
  expect(bar.map((one) => one.getAttribute("aria-label"))).toEqual(groups());
  expect(bar.map((one) => one.getAttribute("aria-current"))[0]).toBe("true");

  await act(async () => {
    search("").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(document.querySelector(".ui-icon-picker-flyout")?.getAttribute("aria-label")).toBe(
    "grinning face color",
  );
});
