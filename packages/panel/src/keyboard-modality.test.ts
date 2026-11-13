// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useKeyboardModality } from "./keyboard-modality.js";

/**
 * keyboard-modality.test.ts -- arrows typed in a field move its caret, not
 * focus, so they leave no keyboard mark for the next popup's focused control
 * to ring by; a Tab still marks it.
 */

let root: Root | undefined;

function Probe(): null {
  useKeyboardModality();

  return null;
}

function keyboardMarked(): boolean {
  return document.documentElement.dataset.keyboard === "true";
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete document.documentElement.dataset.keyboard;
});

test("arrows typed in a field leave no keyboard mark, and a Tab marks it", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const field = document.createElement("textarea");
  document.body.append(host, field);
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });

  field.focus();
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(keyboardMarked(), false);

  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(keyboardMarked(), true);
});
