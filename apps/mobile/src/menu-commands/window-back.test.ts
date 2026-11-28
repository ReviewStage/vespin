import { describe, expect, it } from "vitest";
import { type NavigatorState, tabStackBacks, tabsInFront } from "./window-back.js";

// The root state as expo-router 58 answers it: its own `__root` slot, the app's
// group under it, the app's stack in that, the tabs in the stack, and each tab's own stack.
function rootState(front: NavigatorState["routes"][number]): NavigatorState {
  const app = { name: "(app)", state: { index: 0, routes: [front] } };

  return { index: 0, routes: [{ name: "__root", state: { index: 0, routes: [app] } }] };
}

const tasksWith = (pages: number) => ({
  name: "(tabs)",
  state: {
    index: 1,
    routes: [
      { name: "(inbox)", state: { index: 0, routes: [{ name: "index" }] } },
      {
        name: "(tasks)",
        state: {
          index: pages,
          routes: [
            { name: "index" },
            ...Array.from({ length: pages }, () => ({ name: "task/[id]" })),
          ],
        },
      },
    ],
  },
});

describe("window Back", () => {
  it("backs over a page the shown tab pushed, read under the root slot", () => {
    const tabs = tabsInFront(rootState(tasksWith(1)));

    expect(tabs === undefined ? undefined : tabStackBacks(tabs)).toBe(true);
  });

  it("has nothing to pop at the shown tab's root", () => {
    const tabs = tabsInFront(rootState(tasksWith(0)));

    expect(tabs === undefined ? undefined : tabStackBacks(tabs)).toBe(false);
  });

  it("stands aside while a sheet is in front of the tabs", () => {
    expect(tabsInFront(rootState({ name: "settings" }))).toBeUndefined();
  });
});
