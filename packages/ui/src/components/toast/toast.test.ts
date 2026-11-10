// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@repo/brand";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { STATUS_TONE } from "../../status-tone.js";
import { Toast, type ToastTone } from "./toast.js";
import { ToastActions } from "./toast-actions.js";
import { createToastManager, type StandingToast, ToastStack } from "./toast-stack.js";

/**
 * toast.test.ts -- the stack draws each toast its manager is handed, in a
 * named landmark, each toast named by its words; a toast's action dismisses
 * it before it presses, and one given an href is a link that does the same
 * without the browser following it; a turn of tone changes its words in
 * place; and its × says Dismiss in a hint. What Base UI keeps (holds,
 * Escape, swipes, what is said aloud) is Base UI's to test.
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

/** What a test's toast says, and what stands at its end. */
interface Shown {
  readonly tone: ToastTone;
  readonly words: string;
  readonly detail?: string;
  readonly actions?: ReactNode;
}

/** A stack drawn in the document, and a way to show a toast on it. */
function stack(): (shown: Shown, id?: string) => void {
  const manager = createToastManager<Shown>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const draw = (toast: StandingToast<Shown>) => {
    const shown = toast.data;
    return shown === undefined ? null : createElement(Toast, { key: toast.id, toast, ...shown });
  };
  act(() =>
    root.render(
      createElement(ToastStack<Shown>, {
        manager,
        label: "Notifications",
        container,
        children: draw,
      }),
    ),
  );
  return (shown, id) => act(() => void manager.add({ id, timeout: 0, data: shown }));
}

/** A toast with an Undo that records its dismissal and its press in `calls`. */
function undoable(calls: string[]): Shown {
  return {
    tone: STATUS_TONE.COMPLETE,
    words: "Task archived",
    actions: createElement(ToastActions, {
      label: "Undo",
      onPress: () => calls.push("press"),
      dismissLabel: "Dismiss",
      onDismiss: () => calls.push("dismiss"),
    }),
  };
}

test("the stack draws each toast its manager is handed, in a named landmark, each named by its words", () => {
  const show = stack();
  show({ tone: STATUS_TONE.DANGER, words: "Couldn't save", detail: "Offline" });

  const landmark = document.querySelector('[role="region"][aria-label="Notifications"]');
  assert.ok(landmark !== null, "a named landmark");
  const toast = landmark.querySelector(".ui-toast");
  assert.ok(toast !== null);
  const named = document.getElementById(toast.getAttribute("aria-labelledby") ?? "");
  assert.equal(named?.textContent, "Couldn't save");
  const described = document.getElementById(toast.getAttribute("aria-describedby") ?? "");
  assert.equal(described?.textContent, "Offline");
  assert.equal(toast.querySelectorAll("button").length, 0, "one with no action has no press");
});

test("a toast's action dismisses it before it presses", () => {
  const calls: string[] = [];
  stack()(undoable(calls));
  const undo = [...document.querySelectorAll("button")].find((b) => b.textContent === "Undo");
  assert.ok(undo !== undefined);
  act(() => undo.click());
  assert.deepEqual(calls, ["dismiss", "press"]);
});

test("an action given an href is a link to it in the action's look, and its press dismisses, then presses, without the browser following it", () => {
  const calls: string[] = [];
  stack()({
    tone: STATUS_TONE.DANGER,
    words: "Out of credit",
    actions: createElement(ToastActions, {
      label: "Add credit",
      href: "https://example.test/billing",
      onPress: () => calls.push("press"),
      dismissLabel: "Dismiss",
      onDismiss: () => calls.push("dismiss"),
    }),
  });
  const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "Add credit");
  assert.ok(link !== undefined, "the action is a link");
  assert.equal(link.getAttribute("href"), "https://example.test/billing");
  assert.equal(
    [...document.querySelectorAll("button")].some((b) => b.textContent === "Add credit"),
    false,
    "and no button",
  );
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(click);
  });
  assert.deepEqual(calls, ["dismiss", "press"]);
  assert.equal(click.defaultPrevented, true);
});

test("a toast whose tone turns changes its words in place", () => {
  const show = stack();
  show({ tone: STATUS_TONE.WORKING, words: "Saving…" }, "work");
  const toast = document.querySelector(".ui-toast");

  show({ tone: STATUS_TONE.COMPLETE, words: "Saved" }, "work");

  assert.equal(document.querySelector(".ui-toast"), toast, "the same card");
  assert.equal(document.querySelector(".ui-toast-words")?.textContent, "Saved");
});

/** The words of the hint the pointer resting on `target` raises, past the hint's wait, on a faked clock. */
function hintOn(target: Element): string | undefined {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
    });
    return document.querySelector('[role="tooltip"]')?.textContent ?? undefined;
  } finally {
    vi.useRealTimers();
  }
}

test("a toast's × says Dismiss in a hint on hover", () => {
  stack()(undoable([]));
  const dismiss = document.querySelector('button[aria-label="Dismiss"]');
  assert.ok(dismiss !== null);
  assert.equal(hintOn(dismiss), "Dismiss");
});
