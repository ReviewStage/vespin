// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { RenamableName } from "./renamable-name.js";

/**
 * renamable-name.test.ts -- a name is renamed by pressing it: the press
 * opens a field over the name in its place, Return keeps what was typed,
 * and a name with no way to open it is drawn plain, no press at all.
 * Synthetic names.
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

function render(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));

  return container;
}

/** A name its own owner holds, as a row holds its rename. */
function Owned({ ended }: { ended: (value: string | undefined) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);

  return createElement(RenamableName, {
    value: "Dev server",
    label: "Run action name",
    editing,
    onBegin: () => setEditing(true),
    onEnd: ({ value }) => {
      setEditing(false);
      ended(value);
    },
  });
}

test("pressing the name opens a field over it, and Return keeps what was typed and hands focus back to the name", () => {
  const ends: (string | undefined)[] = [];
  const container = render(createElement(Owned, { ended: (value) => ends.push(value) }));
  const press = container.querySelector("button") ?? expect.fail("No press");
  expect({ name: press.textContent, says: press.getAttribute("aria-description") }).toEqual({
    name: "Dev server",
    says: "Rename",
  });
  act(() => press.click());
  const field = container.querySelector("input") ?? expect.fail("No field");
  expect(field.value).toBe("Dev server");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(field, "Web server");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect({
    ends,
    open: container.querySelector("input") !== null,
    focused: document.activeElement === container.querySelector("button"),
  }).toEqual({
    ends: ["Web server"],
    open: false,
    focused: true,
  });
});

test("a name with no way to open it is drawn plain", () => {
  const container = render(
    createElement(RenamableName, {
      value: "Dev server",
      label: "Run action name",
      editing: false,
      onBegin: undefined,
      onEnd: () => {},
    }),
  );

  expect({ text: container.textContent, press: container.querySelector("button") }).toEqual({
    text: "Dev server",
    press: null,
  });
});
