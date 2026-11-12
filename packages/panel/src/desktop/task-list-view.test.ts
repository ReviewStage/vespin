// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "@repo/features/task-wire";
import type { Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Match } from "effect";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handHostReads, handMembers } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { type TestWindowRouter, windowRouter } from "../testing/window-router.js";
import { ToastHost } from "../toast.js";

/**
 * task-list-view.test.ts -- the sidebar's Tasks section lists the work under
 * way, the reader's own until View options says otherwise, grouped as it
 * says, each row saying what its group does not, the pins standing apart in
 * a section of their own, and each workspace keeping its own view on this
 * Mac.
 */

const DEAN = "user-dean";
const CHARLES = "user-charles";

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 3,
} as const satisfies Workspace;

const PERSONAL = { ...ACME, id: "workspace-personal", name: "Dean", memberCount: 1 };

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DEAN, name: "Dean Stratakos", email: "dean@acme.dev", role: "owner" },
  { userId: CHARLES, name: "Charles Pan", email: "charles@acme.dev", role: "member" },
  { userId: "user-maya", name: "Maya Okafor", email: "maya@acme.dev", role: "member" },
];

/** The Tasks section, called whose tasks it holds. */
const TASK_LIST = 'nav[aria-label$="tasks"]';

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
  handMembers(() => ({ rows: { members: MEMBERS } }));
});

afterEach(() => {
  unmountAll();
  document.body.innerHTML = "";
});

function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
}

/** A task of the workspace's, by `creator`, on `repository`. */
function task(
  id: string,
  name: string,
  repository: string | null,
  creator: string,
  times: { createdAt: number; updatedAt: number } = { createdAt: 1, updatedAt: 2 },
  pinnedAt?: number,
): TaskSummary {
  return {
    id,
    workspaceId: ACME.id,
    name,
    repository,
    ...times,
    ownerId: creator,
    createdBy: { userId: creator, name: creator === DEAN ? "Dean Stratakos" : "Charles Pan" },
    ...(pinnedAt === undefined ? undefined : { pinnedAt }),
  };
}

const TASKS = [
  task("t-1", "Retry webhooks", "acme/relay", DEAN, { createdAt: 10, updatedAt: 500 }),
  task("t-2", "Fix flaky deploy", "acme/relay", CHARLES, { createdAt: 30, updatedAt: 400 }),
  task("t-3", "Billing empty states", "acme/console", CHARLES, { createdAt: 20, updatedAt: 600 }),
  task("t-4", "Release checklist", "acme/relay", DEAN, { createdAt: 5, updatedAt: 5 }, 900),
];

/** `TASKS` with Dean on Fix flaky deploy and Charles on Retry webhooks, Billing empty states with no one on it. */
const ASSIGNED = TASKS.map((each) =>
  Match.value(each.id).pipe(
    Match.when("t-2", () => ({ ...each, assignee: { userId: DEAN, name: "Dean Stratakos" } })),
    Match.when("t-1", () => ({ ...each, assignee: { userId: CHARLES, name: "Charles Pan" } })),
    Match.orElse(() => each),
  ),
);

/** The window's router the sidebar last mounted stands under, which its doors move. */
let sidebarRouter: TestWindowRouter = windowRouter();

/** Keeps Assigned to › Anyone for `workspace`, as a reader who chose it on an earlier launch has, for a test of what the list draws whoever's it is. */
function keepAnyone(workspace: Workspace = ACME): void {
  window.localStorage.setItem(
    "app.sidebarTaskViews",
    JSON.stringify({ [workspace.id]: { grouping: "repository", assignee: { kind: "anyone" } } }),
  );
}

/** The sidebar listing `plans` in `workspace`, read by Dean. */
function mountSidebar(workspace: Workspace, tasks: readonly TaskSummary[] = TASKS): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  sidebarRouter = windowRouter();

  const control = tasksControl({
    tasks: [...tasks],
    workspace,
    workspaces: [workspace],
    me: DEAN,
  });

  act(() =>
    root.render(
      withQueryClient(
        createElement(
          Fragment,
          null,
          drawnSidebar(sidebarProps(control), sidebarRouter),
          createElement(ToastHost),
        ),
      ),
    ),
  );

  return container;
}

