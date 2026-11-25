// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { ThreadReplies } from "./channel-message.js";

/**
 * channel-message.test.ts -- a thread's summary under its message counts
 * its replies in words and opens the thread when pressed.
 */

test("a thread's summary counts its replies and opens the thread", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const holder = document.createElement("div");
  document.body.append(holder);
  const root = createRoot(holder);
  let opened = 0;

  const draw = (count: number) =>
    act(() =>
      root.render(createElement(ThreadReplies, { count, faces: [], onOpen: () => (opened += 1) })),
    );

  await draw(1);
  assert.equal(holder.textContent, "1 reply");
  await draw(3);
  const press = holder.querySelector("button");
  assert.equal(press?.textContent, "3 replies");
  await act(() => press?.click());
  assert.equal(opened, 1);

  await act(() => root.unmount());
  holder.remove();
});
