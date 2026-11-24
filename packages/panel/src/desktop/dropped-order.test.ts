// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type DroppedOrder, useDroppedOrder } from "./dropped-order.js";

/**
 * dropped-order.test.ts -- a list draws a move's order at once and keeps it
 * until the order it is handed agrees or contradicts it, as main's state
 * reaches the panel a moment after the move. Each item is named by its
 * title, its key the title it was first handed under.
 */

interface Item {
  readonly key: string;
  readonly title: string;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** Items whose keys and titles are `titles`. */
const items = (...titles: string[]): Item[] => titles.map((title) => ({ key: title, title }));

const keyOf = (item: Item) => item.key;

/** A list drawn from `listed`: what it draws, a move of its rows, and a new order handed to it, as main's state would hand it. */
function drawnList(listed: readonly Item[]) {
  let latest: DroppedOrder<Item> | undefined;

  function List({ handed }: { handed: readonly Item[] }) {
    latest = useDroppedOrder(handed, keyOf);

    return null;
  }

  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(List, { handed: listed })));
  const now = () => latest ?? assert.fail("the list is drawn");

  return {
    titles: () => now().drawn.map((item) => item.title),
    move: (from: number, to: number) => act(() => now().move(from, to)),
    hand: (handed: readonly Item[]) => act(() => root.render(createElement(List, { handed }))),
  };
}

test("a moved row stands at its new place at once, and keeps it while rows are added and renamed in the order still handed", () => {
  const list = drawnList(items("A", "B", "C"));
  list.move(0, 2);
  assert.deepEqual(list.titles(), ["B", "C", "A"]);
  list.hand([...items("A"), { key: "B", title: "B renamed" }, ...items("C", "D")]);
  assert.deepEqual(list.titles(), ["B renamed", "C", "A", "D"]);
});

test("the order is let go once the order handed agrees, so a later order is drawn as handed", () => {
  const list = drawnList(items("A", "B", "C"));
  list.move(0, 2);
  list.hand(items("B", "C", "A"));
  list.hand(items("A", "B", "C"));
  assert.deepEqual(list.titles(), ["A", "B", "C"]);
});

test("an order handed that is neither the move's nor the one before it is drawn as handed", () => {
  const list = drawnList(items("A", "B", "C"));
  list.move(0, 2);
  list.hand(items("C", "A", "B"));
  assert.deepEqual(list.titles(), ["C", "A", "B"]);
});

test("a second move before the first is handed back keeps its own order while the first arrives", () => {
  const list = drawnList(items("A", "B", "C", "D"));
  list.move(0, 1);
  list.move(3, 0);
  list.hand(items("B", "A", "C", "D"));
  assert.deepEqual(list.titles(), ["D", "B", "A", "C"]);
});

test("a move taking back one not yet handed back keeps its order while the first move's order arrives", () => {
  const list = drawnList(items("A", "B", "C"));
  list.move(0, 1);
  list.move(1, 0);
  list.hand(items("B", "A", "C"));
  assert.deepEqual(list.titles(), ["A", "B", "C"]);
});

test("a row handed between two moves leaves the second move's order kept", () => {
  const list = drawnList(items("A", "B", "C"));
  list.move(0, 2);
  list.hand(items("A", "B", "C", "D"));
  list.move(3, 0);
  assert.deepEqual(list.titles(), ["D", "B", "C", "A"]);
});
