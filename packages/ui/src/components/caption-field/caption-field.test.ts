// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CAPTION_LEAVE, CaptionField, type CaptionLeave } from "./caption-field.js";

/**
 * caption-field.test.ts -- a caption typed in place holds one paragraph, a
 * line break typed or pasted becoming a space; Return leaves it for a new
 * line, ↓ for the line that follows, and ↑ from its start for the picture
 * above, none of them while an input method composes.
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

/** A caption its caller holds, with every leave it heard. */
function mount(start: string) {
  const left: CaptionLeave[] = [];

  function Held(): React.JSX.Element {
    const [words, setWords] = useState(start);

    return createElement(CaptionField, {
      label: "Caption",
      value: words,
      onChange: setWords,
      onLeave: (way: CaptionLeave) => left.push(way),
    });
  }

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Held)));
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Caption"]');

  return { field: field ?? assert.fail("no caption field"), left };
}

function type(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses `key` with the caret at `caret`. */
function press(field: HTMLTextAreaElement, key: string, caret: number, init?: KeyboardEventInit) {
  field.setSelectionRange(caret, caret);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

test("a line break typed or pasted into a caption is a space", () => {
  const { field } = mount("");
  type(field, "Before\nand after\r\nthe change");
  assert.equal(field.value, "Before and after the change");
});

test("Return leaves for a new line, ↓ for the next, ↑ from the start for the picture, and none while composing", () => {
  const { field, left } = mount("Settings");
  press(field, "Enter", 3);
  press(field, "ArrowDown", 8);
  press(field, "ArrowUp", 0);
  press(field, "Enter", 3, { isComposing: true });
  press(field, "ArrowUp", 0, { keyCode: 229 });
  assert.deepEqual(left, [CAPTION_LEAVE.NEW_LINE, CAPTION_LEAVE.DOWN, CAPTION_LEAVE.UP]);
});
