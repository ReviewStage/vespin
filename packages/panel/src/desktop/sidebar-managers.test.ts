// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_STATUS,
  CHECK_SUMMARY,
  type ListedAgent,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import type { ManagerFace } from "@repo/features/manager-face";
import { type MacOffer, MODEL_PROVIDER } from "@repo/features/models-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  AGENT_RENAME_TERMS,
  type AgentRenameAsk,
  agentRenameMutation,
  MODELS_READ,
  type ModelsRead,
} from "../tasks/use-agents.js";
import { NEW_TASK_UNSHOWN, type NewTask } from "../tasks/use-new-task.js";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { handHostReads, handState, writeListedTasks } from "../testing/app-state.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { hoveredCard } from "../testing/desktop-inbox.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import {
  agentsControl,
  NO_REPOSITORIES,
  newTaskControl,
  taskAgentsOf,
  tasksControl,
  withNewTaskShown,
} from "../testing/tasks-control.js";

/**
 * sidebar-managers.test.ts -- the sidebar's Managers: the workspace's
 * Managers of the live task list's agents, listed under their head where
 * the workspace has the experiment on, each opening its page, and no head
 * at all where it is off; its View options' sort; a Manager's row's Change
 * face, which opens its name's field with the face's picker and changes its
 * face, and Settings…, which renames it and
 * changes its model; the card a Manager's row hangs; and
 * New Manager, whose edited retry is a request of its own. Synthetic
 * throughout.
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
  repository: RELAY,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Frontend Manager",
  kind: AGENT_KIND.MANAGER,
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  settledAt: 10,
};

/** A second Manager, started later but settled earlier, which no page stands open on. */
const BILLING: ListedAgent = {
  ...MANAGER,
  id: "0a1b2c3d-0000-4000-8000-00000000000b",
  title: "Billing Manager",
  createdAt: 2,
  settledAt: 4,
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

/** A second model, which a Manager's Settings picks. */
const SONNET = "anthropic/claude-sonnet-5.5";

/** The agents a Manager started, as the live list carries them, and the pull requests their rows name. */
interface ManagerWork {
  readonly agents: readonly ListedAgent[];
  readonly pullRequests: readonly ListedPullRequest[];
}

/** No work of a Manager's beyond what the list carries already. */
const NO_WORK: ManagerWork = { agents: [], pullRequests: [] };

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
  renamed: AgentRenameAsk[] = [],
  chosen: { agentId: string; model: string }[] = [],
  faced: { agentId: string; face: ManagerFace }[] = [],
  work: ManagerWork = NO_WORK,
): Promise<HTMLElement> {
  handState({ [EXPERIMENT.MANAGERS]: on });
  writeListedTasks({
    taskAgentPins: pinned.map((agentId) => ({ agentId, taskId: null, pinnedAt: 5 })),
    agentPullRequests: work.pullRequests,
  });
  fakeActPort(fakeActPortCalls());

  const tasks = tasksControl({
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    listedAgents: [MANAGER, ...NOT_MANAGERS, BILLING, ...work.agents],
    agentView: { agentId: openId, onOpen: (agentId) => opened.push(agentId) },
    agents: taskAgentsOf(
      agentsControl({
        rename: {
          ...AGENT_RENAME_TERMS,
          options: agentRenameMutation((asked) => {
            renamed.push(asked);

            return Promise.resolve({ agent: { ...MANAGER, title: asked.title } });
          }),
        },
        models: [
          {
            id: MANAGER.model,
            name: "Claude Opus 5.5",
            provider: MODEL_PROVIDER.ANTHROPIC,
            efforts: ["high"],
          },
          {
            id: SONNET,
            name: "Claude Sonnet 5.5",
            provider: MODEL_PROVIDER.ANTHROPIC,
            efforts: ["high"],
          },
        ],
        onChoose: (agentId, choice) => {
          chosen.push({ agentId, model: choice.model });

          return Promise.resolve({ agent: { ...MANAGER, model: choice.model } });
        },
        onFace: (agentId, face) => {
          faced.push({ agentId, face });

          return Promise.resolve({ agent: { ...MANAGER, face } });
        },
      }),
    ),
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

test("a Manager's row hangs the Manager's card: where it stands, how many of the agents it started are at work, and how many of their pull requests are open", async () => {
  const running: ListedAgent = {
    ...CODER,
    id: "0a1b2c3d-0000-4000-8000-00000000000f",
    taskId: "0a1b2c3d-0000-4000-8000-000000000010",
    title: "Invitations",
    status: AGENT_STATUS.RUNNING,
    startedByAgentId: FRONTEND,
  };

  const ended: ListedAgent = {
    ...CODER,
    id: "0a1b2c3d-0000-4000-8000-000000000011",
    taskId: "0a1b2c3d-0000-4000-8000-000000000012",
    title: "Digest",
    startedByAgentId: FRONTEND,
  };

  const pullRequest = (agent: ListedAgent, number: number, state: PullRequestState) => ({
    agentId: agent.id,
    taskId: agent.taskId ?? "",
    pullRequest: {
      number,
      title: agent.title ?? "",
      url: `https://github.com/${RELAY}/pull/${number}`,
      state,
      checks: CHECK_SUMMARY.PASSING,
      additions: 1,
      deletions: 1,
      changedFiles: 1,
    },
  });

  // Note that one agent it started works and one has ended, and one of their pull requests is open and one merged, so the card counts one of each.
  const sidebar = await mountSidebar(true, [], undefined, [], [], [], [], {
    agents: [running, ended],
    pullRequests: [
      pullRequest(running, 7, PULL_REQUEST_STATE.OPEN),
      pullRequest(ended, 6, PULL_REQUEST_STATE.MERGED),
    ],
  });

  const list = sidebar.querySelector('nav[aria-label="Managers"]');

  const row = [...(list?.querySelectorAll("button") ?? [])].find((button) =>
    button.textContent?.includes("Frontend Manager"),
  );

  assert.ok(row, "the Manager's row is drawn");

  const words = hoveredCard(row, "[data-manager-card]");

  assert.ok(words?.includes("Idle"), "the card says its Manager is idle");
  assert.ok(words?.includes("Agents at work1"), "the card counts the one agent at work");
  assert.ok(words?.includes("Open pull requests1"), "the card counts the one open pull request");
});

test("View options' Sort by › Recent activity lists the Manager that moved last first", async () => {
  const sidebar = await mountSidebar(true, []);
  const list = sidebar.querySelector('nav[aria-label="Managers"]') ?? assert.fail("Managers");
  const order = () => list.textContent?.indexOf("Frontend Manager") ?? -1;

  assert.ok(order() > (list.textContent?.indexOf("Billing Manager") ?? -1), "newest first");

  const options =
    list.querySelector<HTMLButtonElement>('button[aria-label="View options"]') ??
    assert.fail("the head offers View options");

  act(() => options.click());

  const item = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((each) =>
      each.textContent?.startsWith(name),
    ) ?? assert.fail(`${name} is offered`);

  act(() => item("Sort by").click());
  act(() => item("Recent activity").click());

  assert.ok(
    order() < (list.textContent?.indexOf("Billing Manager") ?? -1),
    "the Manager that settled last stands first",
  );
});

test("a Manager the reader pinned stands under Pinned alone, leaving Managers, and opens its page from there", async () => {
  const opened: string[] = [];
  const sidebar = await mountSidebar(true, opened, undefined, [FRONTEND]);
  const pins = sidebar.querySelector('nav[aria-label="Pinned"]');
  const managers = sidebar.querySelector('nav[aria-label="Managers"]');

  assert.ok(pins, "Pinned is drawn");
  assert.ok(pins.textContent?.includes("Frontend Manager"));
  assert.ok(!pins.textContent?.includes("Billing Manager"), "an unpinned Manager stays out");
  assert.ok(!managers?.textContent?.includes("Frontend Manager"), "it leaves Managers");
  assert.ok(managers?.textContent?.includes("Billing Manager"), "an unpinned Manager stays");

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

test("a Manager's row's Change face opens its name's field with the face's picker open, a face picked there is changed and hands the focus back to the name, and Escape ends the edit", async () => {
  const faced: { agentId: string; face: ManagerFace }[] = [];
  const renamed: AgentRenameAsk[] = [];
  const sidebar = await mountSidebar(true, [], undefined, [], renamed, [], faced);
  const list = sidebar.querySelector('nav[aria-label="Managers"]');

  const row =
    [...(list?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Frontend Manager"),
    ) ?? assert.fail("the Manager's row is drawn");

  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });

  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const labels = items().map((item) => item.textContent ?? "");

  assert.ok(
    labels.some((label) => label.startsWith("Rename")),
    "Rename stands",
  );
  assert.ok(
    labels.some((label) => label.startsWith("Settings…")),
    "Settings… stands",
  );
  const change = items().find((item) => item.textContent?.startsWith("Change face"));

  assert.ok(change, "Change face stands");
  await act(async () => change.click());

  const field = () => list?.querySelector<HTMLInputElement>('input[aria-label="Agent name"]');

  assert.ok(field(), "the row's name opens as a field");

  const well = list?.querySelector('button[aria-haspopup="dialog"][aria-expanded="true"]');

  assert.ok(well, "the face stands as a well, its picker open");
  assert.equal(well.closest('[aria-hidden="true"]'), null, "which a reader reaches");

  const cat =
    document.querySelector<HTMLButtonElement>('button[aria-label="Cat"]') ??
    assert.fail("the picker stands open, offering every character");

  await act(async () => cat.click());

  const purple =
    document.querySelector<HTMLButtonElement>('.ui-icon-picker-flyout [aria-label="Purple"]') ??
    assert.fail("the cat asks its colors");

  assert.ok(field(), "the colors taking the focus end no edit");
  await act(async () => purple.click());
  await vi.waitFor(() =>
    assert.deepEqual(faced, [{ agentId: FRONTEND, face: { character: "cat", color: "purple" } }]),
  );
  await vi.waitFor(() => assert.equal(document.activeElement, field(), "the name takes the focus"));
  assert.equal(document.querySelector('button[aria-label="Cat"]'), null, "the picker is put away");

  const name = field() ?? assert.fail("the edit stands");

  await act(async () =>
    name.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(field(), null, "Escape ends the edit");
  assert.deepEqual(renamed, [], "and renames nothing");
});

test("a Manager's row's Settings… opens its settings, whose name renames it in place and whose model chip changes its model as picked", async () => {
  const renamed: AgentRenameAsk[] = [];
  const chosen: { agentId: string; model: string }[] = [];
  const sidebar = await mountSidebar(true, [], undefined, [], renamed, chosen);
  const list = sidebar.querySelector('nav[aria-label="Managers"]');

  const row =
    [...(list?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Frontend Manager"),
    ) ?? assert.fail("the Manager's row is drawn");

  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });

  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const settings = items().find((item) => item.textContent?.startsWith("Settings…"));

  assert.ok(settings, "Settings… stands in the menu");
  act(() => settings.click());

  const name =
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) =>
        button.textContent === "Frontend Manager" &&
        button.getAttribute("aria-description") === "Rename",
    ) ?? assert.fail("the Manager's name is drawn, pressed to rename it");

  act(() => name.click());

  const field =
    document.querySelector<HTMLInputElement>('[role="dialog"] input') ??
    assert.fail("the name opens in a field");

  assert.equal(field.value, "Frontend Manager");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, " Web ");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await vi.waitFor(() => assert.deepEqual(renamed, [{ agentId: FRONTEND, title: "Web" }]));

  const chip =
    document.querySelector<HTMLButtonElement>('[role="dialog"] .agent-model-chip button') ??
    assert.fail("the Model chip is drawn");

  act(() => chip.click());

  const sonnet =
    [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')].find((option) =>
      option.textContent?.includes("Sonnet 5.5"),
    ) ?? assert.fail("the chip lists the second model");

  act(() => sonnet.click());
  await vi.waitFor(() => assert.deepEqual(chosen, [{ agentId: FRONTEND, model: SONNET }]));
});

/** A Mac the member registered, their last Runs on pick. */
const MAC: MacOffer = {
  deviceId: "0a1b2c3d-0000-4000-8000-0000000000aa",
  name: "Ada's Mac",
  providers: [MODEL_PROVIDER.ANTHROPIC],
};

/** New Task's control as New Manager reads it: the recent repository, and the devices as `modelsRead` stands. */
/** New task as New Manager reads it: its doors, and where the newest read of the models stands, which the window provides apart (`NewTaskShown.modelsRead`). */
interface ManagerNewTask {
  readonly newTask: NewTask;
  readonly modelsRead: ModelsRead;
}

function newManagerTask({
  modelsRead = NEW_TASK_UNSHOWN.modelsRead,
  ...overrides
}: Partial<NewTask> & { readonly modelsRead?: ModelsRead } = {}): ManagerNewTask {
  return {
    newTask: newTaskControl({
      repositoriesIn: () => ({ ...NO_REPOSITORIES, recent: [RELAY] }),
      ...overrides,
    }),
    modelsRead,
  };
}

/**
 * The sidebar over the workspace with Managers on, the account's default
 * model read, each Create the service hears kept in `created` and answered
 * unanswered; answers how to draw it again over another New Task, press a
 * button by its name, and type the Manager's name.
 */
async function mountNewManager(newTask: ManagerNewTask) {
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

  const draw = (next: ManagerNewTask) =>
    root.render(
      withQueryClient(
        withNewTaskShown(
          { modelsRead: next.modelsRead },
          drawnSidebar(
            sidebarProps(
              tasksControl({
                workspaces: [WORKSPACE],
                workspace: WORKSPACE,
                newTask: next.newTask,
              }),
            ),
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
