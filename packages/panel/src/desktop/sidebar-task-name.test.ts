// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { deliveryOf, handState, stateWith } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { restOn } from "../testing/hint-rest.js";
import { relayout } from "../testing/resize-observer.js";
import { tasksControl } from "../testing/tasks-control.js";
import { windowRouter } from "../testing/window-router.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-task-name.test.ts -- a sidebar task's name held to its row's one line: fading out where the row cuts it, never ending hard, and named whole by the row's hint while it is cut; a rename delivered redrawing that row's words alone; and an unpin delivered moving its row out of Pinned, drawn once throughout. Synthetic.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const LONG_NAME = "Teammate invitations expire after seven days unless renewed";
const SHORT_NAME = "Retry audit";

const roots: Root[] = [];

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  handState({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function task(id: string, name: string, updatedAt = 2): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt,
    repository: "acme/relay",
  };
}

/** The sidebar over a task with a name too long for its row and one that fits. */
async function mountSidebar(): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  const tasks = tasksControl({
    tasks: [
      task("0a1b2c3d-0000-4000-8000-100000000001", LONG_NAME),
      task("0a1b2c3d-0000-4000-8000-100000000002", SHORT_NAME),
    ],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
  });

  act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  return container;
}

/** The row's press for the task named `name`, whose name stands in a line of its own. */
function rowOf(sidebar: HTMLElement, name: string): HTMLElement {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.querySelector(".ui-list-row-title .ui-one-line")?.textContent === name,
  );

  return row ?? assert.fail(`no ${name} row`);
}

/** Lays the row's name out narrower than it runs, as a narrow sidebar does, and tells the window. */
function cutShort(words: Element): void {
  Object.defineProperty(words, "scrollWidth", { configurable: true, value: 320 });
  Object.defineProperty(words, "clientWidth", { configurable: true, value: 180 });
  act(() => relayout());
}

/** The pill the pointer resting on `target` raises, or nothing where it raises none. */
function pillOver(target: Element): string | undefined {
  restOn(target);
  const pill = document.querySelector('[role="tooltip"]:not([inert])')?.textContent ?? undefined;
  act(() => target.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));

  return pill;
}

test("a task name cut short by its row fades out where it is cut, and the row's hint says it whole", async () => {
  const sidebar = await mountSidebar();
  const row = rowOf(sidebar, LONG_NAME);
  const name = row.querySelector<HTMLElement>(".ui-list-row-title .ui-one-line");
  assert.ok(name);
  assert.equal(name.dataset.overflow, "false");

  cutShort(name);

  assert.equal(name.dataset.end, "fade");
  assert.equal(name.dataset.overflow, "true");
  assert.ok(pillOver(row)?.startsWith(LONG_NAME));
});

/** Main's document at `version` listing `tasks`, and the push that hands the window each later one as JSON crosses the bridge. */
function handTasks(
  tasks: readonly TaskSummary[],
): (version: number, next: readonly TaskSummary[]) => void {
  const listeners = new Set<(delivery: AppStateDelivery) => void>();

  const documentOf = (version: number, listed: readonly TaskSummary[]): AppStateSnapshot => {
    const idle = stateWith({}, {});

    return { ...idle, version, tasks: { ...idle.tasks, tasks: listed } };
  };

  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(documentOf(1, tasks)),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  });

  return (version, next) => {
    const delivery: AppStateDelivery = JSON.parse(
      JSON.stringify(deliveryOf(documentOf(version, next))),
    );

    for (const listener of listeners) listener(delivery);
  };
}

/**
 * The sidebar listing `tasks`, over the task collections the window's own
 * follow feeds from the bridge (`withQueryClient`), as the window draws it,
 * rather than collections standing on the tab handed (`drawnSidebar`).
 */
function sidebarOverFollow(tasks: readonly TaskSummary[]): ReactElement {
  const props = sidebarProps(
    tasksControl({ tasks, workspaces: [WORKSPACE], workspace: WORKSPACE }),
  );

  return withQueryClient(windowRouter().provide(createElement(DesktopSidebar, props)));
}

