// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { PICTURE_STATE } from "../../picture-read.js";
import { AppWindowStack } from "./app-window-stack.js";

/**
 * app-window-stack.test.ts -- the window on top opens when pressed, named
 * for its app, and a stack of no apps draws nothing.
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

test("the window on top opens when pressed, named for its app", () => {
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
    onOpen: () => opened.push("open"),
  });

  const press = [...document.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === "Enlarge Simulator",
  );
  act(() => press?.click());
  assert.deepEqual(opened, ["open"]);
});

test("a stack of no apps draws nothing", () => {
  draw({ label: "Apps in use", apps: [], onOpen: () => undefined });

  assert.equal(document.querySelector('section[aria-label="Apps in use"]'), null);
});