/** The words each standing menu item or searched row says, its glyph left out. */
function itemLabel(item: HTMLElement): string {
  return (
    (
      item.querySelector(".ui-menu-item-label, .ui-combobox-option-label") ?? item
    ).textContent?.trim() ?? ""
  );
}

/** The menu item, or the searched panel's row, that says `label`, in whichever menu stands. */
function menuItem(label: string): HTMLElement {
  const items = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemcheckbox"], [role="option"]',
    ),
  ];

  const found = items.find((item) => itemLabel(item) === label);
  assert.ok(found, `a menu item named ${label} stands among ${items.map(itemLabel).join(", ")}`);

  return found;
}

/** The Tasks head's View options, which drops the view's menu. */
function viewOptions(sidebar: HTMLElement): HTMLButtonElement {
  return (
    sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]') ??
    assert.fail("the Tasks head offers View options")
  );
}

/** Chooses `choice` under Group by in the Tasks head's View options, and lets the menu go. */
function groupBy(sidebar: HTMLElement, choice: string): void {
  const button = viewOptions(sidebar);
  act(() => button.click());
  act(() => menuItem("Group by").click());
  const grouping = menuItem(choice);
  act(() => grouping.click());
  act(() => {
    grouping.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

/** Lists the tasks in one run, Group by › None. */
function listUngrouped(sidebar: HTMLElement): void {
  groupBy(sidebar, "None");
}

/** Chooses `choice` under `submenu` in the Tasks head's View options. */
async function choose(sidebar: HTMLElement, submenu: string, choice: string): Promise<void> {
  const button = viewOptions(sidebar);
  act(() => button.click());
  act(() => menuItem(submenu).click());
  // Note that a member is offered once the workspace's members reach their query.
  const item = await vi.waitFor(() => menuItem(choice));
  act(() => item.click());
}

/** The first of a button's words a reader hears: a row's or a fold's name, before its count and its chord. */
function heardName(button: Element): string {
  const heard = [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true");

  return heard?.textContent ?? "";
}

/** The Tasks section's group headers, in order. */
function groupNames(sidebar: HTMLElement): string[] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");

  return [
    ...tasks.querySelectorAll(".ui-group-header-head button[aria-expanded]:not([aria-haspopup])"),
  ].map(heardName);
}

/** The rows of the Tasks section: each name, the repository it says, and whether it wears a face. */
function taskRows(
  sidebar: HTMLElement,
): { name: string; repository: string | undefined; face: boolean }[] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");

  return [...tasks.querySelectorAll(".sidebar-tasks > li > button")].map((row) => ({
    name: row.querySelector(".ui-list-row-title")?.firstChild?.textContent ?? "",
    repository: row.querySelector(".sidebar-task-repository")?.textContent ?? undefined,
    face: row.querySelector(".actor-mark") !== null,
  }));
}

/** `ASSIGNED`, and one more task Dean made that no one is on yet. */
const MINE_UNASSIGNED = [
  ...ASSIGNED,
  task("t-5", "Audit logs", "acme/console", DEAN, { createdAt: 40, updatedAt: 300 }),
];

/** The words a card hung now names its subject by. */
function cardName(): string | undefined {
  return document.querySelector(".ui-tooltip-card .ui-hover-card-name")?.textContent ?? undefined;
}

/** The words of each item of the menu standing last, its glyph left out. */
function lastMenuItems(): string[] {
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1);

  return [
    ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? []),
  ].map(itemLabel);
}

/** The sidebar once the workspace's members have answered. */
async function mountRead(
  workspace: Workspace,
  tasks?: readonly TaskSummary[],
): Promise<HTMLElement> {
  const sidebar = mountSidebar(workspace, tasks);
  await act(async () => undefined);

  return sidebar;
}

