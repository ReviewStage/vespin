// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { UNREPORTED } from "../../reported-failure.js";
import { UPLOAD_COVER_SIZE, UPLOAD_COVER_STATE, UploadCover } from "./upload-cover.js";

/**
 * upload-cover.test.ts -- a picture going up is heard as uploading by its
 * name; one whose upload failed says why as an alert on it, offering Retry
 * and Remove named for the file, which answer by pointer and keyboard, and
 * no Retry where its caller has none to offer.
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

/** A cover drawn over a box of the page, as its callers lay it over a picture. */
function drawn(props: Parameters<typeof UploadCover>[0]): HTMLElement {
  const box = document.createElement("span");
  document.body.append(box);
  const root = createRoot(box);
  roots.push(root);
  act(() => root.render(createElement(UploadCover, props)));

  return box;
}

/** The names of every button a reader hears. */
function buttonNames(box: HTMLElement): (string | null)[] {
  return [...box.querySelectorAll("button")].map((each) => each.getAttribute("aria-label"));
}

test("a picture going up is heard as uploading by its name, offering nothing to press", () => {
  const box = drawn({
    size: UPLOAD_COVER_SIZE.BLOCK,
    state: UPLOAD_COVER_STATE.UPLOADING,
    name: "Screenshot",
  });

  const meter = box.querySelector('[role="progressbar"]') ?? assert.fail("a progress bar");
  assert.equal(meter.getAttribute("aria-label"), "Uploading Screenshot");
  assert.deepEqual(buttonNames(box), []);
});

test("a failed upload says why as an alert, and Retry and Remove answer for the file", () => {
  const pressed: string[] = [];

  const box = drawn({
    size: UPLOAD_COVER_SIZE.BLOCK,
    state: UPLOAD_COVER_STATE.FAILED,
    name: "Screenshot",
    failure: UNREPORTED.INPUT,
    onRetry: () => pressed.push("retry"),
    onRemove: () => pressed.push("remove"),
    children: "The image could not be uploaded.",
  });

  assert.equal(
    box.querySelector('[role="alert"]')?.textContent,
    "The image could not be uploaded.",
  );
  assert.deepEqual(buttonNames(box), ["Retry Screenshot", "Remove Screenshot"]);
  const [retry, remove] = [...box.querySelectorAll("button")];
  act(() => retry?.click());
  act(() => remove?.focus());
  assert.equal(document.activeElement, remove, "a Tab stop");
  act(() => remove?.click());
  assert.deepEqual(pressed, ["retry", "remove"]);
});

test("a refusal a second try could not mend offers Remove alone", () => {
  const box = drawn({
    size: UPLOAD_COVER_SIZE.BLOCK,
    state: UPLOAD_COVER_STATE.FAILED,
    name: "notes.txt",
    failure: UNREPORTED.INPUT,
    onRemove: () => {},
    children: "This file is not a picture a description can keep.",
  });

  assert.deepEqual(buttonNames(box), ["Remove notes.txt"]);
});
