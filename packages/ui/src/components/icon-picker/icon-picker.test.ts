// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { IconPickerChoice, IconPickerDrawer, IconPickerGroup } from "./icon-picker.js";

/**
 * icon-picker.test.ts -- what a choice opens stands in a drawer under the
 * whole of that choice's row, so the row reads on unbroken and the rows
 * after it follow the drawer, rather than hanging over the grid.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("a drawer stands after the last choice of the opened choice's row and before the next row's first", () => {
  const holder = document.createElement("div");
  document.body.append(holder);
  const root = createRoot(holder);
  roots.push(root);

  // Twelve choices fill a row of ten and two of the next; the fourth is opened.
  const choices = Array.from({ length: 12 }, (_, at) =>
    createElement(IconPickerChoice, {
      key: at,
      label: `Choice ${at + 1}`,
      pressed: false,
      stop: at === 0,
      face: null,
      onPress: () => {},
    }),
  );

  const drawer = {
    after: 3,
    content: createElement(IconPickerDrawer, {
      label: "Opened's",
      onClose: () => {},
      children: createElement(IconPickerChoice, {
        label: "Opened",
        pressed: false,
        stop: false,
        face: null,
        onPress: () => {},
      }),
    }),
  };

  act(() =>
    root.render(createElement(IconPickerGroup, { name: "Glyphs", drawer, children: choices })),
  );

  const order = [...holder.querySelectorAll("button")].map((each) =>
    each.getAttribute("aria-label"),
  );

  assert.deepEqual(order.slice(9, 12), ["Choice 10", "Opened", "Choice 11"]);
});

test("a drawer opening in an early row leaves a choice after it standing, the focus still on it", () => {
  const holder = document.createElement("div");
  document.body.append(holder);
  const root = createRoot(holder);
  roots.push(root);

  const group = (drawer?: { after: number; content: string }) =>
    createElement(IconPickerGroup, {
      name: "Glyphs",
      drawer,
      children: Array.from({ length: 12 }, (_, at) =>
        createElement(IconPickerChoice, {
          key: at,
          label: `Choice ${at + 1}`,
          pressed: false,
          stop: at === 0,
          face: null,
          onPress: () => {},
        }),
      ),
    });

  act(() => root.render(group()));
  const last = holder.querySelector<HTMLElement>('[aria-label="Choice 12"]') ?? assert.fail();
  act(() => last.focus());
  act(() => root.render(group({ after: 3, content: "Opened" })));

  assert.equal(document.activeElement?.getAttribute("aria-label"), "Choice 12");
});
