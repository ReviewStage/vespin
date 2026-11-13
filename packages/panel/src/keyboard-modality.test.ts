// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useKeyboardModality } from "./keyboard-modality.js";

/**
 * keyboard-modality.test.ts -- a popup that opens on its own, as an agent's
 * ask does while someone types, opens with no focus ring on the control it
 * focuses: arrows in a field mark no keyboard, and focus a popup takes for
 * itself clears the mark that a Tab long before had set.
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
  vi.useRealTimers();
});

test("arrows in a field mark no keyboard, and an ask that takes focus later clears what a Tab marked; a Tab within it rings again", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
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

  vi.advanceTimersByTime(5_000);
  const ask = document.createElement("div");
  ask.setAttribute("role", "alertdialog");
  const deny = document.createElement("button");
  const allow = document.createElement("button");
  ask.append(deny, allow);
  document.body.append(ask);
  deny.focus();
  assert.equal(keyboardMarked(), false);

  deny.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  allow.focus();
  assert.equal(keyboardMarked(), true);
});
