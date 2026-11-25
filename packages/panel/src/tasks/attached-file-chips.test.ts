// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { attachmentChipName } from "../testing/attachment-chip.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";

/**
 * attached-file-chips.test.ts -- the message box's way off takes a file off
 * on the press, so the box no longer holds it and its chip goes with it; and
 * of two files alike, the one pressed is the one taken off.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SPEC: AgentAttachment = {
  name: "spec.pdf",
  mediaType: "application/pdf",
  data: "JVBERi0=",
};

const NOTES: AgentAttachment = { name: "notes.txt", mediaType: "text/plain", data: "aGk=" };

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** A message box holding `start`, taking a file off by its place as the box does, and on with Add. */
function Box({
  start,
  held,
}: {
  start: readonly AgentAttachment[];
  held: { now: readonly AgentAttachment[] };
}): React.JSX.Element {
  const [files, setFiles] = useState(start);
  held.now = files;

  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setFiles([...files, NOTES]) }, "Add"),
    createElement(AttachedFileChips, {
      files: attachmentChips(files),
      onRemove: (index: number) => setFiles(files.filter((_, at) => at !== index)),
    }),
  );
}

function draw(start: readonly AgentAttachment[]) {
  const held = { now: start };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(withQueryClient(createElement(Box, { start, held }))));

  return held;
}

/** The chips drawn, in order, by the name their way off is heard by. */
function chips(): HTMLLIElement[] {
  return [...document.querySelectorAll<HTMLLIElement>("li.ui-attachment-chip")];
}

function remove(chip: HTMLLIElement | undefined): void {
  const off = chip?.querySelector<HTMLButtonElement>("button[aria-label^='Remove']");
  act(() => (off ?? assert.fail("a way off")).click());
}

test("the way off takes the file off on the press, its chip with it", () => {
  const held = draw([SPEC, NOTES]);
  remove(chips()[0]);
  assert.deepEqual(held.now, [NOTES], "the box no longer holds it");
  assert.deepEqual(chips().map(attachmentChipName), ["notes.txt"]);
});

test("of two files alike, the one whose way off is pressed is the one taken off", () => {
  const twin = { ...SPEC };
  const held = draw([SPEC, twin]);
  remove(chips()[1]);
  assert.equal(held.now.length, 1);
  assert.equal(held.now[0], SPEC, "the first stays");
  assert.equal(chips().length, 1);
});

test("a text file whose bytes spell no base64 still draws its chip, by its name", () => {
  draw([{ name: "broken.txt", mediaType: "text/plain", data: "%%%" }]);
  assert.equal(chips().length, 1);
  assert.equal(chips()[0]?.textContent?.includes("broken.txt"), true);
});
