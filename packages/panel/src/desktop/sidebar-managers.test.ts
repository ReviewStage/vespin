// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_KIND, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";

/**
 * sidebar-managers.test.ts -- the sidebar's Managers: the workspace's
 * Managers, read as Managers alone, listed under their head where the
 * workspace has the experiment on, each opening its page, and no head at all
 * where it is off. Synthetic throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const FRONTEND = "0a1b2c3d-0000-4000-8000-00000000000a";

/** A Manager on no task, as the service lists it. */
const MANAGER: AgentSummary = {
  id: FRONTEND,
  taskId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Frontend Manager",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** A second Manager, which no page stands open on. */
const BILLING: AgentSummary = {
  ...MANAGER,
  id: "0a1b2c3d-0000-4000-8000-00000000000b",
  title: "Billing Manager",
};

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
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The sidebar over the workspace, the experiment as given, the workspace's agents read as `asked` hears them, a Manager's page opened as `opened` hears it, and `openId`'s page standing open where one is named. */
async function mountSidebar(
  on: boolean,
  asked: unknown[],
  opened: string[],
  openId?: string,
): Promise<HTMLElement> {
  handState({ [EXPERIMENT.MANAGERS]: on });
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.AGENTS_WORKSPACE_LIST]: (params) => {
      asked.push(params);

      return Promise.resolve({ agents: [MANAGER, BILLING] });
    },
  });

  const tasks = tasksControl({
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    agentView: { agentId: openId, onOpen: (agentId) => opened.push(agentId) },
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
  await settleQueries();

  return container;
}

test("Managers lists the workspace's Managers, asked for as Managers alone, and a row opens its Manager's page", async () => {
  const asked: unknown[] = [];
  const opened: string[] = [];
  const sidebar = await mountSidebar(true, asked, opened);
  const list = sidebar.querySelector('nav[aria-label="Managers"]');

  assert.ok(list, "the Managers section is drawn");
  assert.deepEqual(asked, [{ workspaceId: WORKSPACE.id, kind: AGENT_KIND.MANAGER }]);

  const row = [...list.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Frontend Manager"),
  );

  assert.ok(row, "the Manager's row is drawn");
  act(() => row.click());
  assert.deepEqual(opened, [FRONTEND]);
});

test("Managers stands nowhere, and reads nothing, while the workspace has the experiment off", async () => {
  const asked: unknown[] = [];
  const sidebar = await mountSidebar(false, asked, []);

  assert.equal(sidebar.querySelector('nav[aria-label="Managers"]'), null);
  assert.deepEqual(asked, []);
});

test("Managers folded leaves the open Manager's row standing and folds the rest away", async () => {
  const sidebar = await mountSidebar(true, [], [], FRONTEND);
  const list = sidebar.querySelector('nav[aria-label="Managers"]');

  assert.ok(list, "the Managers section is drawn");

  const fold = list.querySelector<HTMLButtonElement>("button[aria-expanded]");

  const named = () =>
    ["Frontend Manager", "Billing Manager"].filter((name) =>
      [...list.querySelectorAll("button")].some((button) => button.textContent?.includes(name)),
    );

  assert.ok(fold, "the Managers head folds");
  assert.deepEqual(named(), ["Frontend Manager", "Billing Manager"]);
  act(() => fold.click());
  assert.deepEqual(named(), ["Frontend Manager"], "the open Manager stays");
});