/** What the Tasks head says, which the list is called by too. */
function headWords(sidebar: HTMLElement): string | undefined {
  const list = sidebar.querySelector(TASK_LIST);

  const said =
    sidebar.querySelector(".sidebar-tasks-head .ui-group-header-lead")?.textContent ?? undefined;

  assert.equal(
    list?.getAttribute("aria-label") ?? undefined,
    said,
    "the list is called as its head says",
  );

  return said;
}

test("a shared workspace opens on your own tasks, those you are on and those no one is on that you made, by repository, newest updated first", async () => {
  const sidebar = await mountRead(ACME, MINE_UNASSIGNED);

  assert.deepEqual(groupNames(sidebar), ["relay", "console"]);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Fix flaky deploy", repository: undefined, face: false },
    { name: "Audit logs", repository: undefined, face: true },
  ]);
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), null);
});

test("View options offers Group by, Show completed sub-tasks, and Assigned to, Assigned to holding Me, Anyone, then each teammate by name with their email beside it, hanging their card", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  const button = viewOptions(sidebar);
  act(() => button.click());
  assert.deepEqual(lastMenuItems(), ["Group by", "Show completed sub-tasks", "Assigned to"]);
  assert.equal(menuItem("Show completed sub-tasks").getAttribute("aria-checked"), "false");
  act(() => menuItem("Assigned to").click());
  await vi.waitFor(() =>
    assert.deepEqual(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => [
        itemLabel(row),
        row.querySelector(".ui-combobox-option-detail")?.textContent ?? null,
        row.getAttribute("aria-current") === "true",
      ]),
      [
        ["Me", null, true],
        ["Anyone", null, false],
        ["Charles Pan", "charles@acme.dev", false],
        ["Maya Okafor", "maya@acme.dev", false],
      ],
    ),
  );
  restOn(menuItem("Charles Pan"));
  assert.equal(cardName(), "Charles Pan");
});

test("the Tasks head says My tasks, then Everyone's tasks once Assigned to › Anyone lists everyone's, kept across launches, with a dot and no chip", async () => {
  const mine = await mountRead(ACME, ASSIGNED);
  assert.equal(headWords(mine), "My tasks");
  await choose(mine, "Assigned to", "Anyone");
  unmountAll();

  const sidebar = await mountRead(ACME, ASSIGNED);
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(headWords(sidebar), "Everyone's tasks");
  assert.equal(sidebar.querySelector('button[aria-label="Show my tasks"]'), null, "no chip");
  assert.equal(viewOptions(sidebar).getAttribute("aria-description"), "Filtered");
});

test("grouped by none, the tasks run in one list, each row naming its repository and wearing who is on it", () => {
  keepAnyone();
  const sidebar = mountSidebar(ACME, ASSIGNED);
  listUngrouped(sidebar);
  assert.deepEqual(groupNames(sidebar), []);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Billing empty states", repository: "console", face: true },
    { name: "Retry webhooks", repository: "relay", face: true },
    { name: "Fix flaky deploy", repository: "relay", face: false },
  ]);
});

test("the pins stand in a section of their own above Tasks, whatever the view lists", () => {
  const pinnedTheirs = task("t-6", "Onboarding rewrite", "acme/console", CHARLES, undefined, 950);
  const sidebar = mountSidebar(ACME, [...TASKS, pinnedTheirs]);
  const pinned = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(pinned?.querySelectorAll(".ui-list-row-title") ?? [])].map(
      (name) => name.firstChild?.textContent,
    ),
    ["Onboarding rewrite", "Release checklist"],
  );
  assert.ok(
    !taskRows(sidebar).some((row) => row.name === "Release checklist"),
    "a pinned task is not listed again under Tasks",
  );
});

test("each workspace keeps its own view on this Mac across launches", () => {
  listUngrouped(mountSidebar(ACME));
  unmountAll();

  assert.deepEqual(groupNames(mountSidebar(ACME)), []);
  unmountAll();
  const other = { ...PERSONAL, id: "workspace-other", name: "Other" };
  const elsewhere = TASKS.map((each) => ({ ...each, workspaceId: other.id }));
  assert.deepEqual(groupNames(mountSidebar(other, elsewhere)), ["console", "relay"]);
});

