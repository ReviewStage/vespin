// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { PICTURE_STATE } from "../../picture-read.js";
import { AppWindowStack } from "./app-window-stack.js";

/**
 * app-window-stack.test.ts -- the stack names the app on top and how many
 * others stand behind it; its window opens and its Stop stops, and a reader
 * who may not stop the agent finds no Stop.
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

/** The button named `name`, by its words or its label, or none. */
function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name || each.textContent === name,
  );
}

function draw(props: Parameters<typeof AppWindowStack>[0]): void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(AppWindowStack, props)));
}

const APPS = [
  {
    name: "Simulator",
    window: {
      state: { kind: PICTURE_STATE.READY, url: "data:image/png;base64,AA==" } as const,
      width: 1180,
      height: 2556,
    },
  },
  { name: "Xcode" },
  { name: "Safari" },
];

test("the app on top is named with how many others stand behind it, its window opens, and Stop stops", () => {
  const pressed: string[] = [];
  draw({
    label: "Apps in use",
    apps: APPS,
    using: true,
    onOpen: () => pressed.push("open"),
    onStop: () => pressed.push("stop"),
  });

  const stack = document.querySelector('section[aria-label="Apps in use"]');
  assert.match(stack?.textContent ?? "", /Simulator.*\+2 apps/);
  act(() => button("Enlarge Simulator")?.click());
  act(() => button("Stop")?.click());
  assert.deepEqual(pressed, ["open", "stop"]);
});

test("a reader who may not stop the agent finds no Stop", () => {
  draw({ label: "Apps in use", apps: APPS.slice(0, 1), using: false, onOpen: () => undefined });

  assert.equal(button("Stop"), undefined);
});
