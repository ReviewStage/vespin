// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type AsyncAction, rejectionWords, useAsyncAction } from "./use-async-action.js";

/**
 * use-async-action.test.ts -- a second press in the frame of the first starts
 * nothing, a refusal stands until the next press lets it go, and an act that
 * rejects ends refused rather than running.
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

/** Mounts a surface holding one action, answering the action as it was last drawn. */
function mount(): () => AsyncAction<string> {
  let action: AsyncAction<string> | undefined;
  function Surface() {
    action = useAsyncAction(rejectionWords);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Surface)));
  return () => {
    assert.ok(action);
    return action;
  };
}

/** An act the test answers by hand. */
function held() {
  let answer: (refusal: string | undefined) => void = () => undefined;
  const act = () =>
    new Promise<string | undefined>((resolve) => {
      answer = resolve;
    });
  return { act, answer: (refusal: string | undefined) => answer(refusal) };
}

test("a second press before the first settles starts nothing", async () => {
  const action = mount();
  const sent = held();
  let sends = 0;
  const press = () => {
    sends += 1;
    return sent.act();
  };
  // Both presses read the action as one draw left it, as two presses in one frame do.
  const drawn = action();
  let first: Promise<boolean> | undefined;
  let second: Promise<boolean> | undefined;
  act(() => {
    first = drawn.run(press);
    second = drawn.run(press);
  });
  assert.equal(sends, 1);
  assert.equal(await second, false);
  assert.equal(action().running, true);
  await act(async () => sent.answer(undefined));
  assert.equal(await first, true);
  assert.equal(action().running, false);
});

test("a refusal stands until the next press lets it go", async () => {
  const action = mount();
  const refused = held();
  act(() => void action().run(refused.act));
  await act(async () => refused.answer("The service is down."));
  assert.equal(action().refusal, "The service is down.");
  const again = held();
  act(() => void action().run(again.act));
  assert.equal(action().refusal, undefined);
  assert.equal(action().running, true);
  await act(async () => again.answer(undefined));
  assert.equal(action().refusal, undefined);
});

test("an act that rejects ends refused, not left running", async () => {
  const action = mount();
  let reject: (why: Error) => void = () => undefined;
  const rejecting = () =>
    new Promise<undefined>((_, fail) => {
      reject = fail;
    });
  let ran: Promise<boolean> | undefined;
  act(() => {
    ran = action().run(rejecting);
  });
  assert.equal(action().running, true);
  await act(async () => reject(new Error("The service did not answer.")));
  assert.equal(await ran, false);
  assert.equal(action().running, false);
  assert.equal(action().refusal, "The service did not answer.");
});
