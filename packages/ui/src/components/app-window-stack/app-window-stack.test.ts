// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { PICTURE_STATE, type PictureState } from "../../picture-read.js";
import { AppWindowStack } from "./app-window-stack.js";

/**
 * app-window-stack.test.ts -- the window in front opens when pressed, named
 * for its app, keeps each app's last picture while the next is read, a title
 * behind it brings its app forward, and a stack of no apps draws nothing.
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

/** Draws the stack, and answers how to draw it again in place with new props. */
function draw(
  props: Parameters<typeof AppWindowStack>[0],
): (next: Parameters<typeof AppWindowStack>[0]) => void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(AppWindowStack, props)));

  return (next) => act(() => root.render(createElement(AppWindowStack, next)));
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
        id: "com.apple.iphonesimulator",
        name: "Simulator",
        window: {
          state: { kind: PICTURE_STATE.READY, url: "data:image/png;base64,AA==" },
          width: 1180,
          height: 2556,
        },
      },
      { id: "com.apple.dt.Xcode", name: "Xcode" },
    ],
    ...QUIET,
    onOpen: () => opened.push("open"),
  });

  act(() => press("Enlarge Simulator")?.click());
  assert.deepEqual(opened, ["open"]);
});

test("each app's window keeps its last picture while the next one is read, though another came forward between", () => {
  const PHONE = "data:image/png;base64,AA==";
  const EDITOR = "data:image/png;base64,AQ==";

  const stack = (shown: string, simulator: PictureState) => ({
    label: "Apps in use",
    apps: [
      {
        id: "com.apple.iphonesimulator",
        name: "Simulator",
        window: { state: simulator, width: 1180, height: 2556 },
      },
      {
        id: "com.apple.dt.Xcode",
        name: "Xcode",
        window: {
          state: { kind: PICTURE_STATE.READY, url: EDITOR } as const,
          width: 1440,
          height: 900,
        },
      },
    ],
    shown,
    ...QUIET,
  });

  const redraw = draw(
    stack("com.apple.iphonesimulator", { kind: PICTURE_STATE.READY, url: PHONE }),
  );

  redraw(stack("com.apple.dt.Xcode", { kind: PICTURE_STATE.READING }));
  redraw(stack("com.apple.iphonesimulator", { kind: PICTURE_STATE.READING }));
  assert.equal(document.querySelector("img")?.getAttribute("src"), PHONE);
});

test("a title behind the window in front brings its own app forward, though another app shares its name", () => {
  const picked: string[] = [];
  draw({
    label: "Apps in use",
    apps: [
      { id: "com.apple.dt.Xcode", name: "Xcode" },
      { id: "com.apple.dt.Xcode.beta", name: "Xcode" },
    ],
    ...QUIET,
    onPick: (id) => picked.push(id),
  });

  act(() => press("Bring Xcode forward")?.click());
  assert.deepEqual(picked, ["com.apple.dt.Xcode.beta"]);
});

test("a stack of no apps draws nothing", () => {
  draw({ label: "Apps in use", apps: [], ...QUIET });

  assert.equal(document.querySelector('section[aria-label="Apps in use"]'), null);
});
