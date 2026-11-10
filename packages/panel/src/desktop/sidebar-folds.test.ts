// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import { TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { writeListedTasks } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import {
  agentHoldingsOf,
  agentsControl,
  handInbox,
  newTaskControl,
  tasksControl,
} from "../testing/tasks-control.js";
import { ArchivedAgents } from "./agent-archive.js";

/**
 * sidebar-folds.test.ts -- every group that folds folds under one
 * header, `GroupHeader`: the sidebar's Pinned and repositories, and the summary's archived
 * agents, alike but for what each counts, each unrolling as it opens, and a
 * folded group leaving the task open standing.
 */

const roots: Root[] = [];

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

function task(id: string, name: string, repository: string | null): TaskSummary {
  return { id, workspaceId: "workspace-personal", name, createdAt: 1, updatedAt: 2, repository };
}

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(element)));
  return container;
}

/** The sidebar on the Tasks tab, open, listing what `tasks` lists. */
function mountSidebar(tasks: TasksControl): HTMLElement {
  return mount(drawnSidebar(sidebarProps(tasks)));
}

/** The fold whose words start with `name`. */
function fold(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (button) => button.textContent?.startsWith(name),
  );
  assert.ok(found, `a fold named ${name} is drawn`);
  return found;
}

test("the summary's archived agents fold under a group header that counts them folded and lists them unfolded", () => {
  const agent = {
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 1,
    status: AGENT_STATUS.CANCELED,
    turnId: null,
    archivedAt: 2,
  } as const;
  const summary = mount(
    createElement(ArchivedAgents, {
      agents: agentsControl({
        archived: [
          { ...agent, id: "agent-1", title: "Retry audit" },
          { ...agent, id: "agent-2", title: "Spike" },
        ],
      }),
      shown: true,
      onOpen: () => undefined,
    }),
  );

  assert.equal(fold(summary, "Archived").getAttribute("aria-expanded"), "false");
  assert.equal(fold(summary, "Archived").textContent, "Archived2 archived agents");
  act(() => fold(summary, "Archived").click());
  assert.equal(fold(summary, "Archived").getAttribute("aria-expanded"), "true");
  assert.ok(summary.querySelector('[aria-label="Archived agents"]'), "the agents are listed");
});

test("Pinned folds on its name, counts its pins folded, and leaves the pin that is open standing", () => {
  const pinned = (id: string, name: string, position: string) => ({
    ...task(id, name, "acme/relay"),
    pinnedAt: 5,
    pinPosition: position,
  });
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [pinned("p-1", "Invite expiry", "a0"), pinned("p-2", "Retry audit", "a1")],
      activeTaskId: "p-2",
    }),
  );
  const names = () =>
    [...sidebar.querySelectorAll('nav[aria-label="Pinned"] .ui-list-row-title')].map(
      (title) => title.firstChild?.textContent,
    );
  assert.equal(fold(sidebar, "Pinned").getAttribute("aria-expanded"), "true");
  assert.equal(fold(sidebar, "Pinned").textContent, "Pinned");
  assert.deepEqual(names(), ["Invite expiry", "Retry audit"]);

  act(() => fold(sidebar, "Pinned").click());
  assert.equal(fold(sidebar, "Pinned").getAttribute("aria-expanded"), "false");
  assert.equal(fold(sidebar, "Pinned").textContent, "Pinned2 pins");
  assert.deepEqual(names(), ["Retry audit"], "the pin on show stays");

  act(() => fold(sidebar, "Pinned").click());
  assert.equal(fold(sidebar, "Pinned").getAttribute("aria-expanded"), "true");
  assert.deepEqual(names(), ["Invite expiry", "Retry audit"]);
});

test("a folded repository leaves only the task that is open standing, one that needs you folded away with the rest, and unfolds to every task", () => {
  handInbox({
    waiting: [
      {
        taskId: "p-3",
        items: [{ id: "item-1", agentId: "agent-1", title: "Retry?", postedAt: 1 }],
      },
    ],
  });
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [
        task("p-1", "Invite expiry", "acme/relay"),
        task("p-2", "Retry audit", "acme/relay"),
        task("p-3", "Webhook retries", "acme/relay"),
        task("p-4", "Billing export", "acme/console"),
      ],
      activeTaskId: "p-1",
    }),
  );
  const names = () =>
    [...sidebar.querySelectorAll('nav[aria-label="My tasks"] .ui-list-row-title')]
      .map((title) => title.firstChild?.textContent)
      .sort();
  assert.deepEqual(names(), ["Billing export", "Invite expiry", "Retry audit", "Webhook retries"]);

  act(() => fold(sidebar, "relay").click());
  assert.deepEqual(names(), ["Billing export", "Invite expiry"]);

  act(() => fold(sidebar, "relay").click());
  assert.deepEqual(names(), ["Billing export", "Invite expiry", "Retry audit", "Webhook retries"]);
});

