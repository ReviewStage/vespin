// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { APPROVAL_CARD_ANSWER, ApprovalCard, type ApprovalCardAnswer } from "./approval-card.js";

/**
 * approval-card.test.ts -- Deny… opens a note rather than denying, and Deny
 * sends the note's words with the denial.
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

test("Deny… opens a note, and Deny sends its words with the denial", () => {
  const heard: { answer: ApprovalCardAnswer; message: string | undefined }[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ApprovalCard, {
        title: "Claude wants to run a command",
        detail: { label: "Command", text: "rm -rf dist" },
        onAnswer: (answer, message) => {
          heard.push({ answer, message });
        },
      }),
    ),
  );

  act(() => button("Deny…").click());
  assert.deepEqual(heard, []);
  const note =
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Why you denied it"]') ??
    assert.fail("no note");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(note, "  Build it instead  ");
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button("Deny").click());

  assert.deepEqual(heard, [{ answer: APPROVAL_CARD_ANSWER.DENY, message: "Build it instead" }]);
});
