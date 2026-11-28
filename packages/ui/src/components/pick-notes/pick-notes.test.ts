// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { type PickNote, PickNoteCard, PickNoteTray } from "./pick-notes.js";

/**
 * pick-notes.test.ts -- a note's card adds its words only once there are
 * some, and lets them go on Escape; the tray lists the notes by their
 * numbers and words, removes the one pressed, sends them all, and draws
 * nothing while there are none.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

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

const NOTES: readonly PickNote[] = [
  {
    id: "first",
    number: 1,
    words: "Tighten this copy",
    element: "p.summary",
    picture: "data:image/jpeg;base64,AA==",
  },
  {
    id: "second",
    number: 2,
    words: "Make this the primary action",
    element: 'button "Place order"',
    picture: "data:image/jpeg;base64,AA==",
  },
];

test("a note's card adds its words only once there are some, and lets them go on Escape", () => {
  const told: string[] = [];

  const card = (value: string) =>
    createElement(PickNoteCard, {
      value,
      onChange: () => undefined,
      onAdd: () => told.push(`add ${value}`),
      onCancel: () => told.push("cancel"),
      adds: "Add note",
    });

  const empty = render(card(" "));

  const enter = () =>
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });

  act(() => {
    empty.querySelector("textarea")?.dispatchEvent(enter());
  });

  const written = render(card("Too gray"));
  act(() => {
    written.querySelector("textarea")?.dispatchEvent(enter());
    written
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  });

  assert.deepEqual(told, ["add Too gray", "cancel"]);
});

test("the tray lists the notes by number, removes the one pressed, and sends them all", () => {
  const told: string[] = [];

  const tray = render(
    createElement(PickNoteTray, {
      notes: NOTES,
      sendLabel: "Send to Invite expiry",
      sending: false,
      onRemove: (id) => told.push(`remove ${id}`),
      onClear: () => told.push("clear"),
      onSend: () => told.push("send"),
    }),
  );

  const rows = [...tray.querySelectorAll("li")].map((row) => row.textContent);
  assert.deepEqual(rows, [
    "1Tighten this copyp.summary",
    '2Make this the primary actionbutton "Place order"',
  ]);

  const press = (name: string) =>
    act(() => {
      [...tray.querySelectorAll("button")]
        .find((button) => (button.getAttribute("aria-label") ?? button.textContent) === name)
        ?.click();
    });

  press("Remove note 2");
  press("Send to Invite expiry");
  assert.deepEqual(told, ["remove second", "send"]);
});

test("the tray draws nothing while there are no notes", () => {
  const tray = render(
    createElement(PickNoteTray, {
      notes: [],
      sendLabel: "Send",
      sending: false,
      onRemove: () => undefined,
      onClear: () => undefined,
      onSend: () => undefined,
    }),
  );

  assert.equal(tray.childElementCount, 0);
});