test("a repository's header folds on its name, says it is kept at top, counts its plans folded, keeps its + outside the fold, and opens its menu on a right-click", () => {
  const asked: string[] = [];
  writeListedTasks({ repositoryPins: [{ repository: "acme/relay", pinnedAt: 1 }] });
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [
        { ...task("p-1", "Invite expiry", "acme/relay"), readThrough: 1 },
        { ...task("p-2", "Retry audit", "acme/relay"), readThrough: 2 },
        task("p-3", "Billing export", "acme/console"),
      ],
      newTask: newTaskControl({ onOpenIn: (repository) => asked.push(repository) }),
    }),
  );
  const relay = () => fold(sidebar, "relay");
  assert.equal(relay().getAttribute("aria-expanded"), "true");
  assert.equal(relay().textContent, "relay(kept at top)");

  act(() => relay().click());
  assert.equal(relay().getAttribute("aria-expanded"), "false");
  assert.equal(relay().textContent, "relay(kept at top)2 tasks");

  const plus = sidebar.querySelector<HTMLButtonElement>('button[aria-label="New task in relay"]');
  assert.ok(plus, "the header offers a new plan in its repository");
  act(() => plus.click());
  assert.deepEqual(asked, ["acme/relay"]);
  assert.equal(relay().getAttribute("aria-expanded"), "false", "the + folds nothing");

  act(() => {
    relay().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const menu = document.querySelector('[role="menu"][aria-label="relay actions"]');
  assert.ok(menu, "the right-click opens the repository's menu");
  assert.deepEqual(
    [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ["Stop keeping at top", "Open on GitHub", "Mark all as read"],
  );
  const ellipsis = sidebar.querySelector('button[aria-label="relay actions"]');
  assert.equal(ellipsis?.getAttribute("aria-expanded"), "true");
});

test("the Inbox row counts what waits on a plan and what waits from an agent with no plan alike, and not a teammate's agent's with no plan, which waits on them", () => {
  const taskless = [
    {
      id: "item-2",
      agentId: "agent-2",
      title: "Quarantine the flaky test?",
      postedAt: 2,
      updatedAt: 2,
      agentTitle: null,
      agentModel: "anthropic/claude-opus-5.5",
      automationId: null,
      automationName: null,
      repository: "acme/relay",
      startedBy: "user-dean",
    },
    {
      id: "item-3",
      agentId: "agent-3",
      title: "Bump the Node image?",
      postedAt: 3,
      updatedAt: 3,
      agentTitle: null,
      agentModel: "anthropic/claude-opus-5.5",
      automationId: null,
      automationName: null,
      repository: "acme/relay",
      startedBy: "user-charles",
    },
  ];
  handInbox({
    waiting: [
      {
        taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
        items: [{ id: "item-1", agentId: "agent-1", title: "Retry?", postedAt: 1 }],
      },
    ],
    taskless,
    agents: agentHoldingsOf(taskless),
  });
  const page = mountSidebar(
    tasksControl({
      me: "user-dean",
      tasks: [task("7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", "Webhook retries", "acme/relay")],
    }),
  );

  const inbox = [...page.querySelectorAll("aside.desktop-sidebar button")].find((button) =>
    button.textContent?.startsWith("Inbox"),
  );
  assert.match(inbox?.textContent ?? "", /^Inbox2 /u);
});

test("a child task stands under its parent, folded until the parent's chevron opens it, to any depth, and stays opened across launches", () => {
  const listed = (id: string, updatedAt: number, parentTaskId?: string): TaskSummary => ({
    ...task(id, id, "acme/relay"),
    updatedAt,
    ...(parentTaskId === undefined ? undefined : { parentTaskId }),
  });
  const tasks = tasksControl({
    tasks: [
      listed("Parent", 40),
      listed("Other", 30),
      listed("Child", 20, "Parent"),
      listed("Grandchild", 10, "Child"),
    ],
  });
  const names = (within: HTMLElement) =>
    [...within.querySelectorAll('nav[aria-label="My tasks"] .ui-list-row-title')].map(
      (title) => title.firstChild?.textContent,
    );
  const chevron = (within: HTMLElement, name: string) => {
    const found = within.querySelector<HTMLButtonElement>(
      `button[aria-label="Sub-tasks of ${name}"]`,
    );
    assert.ok(found, `${name}'s fold is drawn`);
    return found;
  };
  const sidebar = mountSidebar(tasks);
  assert.deepEqual(names(sidebar), ["Parent", "Other"]);
  assert.equal(chevron(sidebar, "Parent").getAttribute("aria-expanded"), "false");

  act(() => chevron(sidebar, "Parent").click());
  assert.deepEqual(names(sidebar), ["Parent", "Child", "Other"]);
  act(() => chevron(sidebar, "Child").click());
  assert.deepEqual(names(sidebar), ["Parent", "Child", "Grandchild", "Other"]);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.deepEqual(names(mountSidebar(tasks)), ["Parent", "Child", "Grandchild", "Other"]);
});

/** A task on acme/relay named for its id, under `parentTaskId` where one is named. */
function family(id: string, parentTaskId?: string, more: Partial<TaskSummary> = {}): TaskSummary {
  return {
    ...task(id, id, "acme/relay"),
    ...(parentTaskId === undefined ? undefined : { parentTaskId }),
    ...more,
  };
}

/** The names of the rows a list of the sidebar draws, in order. */
function rowNames(within: HTMLElement, list: string): (string | null | undefined)[] {
  return [...within.querySelectorAll(`nav[aria-label="${list}"] .ui-list-row-title`)].map(
    (title) => title.firstChild?.textContent,
  );
}

/** The chevron folding a task's child tasks. */
function childFold(within: HTMLElement, name: string): HTMLButtonElement {
  const found = within.querySelector<HTMLButtonElement>(
    `button[aria-label="Sub-tasks of ${name}"]`,
  );
  assert.ok(found, `${name}'s fold is drawn`);
  return found;
}

test("a pinned parent's child tasks stand under it in Pinned, folded until opened, and none at the top of Tasks", () => {
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [
        family("Cleanup", undefined, { pinnedAt: 5 }),
        family("Probe", "Cleanup"),
        family("Sweep", "Cleanup"),
      ],
    }),
  );
  assert.deepEqual(rowNames(sidebar, "Pinned"), ["Cleanup"]);
  assert.deepEqual(rowNames(sidebar, "My tasks"), []);

  act(() => childFold(sidebar, "Cleanup").click());
  assert.deepEqual(rowNames(sidebar, "Pinned"), ["Cleanup", "Probe", "Sweep"]);
  assert.deepEqual(rowNames(sidebar, "My tasks"), []);
});