test("a view kept grouped by progress, before that grouping was removed, opens by repository and keeps the rest of its choices", () => {
  window.localStorage.setItem(
    "app.sidebarTaskViews",
    JSON.stringify({ [ACME.id]: { grouping: "progress", assignee: { kind: "anyone" } } }),
  );
  const sidebar = mountSidebar(ACME);
  assert.deepEqual(groupNames(sidebar), ["console", "relay"]);
  assert.equal(headWords(sidebar), "Everyone's tasks");
});

test("a workspace nobody shares lists every task and offers no Assigned to, Group by choosing Repository or None, Repository at first", () => {
  const sidebar = mountSidebar(PERSONAL);
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(headWords(sidebar), "My tasks");
  const button = viewOptions(sidebar);
  assert.equal(button.getAttribute("aria-description"), null);
  act(() => button.click());
  assert.deepEqual(lastMenuItems(), ["Group by", "Show completed sub-tasks"]);
  act(() => menuItem("Group by").click());
  assert.deepEqual(
    ["Repository", "None"].map((choice) => menuItem(choice).getAttribute("aria-checked")),
    ["true", "false"],
  );
});

test("by repository, the headings stand only where the tasks span two repositories or more, No repository counted as one and last", async () => {
  const notes = task("t-6", "Hiring loop notes", null, DEAN, { createdAt: 1, updatedAt: 700 });
  const relayOnly = TASKS.filter((each) => each.repository === "acme/relay");
  const one = await mountRead(PERSONAL, relayOnly);
  assert.deepEqual(groupNames(one), []);
  assert.deepEqual(
    taskRows(one).map((row) => row.name),
    ["Retry webhooks", "Fix flaky deploy"],
  );
  unmountAll();

  assert.deepEqual(groupNames(await mountRead(PERSONAL, [notes])), []);
  unmountAll();

  assert.deepEqual(groupNames(await mountRead(PERSONAL, [...relayOnly, notes])), [
    "relay",
    "No repository",
  ]);
});

test("a list of your own that holds nothing says so, and Show all lists everyone's", async () => {
  const theirs = TASKS.filter((each) => each.createdBy?.userId === CHARLES);
  const sidebar = await mountRead(ACME, theirs);
  assert.equal(taskRows(sidebar).length, 0);

  const note = [...sidebar.querySelectorAll(".ui-note-line")].find((each) =>
    each.textContent?.startsWith("No tasks match this view."),
  );

  const showAll = note?.querySelector("button");
  assert.ok(showAll, "the note offers Show all");
  act(() => showAll.click());
  assert.equal(taskRows(sidebar).length, 2);
  assert.equal(headWords(sidebar), "Everyone's tasks");
});

test("with every task pinned, a filter still says it leaves nothing under Tasks, with Show all", async () => {
  const pinnedAll = TASKS.map((each, at) => ({ ...each, pinnedAt: 900 + at }));
  const sidebar = await mountRead(ACME, pinnedAll);
  await choose(sidebar, "Assigned to", "Charles Pan");
  const notes = [...sidebar.querySelectorAll(".ui-note-line")].map((note) => note.textContent);
  assert.ok(
    notes.some((note) => note?.startsWith("No tasks match this view.")),
    "the empty filter says so",
  );
});

test("a workspace whose list names no member count still filters by person once its members are read", async () => {
  const { memberCount: _, ...uncounted } = ACME;
  const sidebar = await mountRead(uncounted);
  await vi.waitFor(() =>
    assert.deepEqual(
      taskRows(sidebar).map((row) => row.name),
      ["Retry webhooks"],
    ),
  );
  await choose(sidebar, "Assigned to", "Anyone");
  assert.equal(taskRows(sidebar).length, 3);
});

test("in one run, a task with no repository says so on its row", async () => {
  const notes = task("t-6", "Hiring loop notes", null, DEAN, { createdAt: 1, updatedAt: 700 });
  const sidebar = await mountRead(ACME, [...TASKS, notes]);
  listUngrouped(sidebar);
  assert.deepEqual(taskRows(sidebar)[0], {
    name: "Hiring loop notes",
    repository: "No repository",
    face: true,
  });
});

