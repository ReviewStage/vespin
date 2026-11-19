// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_KIND, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { handHostReads, handState } from "../testing/app-state.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { NO_REPOSITORIES, newTaskControl, tasksControl } from "../testing/tasks-control.js";

/**
 * sidebar-managers.test.ts -- the sidebar's Managers: the workspace's
 * Managers, read as Managers alone, listed under their head where the
 * workspace has the experiment on, each opening its page, and no head at all
 * where it is off; and New Manager, whose edited retry is a request of its
 * own. Synthetic throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "ada", active: true },
};

/** The repository the account's tasks were about lately, which New Manager opens on. */
const RELAY = "ada/relay";

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

test("a Create sent again after an edit is a request of its own, under a key of its own", async () => {
  handState({ [EXPERIMENT.MANAGERS]: true });
  handHostReads({
    models: {
      rows: {
        models: [
          {
            id: MANAGER.model,
            name: "Claude Opus 5.5",
            provider: MODEL_PROVIDER.ANTHROPIC,
            efforts: ["high"],
          },
        ],
      },
    },
    preferences: {
      rows: {
        agent: { model: MANAGER.model, effort: "high" },
        chaptersModel: CHAPTERS_MODEL.HAIKU,
        slackNotifications: true,
        sounds: { list: [], choices: { finish: undefined, ask: undefined } },
      },
    },
  });

  const created: { idempotencyKey: string; name: string }[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.AGENTS_WORKSPACE_LIST]: () => Promise.resolve({ agents: [] }),
    [ACT_KIND.AGENTS_CREATE_MANAGER]: (request) => {
      created.push(request);

      return Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED });
    },
  });

  const tasks = tasksControl({
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    newTask: newTaskControl({ repositoriesIn: () => ({ ...NO_REPOSITORIES, recent: [RELAY] }) }),
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
  await settleQueries();

  const press = (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (each) => each.getAttribute("aria-label") === label || each.textContent === label,
    );

    assert.ok(button, `${label} is drawn`);
    act(() => button.click());
  };

  const name = (words: string) => {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input');

    assert.ok(field, "the Name field is drawn");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  press("New Manager");
  name("Alpha");
  press("Create Manager");
  await vi.waitFor(() => assert.equal(created.length, 1));
  name("Beta");
  press("Create Manager");
  await vi.waitFor(() => assert.equal(created.length, 2));

  assert.deepEqual(
    created.map((request) => request.name),
    ["Alpha", "Beta"],
  );
  assert.notEqual(created[0]?.idempotencyKey, created[1]?.idempotencyKey);
});
