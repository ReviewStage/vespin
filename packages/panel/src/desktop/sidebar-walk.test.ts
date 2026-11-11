// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@repo/features/task-wire";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { layScrollerOut } from "../testing/scroller.js";
import { tasksControl } from "../testing/tasks-control.js";

/**
 * sidebar-walk.test.ts -- the sidebar's rows are one walk across the lists
 * that draw only the rows near the view: Home and a step past either end
 * reach the first or last row any list holds, drawn or not, wrapping as a
 * list's walk does.
 */

const roots: Root[] = [];

/**
 * Note that this test draws the whole sidebar over sixty rows and scrolls
 * it, which takes about 4 s in jsdom and runs past vitest's 5 s default on a
 * busy CI runner: profiled, the drawing, the scroll, and Home each take 1.1
 * to 1.5 s, most of it jsdom matching each mounted tooltip's
 * `[aria-describedby~=…]` lookup against the whole document (276 of them)
 * and React's development render. It is given 15 s.
 */
const WALK_TIMEOUT_MS = 15_000;

beforeEach(() => {
  window.localStorage.clear();
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** One of sixty tasks with no repository, the newest first, so the list holds them in one run. */
function task(at: number): TaskSummary {
  return {
    id: `t-${at}`,
    workspaceId: "workspace-personal",
    name: `Chore ${at}`,
    createdAt: 1,
    updatedAt: 100 - at,
    repository: null,
  };
}

/** The name of the row holding the keyboard. */
function focusedName(): string | undefined {
  return (
    document.activeElement?.closest("li")?.querySelector(".ui-list-row-title")?.firstChild
      ?.textContent ?? undefined
  );
}

function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("Home from the last row reaches the first one left undrawn, and ↑ and ↓ wrap at the ends", {
  timeout: WALK_TIMEOUT_MS,
}, () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({ tasks: Array.from({ length: 60 }, (_, at) => task(at + 1)) });
  act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
  // Note that jsdom lays nothing out, so the column is given a view and a length, then scrolled to its end, drawing only the last rows.
  const scroller = container.querySelector<HTMLElement>(
    ".desktop-sidebar [data-slot='scroll-area']",
  );
  assert.ok(scroller, "the column scrolls");
  layScrollerOut(scroller, 768, 60 * 30);
  act(() => {
    scroller.scrollTop = 60 * 30 - 768;
  });
  const drawn = () =>
    [...container.querySelectorAll(".desktop-sidebar ul.ui-virtual-rows > li")].map(
      (row) => row.querySelector(".ui-list-row-title")?.firstChild?.textContent,
    );
  assert.ok(!drawn().includes("Chore 1"), "the first row is not drawn");
  const last = [
    ...container.querySelectorAll<HTMLElement>(".desktop-sidebar [data-roving-item]"),
  ].at(-1);
  assert.ok(last, "a row is drawn to press");
  act(() => last.focus());
  assert.equal(focusedName(), "Chore 60");

  press("Home");
  assert.equal(focusedName(), "Chore 1", "Home reaches the first row");
  press("ArrowUp");
  assert.equal(focusedName(), "Chore 60", "↑ from the first wraps to the last");
  press("ArrowDown");
  assert.equal(focusedName(), "Chore 1", "↓ from the last wraps to the first");
});