test("an empty workspace says only that it holds no tasks", async () => {
  const sidebar = await mountRead(ACME, []);

  // Note that the pinned section's own "Drag tasks here to pin them" is a line of the sidebar too.
  const notes = [...sidebar.querySelectorAll(".ui-note-line")].flatMap(({ textContent: note }) =>
    note?.startsWith("Drag tasks here") === true ? [] : [note],
  );

  assert.deepEqual(notes, ["No tasks yet."]);
});

test("⌘K offers each view choice only while it would change the list, and running one changes it as the menu would", async () => {
  const sidebar = await mountRead(ACME);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_MY_TASKS), false);

  act(() => {
    runAppCommand(APP_COMMAND.LIST_TASKS_UNGROUPED);
  });
  assert.deepEqual(groupNames(sidebar), []);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), false);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), true);

  act(() => {
    runAppCommand(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY);
  });
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), false);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), true);

  act(() => {
    runAppCommand(APP_COMMAND.SHOW_EVERYONES_TASKS);
  });
  assert.equal(headWords(sidebar), "Everyone's tasks");
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), false);
  act(() => {
    runAppCommand(APP_COMMAND.SHOW_MY_TASKS);
  });
  assert.equal(headWords(sidebar), "My tasks");
});

test("Show completed sub-tasks stands a parent's finished sub-tasks under it, muted, never a finished task at the top, and ⌘K hides them again", async () => {
  const of = (
    id: string,
    name: string,
    status: TaskStatus,
    parentTaskId?: string,
  ): TaskSummary => ({
    ...task(id, name, "acme/relay", DEAN, { createdAt: 1, updatedAt: 800 }),
    assignee: { userId: DEAN, name: "Dean Stratakos" },
    status,
    ...(parentTaskId === undefined ? undefined : { parentTaskId }),
  });

  const names = (within: HTMLElement) =>
    [...within.querySelectorAll(`${TASK_LIST} .ui-list-row-title`)].map(
      (title) => title.firstChild?.textContent,
    );

  const sidebar = await mountRead(ACME, [
    of("p", "Onboarding", TASK_STATUS.IN_PROGRESS),
    of("a", "Audit", TASK_STATUS.DONE, "p"),
    of("d", "Delete", TASK_STATUS.IN_PROGRESS, "a"),
    of("s", "Shipped", TASK_STATUS.DONE),
  ]);

  const button = viewOptions(sidebar);
  act(() => button.click());
  act(() => menuItem("Show completed sub-tasks").click());

  const fold = sidebar.querySelector<HTMLButtonElement>(
    'button[aria-label="Sub-tasks of Onboarding"]',
  );

  assert.ok(fold, "Onboarding folds its sub-tasks");
  act(() => fold.click());
  const audit = sidebar.querySelector<HTMLButtonElement>('button[aria-label="Sub-tasks of Audit"]');
  assert.ok(audit, "Audit folds its sub-tasks");
  act(() => audit.click());
  assert.deepEqual(names(sidebar), ["Onboarding", "Audit", "Delete"]);

  const muted = [...sidebar.querySelectorAll(`${TASK_LIST} li[data-muted="true"]`)].map(
    (row) => row.querySelector(".ui-list-row-title")?.firstChild?.textContent,
  );

  assert.deepEqual(muted, ["Audit"]);

  act(() => {
    runAppCommand(APP_COMMAND.HIDE_FINISHED_SUB_TASKS);
  });
  assert.deepEqual(names(sidebar), ["Onboarding", "Delete"]);
  assert.equal(appCommandOffered(APP_COMMAND.HIDE_FINISHED_SUB_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_FINISHED_SUB_TASKS), true);
});

test("a workspace nobody shares offers ⌘K no filtering by person", async () => {
  await mountRead(PERSONAL);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_MY_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), true);
});

/** A task of the workspace's standing in `status`. */
function standing(id: string, name: string, status: TaskStatus, updatedAt: number): TaskSummary {
  return { ...task(id, name, "acme/relay", DEAN, { createdAt: 1, updatedAt }), status };
}

