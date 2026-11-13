// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { PICTURE_STATE } from "../../picture-read.js";
import { AppWindowStack } from "./app-window-stack.js";

/**
 * app-window-stack.test.ts -- the window in front opens when pressed, named
 * for its app, a title behind it brings its app forward, and a stack of no
 * apps draws nothing.
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

function draw(props: Parameters<typeof AppWindowStack>[0]): void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(AppWindowStack, props)));
}

/** What every stack drawn here hears, but where a test listens. */
const QUIET = { onPick: () => undefined, onOpen: () => undefined, onMinimize: () => undefined };

/** The button a reader knows by this name. */
function press(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name,
  );
}

test("the window in front opens when pressed, named for its app", () => {
  const opened: string[] = [];
  draw({
    label: "Apps in use",
    apps: [
      {
        name: "Simulator",
        window: {
          state: { kind: PICTURE_STATE.READY, url: "data:image/png;base64,AA==" },
          width: 1180,
          height: 2556,
        },
      },
      { name: "Xcode" },
    ],
    ...QUIET,
    onOpen: () => opened.push("open"),
  });

  act(() => press("Enlarge Simulator")?.click());
  assert.deepEqual(opened, ["open"]);
});

test("a title behind the window in front brings its app forward", () => {
  const picked: string[] = [];
  draw({
    label: "Apps in use",
    apps: [{ name: "Simulator" }, { name: "Xcode" }],
    ...QUIET,
    onPick: (name) => picked.push(name),
  });

  act(() => press("Bring Xcode forward")?.click());
  assert.deepEqual(picked, ["Xcode"]);
});

test("a stack of no apps draws nothing", () => {
  draw({ label: "Apps in use", apps: [], ...QUIET });

  assert.equal(document.querySelector('section[aria-label="Apps in use"]'), null);
});
