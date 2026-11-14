// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type NameValueRow, NameValueRows } from "./name-value-rows.js";

/**
 * name-value-rows.test.ts -- a paste into a name field is handed to the
 * caller with its line breaks, and one the caller takes never lands in the
 * field; Remove stands on each line, named for it, only while there is more
 * than one.
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

/** The lines drawn, the paste answered as `takes` says, and every paste the caller heard. */
function render(rows: readonly NameValueRow[], takes: boolean): string[] {
  const heard: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  act(() =>
    root.render(
      createElement(NameValueRows, {
        rows,
        secret: true,
        namePlaceholder: "NAME",
        onName: () => undefined,
        onValue: () => undefined,
        onRemove: () => undefined,
        onPasteLines: (_key, text) => {
          heard.push(text);

          return takes;
        },
      }),
    ),
  );

  return heard;
}

/** A paste of `text` into the first name field, answering whether the field was kept from taking it. */
function paste(text: string): boolean {
  const name = document.querySelector('input[placeholder="NAME"]');
  assert.ok(name);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  act(() => name.dispatchEvent(event));

  return event.defaultPrevented;
}

const LINE: NameValueRow = { key: "one", name: "", value: "" };

test("a paste into a name is the caller's, line breaks and all, and one it takes never lands", () => {
  const heard = render([LINE], true);

  assert.equal(paste("A=1\nB=2"), true);
  assert.deepEqual(heard, ["A=1\nB=2"]);
});

test("a paste the caller declines lands as typing does", () => {
  render([LINE], false);

  assert.equal(paste("TOKEN"), false);
});

test("Remove stands on each line, named for it, only while there is more than one", () => {
  render([{ ...LINE, name: "API_TOKEN" }], false);
  assert.equal(document.querySelector('button[aria-label^="Remove"]'), null);

  act(() => roots[0]?.unmount());
  roots.splice(0);
  document.body.replaceChildren();
  render(
    [
      { ...LINE, name: "API_TOKEN" },
      { key: "two", name: "", value: "" },
    ],
    false,
  );

  const labels = [...document.querySelectorAll('button[aria-label^="Remove"]')].map((button) =>
    button.getAttribute("aria-label"),
  );

  assert.deepEqual(labels, ["Remove API_TOKEN", "Remove this line"]);
});
