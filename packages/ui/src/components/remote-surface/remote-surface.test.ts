// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import {
  REMOTE_KEY_ACTION,
  REMOTE_POINTER_ACTION,
  type RemoteKey,
  type RemotePicking,
  type RemotePoint,
  type RemotePointer,
  RemoteSurface,
  type RemoteWheel,
} from "./remote-surface.js";

/**
 * remote-surface.test.ts -- while it is driven, what the member does over
 * the surface is handed on: a mouse's point held inside it, a wheel in
 * pixels, a key only the owner takes kept from the window, a paste as its
 * words; while it is watched, nothing is.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A 200 by 100 surface at the page's corner, everything it hands on recorded. */
function mount(
  driving: boolean,
  takes: (key: RemoteKey) => boolean = () => true,
  picking?: RemotePicking,
) {
  const pointers: RemotePointer[] = [];
  const wheels: RemoteWheel[] = [];
  const keys: RemoteKey[] = [];
  const pastes: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(RemoteSurface, {
        label: "The page",
        width: 200,
        height: 100,
        driving,
        onPointer: (input) => pointers.push(input),
        onWheel: (input) => wheels.push(input),
        onKey: (input) => {
          keys.push(input);

          return takes(input);
        },
        onPaste: (text) => pastes.push(text),
        picking,
      }),
    ),
  );
  const canvas = container.querySelector("canvas");

  if (canvas === null) throw new Error("the surface is drawn");

  return { canvas, pointers, wheels, keys, pastes };
}

test("a driven surface hands on a press held inside it, with its button and click", () => {
  const { canvas, pointers } = mount(true);
  act(() => {
    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 250,
        clientY: 40,
        button: 2,
        buttons: 2,
        detail: 2,
        shiftKey: true,
      }),
    );
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -5, clientY: 10 }));
  });
  expect(pointers).toEqual([
    {
      action: REMOTE_POINTER_ACTION.DOWN,
      x: 200,
      y: 40,
      button: 2,
      buttons: 2,
      clickCount: 2,
      modifiers: { alt: false, control: false, meta: false, shift: true },
    },
    {
      action: REMOTE_POINTER_ACTION.MOVE,
      x: 0,
      y: 10,
      button: undefined,
      buttons: 0,
      clickCount: 0,
      modifiers: { alt: false, control: false, meta: false, shift: false },
    },
  ]);
  expect(document.activeElement).toBe(canvas);
});

test("a driven surface counts a wheel's lines in pixels and keeps the panel from scrolling", () => {
  const { canvas, wheels } = mount(true);

  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 30,
    deltaY: 3,
    deltaMode: 1,
  });

  act(() => {
    canvas.dispatchEvent(wheel);
  });
  expect(wheels).toEqual([
    {
      x: 20,
      y: 30,
      deltaX: 0,
      deltaY: 48,
      modifiers: { alt: false, control: false, meta: false, shift: false },
    },
  ]);
  expect(wheel.defaultPrevented).toBe(true);
});

test("a key the owner takes is kept from the window, and one it leaves is not", () => {
  const { canvas, keys } = mount(true, (key) => key.key !== "w");

  const typed = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "a",
    code: "KeyA",
  });

  const closing = new KeyboardEvent("keyup", {
    bubbles: true,
    cancelable: true,
    key: "w",
    metaKey: true,
  });

  act(() => {
    canvas.dispatchEvent(typed);
    canvas.dispatchEvent(closing);
  });
  expect(keys.map(({ action, key }) => [action, key])).toEqual([
    [REMOTE_KEY_ACTION.DOWN, "a"],
    [REMOTE_KEY_ACTION.UP, "w"],
  ]);
  expect(typed.defaultPrevented).toBe(true);
  expect(closing.defaultPrevented).toBe(false);
});

test("a watched surface hands nothing on and leaves the system's own", () => {
  const { canvas, pointers, keys, wheels } = mount(false);
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 5 });
  act(() => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    canvas.dispatchEvent(menu);
    canvas.dispatchEvent(wheel);
  });
  expect([pointers, keys, wheels]).toEqual([[], [], []]);
  expect(menu.defaultPrevented).toBe(false);
  expect(wheel.defaultPrevented).toBe(false);
  expect(canvas.tabIndex).toBe(-1);
});

test("a surface picking tells its owner where the pointer goes and what it presses, hands the page none of it, and ends on Escape", () => {
  const inspected: (RemotePoint | undefined)[] = [];
  const picked: RemotePoint[] = [];
  let ended = 0;

  const { canvas, pointers, keys } = mount(true, () => true, {
    onInspect: (point) => inspected.push(point),
    onPick: (point) => picked.push(point),
    onEnd: () => {
      ended += 1;
    },
  });

  const press = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 25,
  });

  const escapePress = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });

  act(() => {
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 30, clientY: 20 }));
    canvas.dispatchEvent(press);
    canvas.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 40, clientY: 25 }));
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 40, clientY: 25, button: 2 }),
    );
    canvas.dispatchEvent(escapePress);
  });
  expect(inspected).toEqual([{ x: 30, y: 20 }]);
  expect(picked).toEqual([{ x: 40, y: 25 }]);
  expect(ended).toBe(1);
  expect(escapePress.defaultPrevented).toBe(true);
  // The press moves no focus of the browser's own, so a field the pick opens keeps it.
  expect(press.defaultPrevented).toBe(true);
  expect([pointers, keys]).toEqual([[], []]);
});
