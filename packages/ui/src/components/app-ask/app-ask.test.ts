// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { AppAsk } from "./app-ask.js";

/**
 * app-ask.test.ts -- the ask lands on Deny, names the app it asks about and
 * which one it is by its bundle id; Allow allows always unless Allow once is
 * picked; and Escape, which waves the card away, denies rather than allows.
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

/** The button whose name is `name`, wherever it stands. */
function button(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find((each) => each.textContent === name) ??
    assert.fail(`no ${name} button`)
  );
}

/** The radio whose label is `label`, wherever it stands. */
function radio(label: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((each) =>
      each.textContent?.includes(label),
    ) ?? assert.fail(`no ${label} radio`)
  );
}

/** The ask drawn about Simulator, each answer counted under its name. */
function asked(): Record<"once" | "always" | "deny", number> {
  const heard = { once: 0, always: 0, deny: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AppAsk, {
        open: true,
        app: { name: "Simulator", bundleId: "com.apple.iphonesimulator" },
        onAllowOnce: () => {
          heard.once += 1;
        },
        onAllowAlways: () => {
          heard.always += 1;
        },
        onDeny: () => {
          heard.deny += 1;
        },
      }),
    ),
  );
  return heard;
}

test("it lands on Deny, names the app it asks about, and says which one it is by its bundle id", () => {
  asked();
  const card = document.querySelector('[role="alertdialog"]') ?? assert.fail("no card");
  const title = document.getElementById(card.getAttribute("aria-labelledby") ?? "");
  assert.equal(title?.textContent, "Let agents use Simulator?");
  assert.ok(card.textContent?.includes("com.apple.iphonesimulator"));
  assert.equal(document.activeElement, button("Deny"));
});

test("Allow allows always unless Allow once is picked, Deny denies, and Escape denies", () => {
  const heard = asked();
  act(() => button("Allow").click());
  act(() => radio("Allow once").click());
  act(() => button("Allow").click());
  act(() => button("Deny").click());
  assert.deepEqual(heard, { once: 1, always: 1, deny: 1 });

  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.deepEqual(heard, { once: 1, always: 1, deny: 2 });
});
