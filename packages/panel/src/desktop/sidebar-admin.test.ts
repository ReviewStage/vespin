// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { windowRouter } from "../testing/window-router.js";

/**
 * sidebar-admin.test.ts -- the Admin row stands after Automations for an
 * admin alone, and a non-admin is drawn nothing in its place; its press
 * opens the window's Admin place rather than a browser, asking the host for
 * nothing; the place then takes the window, its own list where this sidebar
 * stood (`desktop-admin.test.ts`).
 */

const roots: Root[] = [];

/** Every act the sidebar sent, in order. */
let sent: SentPortAct[] = [];

beforeEach(() => {
  sent = [];
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The workspace the sidebar lists, which Admin opens under. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** The sidebar beside the work, for an account that is an admin or not. */
async function mount(admin: boolean): Promise<{ sidebar: HTMLElement; path: () => string }> {
  handState({}, { access: { admin } });
  const router = windowRouter(createMemoryHistory({ initialEntries: ["/acme"] }));
  const control = tasksControl({ workspace: ACME, workspaces: [ACME] });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(drawnSidebar({ ...sidebarProps(control), room: SHELL_ROOM.WIDE }, router)),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  if (admin) await vi.waitFor(() => assert.equal(adminRow(container) !== undefined, true));
  return { sidebar: container, path: () => router.history.location.pathname };
}

/** The names of the rows the sidebar's places draw, top to bottom. */
function placeNames(sidebar: HTMLElement): string[] {
  const places = sidebar.querySelector(".sidebar-places") ?? assert.fail("the sidebar's places");
  return [...places.querySelectorAll(".ui-nav-item-name")].map((name) => name.textContent ?? "");
}

/** The Admin row, wherever it is drawn. */
function adminRow(sidebar: HTMLElement): HTMLElement | undefined {
  return [...sidebar.querySelectorAll<HTMLElement>(".ui-nav-item")].find(
    (row) => row.querySelector(".ui-nav-item-name")?.textContent === "Admin",
  );
}

test("an account that is no admin is drawn no Admin row, neither hidden nor held back", async () => {
  const { sidebar } = await mount(false);

  assert.equal(adminRow(sidebar), undefined);
  assert.doesNotMatch(sidebar.textContent ?? "", /Admin/u);
});

test("an admin's Admin row stands right after Automations", async () => {
  const { sidebar } = await mount(true);
  const names = placeNames(sidebar);

  assert.equal(names.at(-1), "Admin");
  assert.equal(names.at(-2), "Automations");
});

test("pressing the Admin row opens the window's Admin place and asks the host for nothing", async () => {
  const mounted = await mount(true);
  const row = adminRow(mounted.sidebar) ?? assert.fail("the Admin row");

  assert.ok(row instanceof HTMLButtonElement);
  // Note that the listed workspace's reads are followed from the sidebar's first draw, before any press.
  const before = sent.length;
  act(() => row.click());
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });

  assert.equal(mounted.path(), "/acme/admin");
  assert.deepEqual(sent.slice(before), []);
});