const BY_STATUS = [
  standing("s-1", "Rate limit search", TASK_STATUS.BACKLOG, 90),
  standing("s-2", "Onboarding copy", TASK_STATUS.BACKLOG, 80),
  standing("s-3", "Fix Safari login", TASK_STATUS.IN_PROGRESS, 70),
  standing("s-4", "CSV export", TASK_STATUS.TODO, 60),
  standing("s-5", "Retry webhooks", TASK_STATUS.DONE, 50),
];

test("the list holds the tasks to do and in progress, each led by its status's mark", () => {
  const sidebar = mountSidebar(ACME, BY_STATUS);

  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Fix Safari login", "CSV export"],
  );

  const marks = [
    ...sidebar.querySelectorAll(`${TASK_LIST} .ui-list-row-leading .ui-task-status-mark`),
  ].map((mark) => mark.getAttribute("data-status"));

  assert.deepEqual(marks, [TASK_STATUS.IN_PROGRESS, TASK_STATUS.TODO]);
});

test("a task from a service before statuses stands among them", () => {
  const sidebar = mountSidebar(ACME, [...BY_STATUS, task("t-0", "No status", null, DEAN)]);
  assert.ok(taskRows(sidebar).some((row) => row.name === "No status"));
});

/** What a reader of the screen hears each row of the Tasks section say of whose face it wears, by the row's name. */
function heardFaces(sidebar: HTMLElement): [string, string | undefined][] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");

  return [...tasks.querySelectorAll(".sidebar-tasks > li > button")].map((row) => [
    row.querySelector(".ui-list-row-title")?.firstChild?.textContent ?? "",
    row.querySelector(".ui-list-row-title .ui-visually-hidden:last-child")?.textContent ??
      undefined,
  ]);
}

test("a row wears its assignee's face where someone else is on it, none where you are, and the unassigned mark, never its creator's, where no one is", async () => {
  keepAnyone();
  const sidebar = await mountRead(ACME, ASSIGNED);
  listUngrouped(sidebar);

  assert.deepEqual(heardFaces(sidebar), [
    ["Billing empty states", "(unassigned)"],
    ["Retry webhooks", "(assigned to Charles Pan)"],
    ["Fix flaky deploy", undefined],
  ]);
});

test("Assigned to a teammate, with nothing of theirs, says so, and Show all lists everyone's again", async () => {
  const sidebar = await mountRead(ACME, TASKS);
  await choose(sidebar, "Assigned to", "Charles Pan");

  assert.equal(headWords(sidebar), "Charles Pan's tasks");
  assert.equal(taskRows(sidebar).length, 0);

  const note = [...sidebar.querySelectorAll(".ui-note-line")].find((each) =>
    each.textContent?.startsWith("No tasks match this view."),
  );

  const showAll = note?.querySelector("button");
  assert.ok(showAll, "the note offers Show all");
  act(() => showAll.click());
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(headWords(sidebar), "Everyone's tasks");
});

test("Assigned to says the members could not be read, with Retry, under Me and Anyone, and Retry reads them again and leaves the menu standing", async () => {
  const reads = handHostReads({ members: { [ACME.id]: { failed: true } } });
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_RETRY]: ({ workspaceId }) => {
      reads.deliverMembers({ [workspaceId]: { rows: { members: MEMBERS } } });

      return Promise.resolve();
    },
  });
  const sidebar = await mountRead(ACME, ASSIGNED);
  const button = viewOptions(sidebar);
  act(() => button.click());
  act(() => menuItem("Assigned to").click());

  const offered = () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(itemLabel);

  const retry = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (each) => each.textContent === "Retry",
    );

  // Note that the refusal is said once it reaches the members' query.
  const offeredRetry = await vi.waitFor(() => retry() ?? assert.fail("the panel offers Retry"));
  const failed = offered();
  const said = document.body.textContent ?? "";
  await act(async () => offeredRetry.click());

  assert.deepEqual(failed, ["Me", "Anyone"]);
  assert.match(said, /Members could not be read\./u);
  await vi.waitFor(() => assert.equal(offered().includes("Charles Pan"), true));
  assert.equal(retry(), undefined);
});
