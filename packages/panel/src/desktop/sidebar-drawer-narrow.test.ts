// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";

/**
 * sidebar-drawer-narrow.test.ts -- the column gives its tasks the room: the pages' rows scroll away with them beside the work, and a phone's Tasks page draws none, its bar and Search holding them; and an empty Pinned stands nowhere, under a finger or a mouse, whatever the room. On a phone each open group counts its rows, View options stands in the bar, and a row's menu is grouped as the iOS app's long press groups it.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const roots: Root[] = [];

/** Answers the device's pointer as a finger's where `coarse`, else as a mouse's. */
function pointer(coarse: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  pointer(false);
  fakeAppBridge({});
  handState({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function task(n: number, name: string): TaskSummary {
  return {
    id: `0a1b2c3d-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2 + n,
    repository: "acme/relay",
  };
}

/** The sidebar in the room given, listing a few tasks and pinning none. */
async function mountIn(room: ShellRoom): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  const tasks = tasksControl({
    tasks: [task(1, "Invite expiry"), task(2, "Retry audit")],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
  });

  // Note that the room is handed as the shell hands it, to the column and, through the stage's context, to what draws below it.
  act(() =>
    root.render(
      createElement(
        ShellRoomContext,
        { value: room },
        withQueryClient(drawnSidebar({ ...sidebarProps(tasks), room })),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  return container;
}

/** Where the sidebar draws a page's row and the Tasks list: whether each stands in the column's scroller. */
function scrolled(sidebar: HTMLElement) {
  const scroller =
    sidebar.querySelector(".sidebar-section .ui-scroll-area") ?? assert.fail("the scroller");

  // Note that the Automations row is read, the last of the rows a wide column draws.
  const home =
    [...sidebar.querySelectorAll("button")].find((each) =>
      each.textContent?.startsWith("Automations"),
    ) ?? assert.fail("the Automations row");

  const list = sidebar.querySelector('nav[aria-label="My tasks"]') ?? assert.fail("the Tasks list");

  return { home: scroller.contains(home), tasks: scroller.contains(list) };
}

/** Whether the sidebar draws Pinned. */
function pinnedStands(sidebar: HTMLElement): boolean {
  return sidebar.querySelector('nav[aria-label="Pinned"]') !== null;
}

test("on a phone under a finger the Tasks page draws no pages' rows over its tasks, its bar holding Automations and Search the Merge queue, and an empty Pinned stands nowhere", async () => {
  pointer(true);
  const sidebar = await mountIn(SHELL_ROOM.NARROW);

  assert.equal(
    [...sidebar.querySelectorAll("button")].find((each) =>
      each.textContent?.startsWith("Automations"),
    ),
    undefined,
    "no Automations row",
  );
  assert.ok(sidebar.querySelector('nav[aria-label="My tasks"]'), "the Tasks list stands");
  assert.equal(pinnedStands(sidebar), false);
});

test("a narrow window worked by a mouse draws no empty Pinned either", async () => {
  const sidebar = await mountIn(SHELL_ROOM.NARROW);

  assert.equal(pinnedStands(sidebar), false);
});

test("beside the work the pages' rows scroll with the tasks too, and an empty Pinned stands nowhere", async () => {
  const sidebar = await mountIn(SHELL_ROOM.WIDE);

  assert.deepEqual(scrolled(sidebar), { home: true, tasks: true });
  assert.equal(pinnedStands(sidebar), false, "no Pinned");
  assert.doesNotMatch(sidebar.textContent ?? "", /Pinned/u);
});

test("on a phone the Tasks head counts its tasks while open, View options stands in the bar, and a row's menu leads with Rename and ends with Pin, More, and Permanently delete", async () => {
  document.documentElement.setAttribute("data-ui-room", "narrow");
  pointer(true);

  try {
    const sidebar = await mountIn(SHELL_ROOM.NARROW);

    const head =
      [...sidebar.querySelectorAll("button")].find(
        (each) =>
          each.getAttribute("aria-expanded") === "true" && each.textContent?.startsWith("My tasks"),
      ) ?? assert.fail("the Tasks head");

    assert.match(head.textContent ?? "", /2/u);
    assert.ok(
      sidebar.querySelector('.ui-toolbar [aria-label="View options"]'),
      "View options in the bar",
    );

    const row =
      [...sidebar.querySelectorAll("li")].find((each) =>
        each.textContent?.includes("Invite expiry"),
      ) ?? assert.fail("the row");

    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });

    const items = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(
      (each) => each.textContent,
    );

    assert.deepEqual(
      [items[0], ...items.slice(-3)],
      ["Rename", "Pin", "More", "Permanently delete"],
    );
  } finally {
    document.documentElement.removeAttribute("data-ui-room");
  }
});