test("a finished sub-task the view hides hands its open child tasks to the nearest parent the sidebar draws, which folds them", () => {
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [
        family("Onboarding", undefined, { status: TASK_STATUS.IN_PROGRESS }),
        family("Audit", "Onboarding", { status: TASK_STATUS.DONE }),
        family("Delete", "Audit", { status: TASK_STATUS.IN_PROGRESS }),
        family("Keep", "Delete", { status: TASK_STATUS.TODO }),
      ],
    }),
  );
  assert.deepEqual(rowNames(sidebar, "My tasks"), ["Onboarding"]);

  act(() => childFold(sidebar, "Onboarding").click());
  act(() => childFold(sidebar, "Delete").click());
  assert.deepEqual(rowNames(sidebar, "My tasks"), ["Onboarding", "Delete", "Keep"]);
});

test("a canceled parent the view hides takes its child tasks to do out of the sidebar with it, at every depth", () => {
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [
        family("Migrate", undefined, { status: TASK_STATUS.CANCELED }),
        family("Import", "Migrate", { status: TASK_STATUS.TODO }),
        family("Map", "Import", { status: TASK_STATUS.TODO }),
        family("Other", undefined, { status: TASK_STATUS.IN_PROGRESS }),
      ],
    }),
  );
  assert.deepEqual(rowNames(sidebar, "My tasks"), ["Other"]);
});
