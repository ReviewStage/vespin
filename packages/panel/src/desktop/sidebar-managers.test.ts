// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_STATUS,
  type ListedAgent,
} from "@repo/features/agent-wire";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { type MacOffer, MODEL_PROVIDER } from "@repo/features/models-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { MODELS_READ, type ModelsRead } from "../tasks/use-agents.js";
import type { NewTask } from "../tasks/use-new-task.js";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { handHostReads, handState, writeListedTasks } from "../testing/app-state.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { NO_REPOSITORIES, newTaskControl, tasksControl } from "../testing/tasks-control.js";

/**
 * sidebar-managers.test.ts -- the sidebar's Managers: the workspace's
 * Managers of the live task list's agents, listed under their head where
 * the workspace has the experiment on, each opening its page, and no head
 * at all where it is off; and New Manager, whose edited retry is a request of its
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

/** A Manager on no task, as the live task list carries it. */
const MANAGER: ListedAgent = {
  id: FRONTEND,
  taskId: null,
  workspaceId: WORKSPACE.id,
  repository: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Frontend Manager",
  kind: AGENT_KIND.MANAGER,
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** A second Manager, started later, which no page stands open on. */
const BILLING: ListedAgent = {
  ...MANAGER,
  id: "0a1b2c3d-0000-4000-8000-00000000000b",
  title: "Billing Manager",
  createdAt: 2,
};

const { kind: _kind, ...CODER } = MANAGER;

/** What the live list carries beside the workspace's Managers, none of them one: a coder on no task, a Manager archived, and another workspace's Manager. */
const NOT_MANAGERS: readonly ListedAgent[] = [
  {
    ...CODER,
    id: "0a1b2c3d-0000-4000-8000-00000000000c",
    title: "Loose Coder",
  },
  {
    ...MANAGER,
    id: "0a1b2c3d-0000-4000-8000-00000000000d",
    title: "Retired Manager",
    archivedAt: 3,
  },
  {
    ...MANAGER,
    id: "0a1b2c3d-0000-4000-8000-00000000000e",
    title: "Elsewhere Manager",
    workspaceId: "workspace-other",
  },
];

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

/** The sidebar over the workspace, the experiment as given, the live list carrying both Managers among agents that are not, a Manager's page opened as `opened` hears it, and `openId`'s page standing open where one is named. */
async function mountSidebar(
  on: boolean,
  opened: string[],
  openId?: string,
  pinned: readonly string[] = [],
): Promise<HTMLElement> {
  handState({ [EXPERIMENT.MANAGERS]: on });
  writeListedTasks({
    taskAgentPins: pinned.map((agentId) => ({ agentId, taskId: null, pinnedAt: 5 })),
  });
  fakeActPort(fakeActPortCalls());

  const tasks = tasksControl({
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    liveAgents: [MANAGER, ...NOT_MANAGERS, BILLING],
    agentView: { agentId: openId, onOpen: (agentId) => opened.push(agentId) },
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
  await settleQueries();

  return container;
}

test("Managers lists the workspace's unarchived Managers of the live list alone, newest first, and a row opens its Manager's page", async () => {
  const opened: string[] = [];
  const sidebar = await mountSidebar(true, opened);
  const list = sidebar.querySelector('nav[aria-label="Managers"]');

  assert.ok(list, "the Managers section is drawn");

  const titled = [
    "Billing Manager",
    "Frontend Manager",
    "Loose Coder",
    "Retired Manager",
    "Elsewhere Manager",
  ].filter((name) => list.textContent?.includes(name));

  assert.deepEqual(titled, ["Billing Manager", "Frontend Manager"]);
  assert.ok(
    (list.textContent?.indexOf("Billing Manager") ?? -1) <
      (list.textContent?.indexOf("Frontend Manager") ?? -1),
    "the newest Manager stands first",
  );

  const row = [...list.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Frontend Manager"),
  );

  assert.ok(row, "the Manager's row is drawn");
  act(() => row.click());
  assert.deepEqual(opened, [FRONTEND]);
});

test("a Manager the reader pinned stands under Pinned as well as under Managers, and opens its page from there", async () => {
  const opened: string[] = [];
  const sidebar = await mountSidebar(true, opened, undefined, [FRONTEND]);
  const pins = sidebar.querySelector('nav[aria-label="Pinned"]');
  const managers = sidebar.querySelector('nav[aria-label="Managers"]');

  assert.ok(pins, "Pinned is drawn");
  assert.ok(pins.textContent?.includes("Frontend Manager"));
  assert.ok(!pins.textContent?.includes("Billing Manager"), "an unpinned Manager stays out");
  assert.ok(managers?.textContent?.includes("Frontend Manager"), "it stays under Managers too");

  const row = [...pins.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Frontend Manager"),
  );

  assert.ok(row, "the pinned Manager's row is drawn");
  act(() => row.click());
  assert.deepEqual(opened, [FRONTEND]);
});

test("Managers stands nowhere while the workspace has the experiment off", async () => {
  const sidebar = await mountSidebar(false, []);

  assert.equal(sidebar.querySelector('nav[aria-label="Managers"]'), null);
});

test("Managers folded leaves the open Manager's row standing and folds the rest away", async () => {
  const sidebar = await mountSidebar(true, [], FRONTEND);
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

/** A Mac the member registered, their last Runs on pick. */
const MAC: MacOffer = {
  deviceId: "0a1b2c3d-0000-4000-8000-0000000000aa",
  name: "Ada's Mac",
  providers: [MODEL_PROVIDER.ANTHROPIC],
};

/** New Task's control as New Manager reads it: the recent repository, and the devices as `modelsRead` stands. */
function newManagerTask(overrides: Partial<NewTask> = {}): NewTask {
  return newTaskControl({
    repositoriesIn: () => ({ ...NO_REPOSITORIES, recent: [RELAY] }),
    ...overrides,
  });
}

/**
 * The sidebar over the workspace with Managers on, the account's default
 * model read, each Create the service hears kept in `created` and answered
 * unanswered; answers how to draw it again over another New Task, press a
 * button by its name, and type the Manager's name.
 */
async function mountNewManager(newTask: NewTask) {
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

  const created: { idempotencyKey: string; name: string; runsOn: unknown }[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.AGENTS_CREATE_MANAGER]: (request) => {
      created.push(request);

      return Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED });
    },
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  const draw = (next: NewTask) =>
    root.render(
      withQueryClient(
        drawnSidebar(
          sidebarProps(
            tasksControl({ workspaces: [WORKSPACE], workspace: WORKSPACE, newTask: next }),
          ),
        ),
      ),
    );

  act(() => draw(newTask));
  await settleQueries();

  const button = (label: string) => {
    const found = [...document.querySelectorAll("button")].find(
      (each) => each.getAttribute("aria-label") === label || each.textContent === label,
    );

    assert.ok(found, `${label} is drawn`);

    return found;
  };

  const press = (label: string) => {
    const found = button(label);
    act(() => found.click());
  };

  const name = (words: string) => {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input');

    assert.ok(field, "the Name field is drawn");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  return { created, draw, button, press, name };
}

test("a Create sent again after an edit is a request of its own, under a key of its own", async () => {
  const { created, press, name } = await mountNewManager(newManagerTask());

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

test("where the last pick is a device, Create waits on the read of the devices New Manager asks as it opens, and stands once that read lands", async () => {
  window.localStorage.setItem("app.newTaskRunsOn", MAC.deviceId);

  // Note that the ask stamps its generation at once, in the press that opens the card, as the agents control does.
  let asked: () => void = () => undefined;

  const standing = (state: ModelsRead["state"]) =>
    newManagerTask({
      devices: [MAC],
      modelsRead: { state, generation: state === MODELS_READ.READ ? 1 : 2 },
      readModels: () => asked(),
    });

  const reading = { ...standing(MODELS_READ.READING) };
  const { draw, button, press, name } = await mountNewManager(standing(MODELS_READ.READ));

  asked = () => draw(reading);
  press("New Manager");
  name("Alpha");

  const create = () => button("Create Manager");

  assert.equal(create().disabled || create().getAttribute("aria-disabled") === "true", true);
  act(() => draw({ ...reading, modelsRead: { state: MODELS_READ.READ, generation: 2 } }));
  await vi.waitFor(() =>
    assert.equal(create().disabled || create().getAttribute("aria-disabled") === "true", false),
  );
});

test("a Create sent again after its device left the list, nothing else changed, is a request of its own on the cloud", async () => {
  window.localStorage.setItem("app.newTaskRunsOn", MAC.deviceId);

  const listed = (devices: readonly MacOffer[]) =>
    newManagerTask({ devices, modelsRead: { state: MODELS_READ.READ, generation: 1 } });

  const { created, draw, press, name } = await mountNewManager(listed([MAC]));

  press("New Manager");
  act(() => draw({ ...listed([MAC]), modelsRead: { state: MODELS_READ.READ, generation: 2 } }));
  name("Alpha");
  press("Create Manager");
  await vi.waitFor(() => assert.equal(created.length, 1));
  act(() => draw({ ...listed([]), modelsRead: { state: MODELS_READ.READ, generation: 2 } }));
  press("Create Manager");
  await vi.waitFor(() => assert.equal(created.length, 2));

  assert.deepEqual(
    created.map((request) => request.runsOn),
    [{ machine: AGENT_MACHINE.DEVICE, deviceId: MAC.deviceId }, { machine: AGENT_MACHINE.VERCEL }],
  );
  assert.notEqual(created[0]?.idempotencyKey, created[1]?.idempotencyKey);
});