/** Lets the follow's read and the live queries over it land. */
function settle(): Promise<void> {
  return act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The words of each row the sidebar draws, in order, and whether it stands under Pinned. */
function drawnNames(container: HTMLElement): { name: string; pinned: boolean }[] {
  return [...container.querySelectorAll<HTMLElement>(".sidebar-tasks > li")].map((row) => ({
    name: row.querySelector(".ui-list-row-title .ui-one-line")?.textContent ?? "",
    pinned: row.closest('nav[aria-label="Pinned"]') !== null,
  }));
}

test("a delivery renaming one task changes that row's words alone, the other rows standing as they were", async () => {
  const first = task("0a1b2c3d-0000-4000-8000-100000000001", "Ship the importer", 30);
  const second = task("0a1b2c3d-0000-4000-8000-100000000002", "Retry webhooks", 20);
  const third = task("0a1b2c3d-0000-4000-8000-100000000003", "Audit the cache", 10);
  const deliver = handTasks([first, second, third]);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  const draw = (tasks: readonly TaskSummary[]) => root.render(sidebarOverFollow(tasks));

  act(() => draw([first, second, third]));
  await settle();
  const rows = () => [...container.querySelectorAll<HTMLElement>(".sidebar-tasks > li")];
  const before = rows();
  assert.deepEqual(
    before.map((row) => row.querySelector(".ui-list-row-title .ui-one-line")?.textContent),
    ["Ship the importer", "Retry webhooks", "Audit the cache"],
  );

  const renamed = { ...second, name: "Retry webhooks with backoff" };
  act(() => deliver(2, [first, renamed, third]));
  act(() => draw([first, renamed, third]));
  await settle();
  const after = rows();

  assert.deepEqual(
    after.map((row) => row.querySelector(".ui-list-row-title .ui-one-line")?.textContent),
    ["Ship the importer", "Retry webhooks with backoff", "Audit the cache"],
  );
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
  assert.equal(after[0]?.innerHTML, before[0]?.innerHTML);
});

test("a delivery unpinning one task moves its row out of Pinned into Tasks, never left out on the way, the other rows standing as they were", async () => {
  const first = task("0a1b2c3d-0000-4000-8000-100000000001", "Ship the importer", 30);
  const second = task("0a1b2c3d-0000-4000-8000-100000000002", "Retry webhooks", 20);
  const third = task("0a1b2c3d-0000-4000-8000-100000000003", "Audit the cache", 10);
  const pinned = { ...third, pinnedAt: 40 };
  const deliver = handTasks([first, second, pinned]);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  act(() => root.render(sidebarOverFollow([first, second, pinned])));
  await settle();

  const unpinnedRows = () =>
    [...container.querySelectorAll<HTMLElement>(".sidebar-tasks > li")].filter(
      (row) => row.closest('nav[aria-label="Pinned"]') === null,
    );

  const before = unpinnedRows();
  assert.deepEqual(drawnNames(container), [
    { name: "Audit the cache", pinned: true },
    { name: "Ship the importer", pinned: false },
    { name: "Retry webhooks", pinned: false },
  ]);

  // Note that the tab is handed the unpin before the collections hear it, as the window's Query client and its collections are told on ticks of their own, so Pinned and Tasks must read one of them or the row stands in neither.
  act(() => root.render(sidebarOverFollow([first, second, third])));
  assert.deepEqual(
    drawnNames(container).map(({ name }) => name),
    ["Audit the cache", "Ship the importer", "Retry webhooks"],
    "the task being unpinned is drawn once",
  );

  act(() => deliver(2, [first, second, third]));
  await settle();

  assert.deepEqual(drawnNames(container), [
    { name: "Ship the importer", pinned: false },
    { name: "Retry webhooks", pinned: false },
    { name: "Audit the cache", pinned: false },
  ]);
  const after = unpinnedRows();
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
});
