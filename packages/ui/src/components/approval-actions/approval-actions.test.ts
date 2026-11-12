// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { APPROVAL_ACTION, type ApprovalAction, ApprovalActions } from "./approval-actions.js";

/**
 * approval-actions.test.ts -- Deny opens a field rather than denying, and
 * its Deny sends the field's words with the denial.
 */

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

/** The button whose words are `name`, wherever it stands. */
function button(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find((each) => each.textContent === name) ??
    assert.fail(`no ${name} button`)
  );
}

test("Deny opens a field, and its Deny sends the field's words with the denial", () => {
  const heard: { action: ApprovalAction; message: string | undefined }[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ApprovalActions, {
        onAnswer: (action, message) => {
          heard.push({ action, message });
        },
      }),
    ),
  );

  act(() => button("Deny").click());
  assert.deepEqual(heard, []);

  const note =
    document.querySelector<HTMLInputElement>('input[aria-label="Why you denied it"]') ??
    assert.fail("no field");

  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(note, "  Build it instead  ");
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button("Deny").click());

  assert.deepEqual(heard, [{ action: APPROVAL_ACTION.DENY, message: "Build it instead" }]);
});
