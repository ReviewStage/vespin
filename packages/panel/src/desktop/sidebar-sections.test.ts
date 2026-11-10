// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import { applySectionWrite } from "@repo/features/task-section-writes";
import { sectionTaskIds, workspaceSections } from "@repo/features/task-sections-model";
import { TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { type PinMove, TASK_MARK, type TaskMark } from "@repo/ui/tasks-model";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test, vi } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { QUERY_ROOT } from "../query-keys.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState, writeListedTasks } from "../testing/app-state.js";
import { settleQueries, testQueryClientNow, withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { playListMotions } from "../testing/pane-motion.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";

/**
 * sidebar-sections.test.ts -- the account's own sections in the sidebar:
 * each drawn over the tasks kept in it, its tasks chosen with those under
 * Tasks by ⌘-click for one menu to act on them all,
 * which Tasks then leaves out, and reached from a task's menu, whose Move
 * to section writes the move and whose section's Delete acts at once with Undo; and
 * the dialog's icon picker, every Lucide glyph in a color and every emoji,
 * found by one search; and a task dragged between Pinned, Tasks, and a
 * section, pinned, unpinned, and moved where it is let go; and, under a finger, which drags nothing, a pin, a
 * section, and a section's task moved a place by its menu, which a long
 * press, a right-click, and the keyboard's ⇧⌘↑ and ⇧⌘↓ all reach, the row
 * kept focused. Synthetic throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const LAUNCH = "0a1b2c3d-0000-4000-8000-000000000001";

/** Where this Mac keeps the icons it chose last, as the picker keeps them. */
const RECENT_ICONS = "app.recentSectionIcons";

const roots: Root[] = [];

/**
 * Hears each pin and section write on the act port, as the window sends
 * them: a section write's writes, a task's pin as its mark, and a pin given
 * a place as its move, each landing.
 */
function hearWrites(asked: Partial<Asked>): void {
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_WRITE_SECTION]: ({ writes }) => {
      asked.writes?.push(...writes);
      return Promise.resolve(true);
    },
    [ACT_KIND.TASKS_PIN]: ({ taskId, pinned, position }) => {
      if (position === undefined)
        asked.marks?.push([taskId, pinned ? TASK_MARK.PIN : TASK_MARK.UNPIN]);
      else asked.moves?.push({ agent: false, id: taskId, position });
      return Promise.resolve(true);
    },
    [ACT_KIND.AGENTS_PIN]: ({ agentId, position }) => {
      if (position !== undefined) asked.moves?.push({ agent: true, id: agentId, position });
      return Promise.resolve({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
    },
  });
}

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

function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
  };
}

const INVITES = task("0a1b2c3d-0000-4000-8000-100000000001", "Invite expiry");
const RETRIES = task("0a1b2c3d-0000-4000-8000-100000000002", "Retry audit");

/** Launch, with its rocket, holding Invite expiry. */
const SECTIONS: TaskSections = {
  sections: [
    {
      id: LAUNCH,
      workspaceId: WORKSPACE.id,
      title: "Launch",
      icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" },
      createdAt: 1,
    },
  ],
  entries: [{ taskId: INVITES.id, sectionId: LAUNCH, addedAt: 2 }],
  agentEntries: [],
};

const SOMEDAY = "0a1b2c3d-0000-4000-8000-000000000002";

/** Launch, and Someday, made without an icon, holding Retry audit. */
const ICONLESS: TaskSections = {
  sections: [
    ...SECTIONS.sections,
    { id: SOMEDAY, workspaceId: WORKSPACE.id, title: "Someday", createdAt: 2 },
  ],
  entries: [...SECTIONS.entries, { taskId: RETRIES.id, sectionId: SOMEDAY, addedAt: 3 }],
  agentEntries: [],
};

/** Lets the window's document land, as main hands it, and what it moves settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

const STARS = "0a1b2c3d-0000-4000-8000-000000000003";
const LOST = "0a1b2c3d-0000-4000-8000-000000000004";

/** Launch, Stars in a teal telescope, a glyph only Lucide whole draws, and Lost, in a glyph no Lucide knows. */
const GLYPHS: TaskSections = {
  sections: [
    ...SECTIONS.sections,
    {
      id: STARS,
      workspaceId: WORKSPACE.id,
      title: "Stars",
      icon: {
        kind: TASK_SECTION_ICON_KIND.GLYPH,
        glyph: "telescope",
        color: TASK_SECTION_ICON_COLOR.TEAL,
      },
      createdAt: 2,
    },
    {
      id: LOST,
      workspaceId: WORKSPACE.id,
      title: "Lost",
      icon: { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "no-such-glyph" },
      createdAt: 3,
    },
  ],
  entries: SECTIONS.entries,
  agentEntries: [],
};

/** Lets what the sidebar and the picker load on demand land: Lucide whole, and the emoji. */
async function settleLoaded(): Promise<void> {
  await act(async () => {
    await Promise.all([import("lucide-react"), import("unicode-emoji-json/data-by-group.json")]);
  });
  // The picker reads them through the test's Query client, which hands each answer on a tick of its own.
  await vi.waitFor(() =>
    assert.equal(testQueryClientNow().isFetching({ queryKey: [QUERY_ROOT.SECTION_ICONS] }), 0),
  );
  await settleQueries(settle);
}

/** Types `words` into a field, as a person would. */
function typeInto(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The dialog's field labeled `label`, failing where none is drawn. */
function dialogField(label: string): HTMLInputElement {
  const named = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
    (candidate) => candidate.textContent === label,
  );
  const found =
    (named === undefined ? null : document.getElementById(named.htmlFor)) ??
    document.querySelector(`input[aria-label="${label}"]`);
  return found instanceof HTMLInputElement ? found : assert.fail(`no ${label} field`);
}

/** The sidebar listing both tasks over `sections`, each write it asks heard by `writes`, and anything else `rest` says of the tasks. */
function sidebarOver(
  sections: TaskSections,
  writes: TaskSectionWrite[],
  rest: Partial<TasksControl> = {},
) {
  writeListedTasks({ taskSections: sections });
  hearWrites({ writes });
  const tasks = tasksControl({
    tasks: [INVITES, RETRIES],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    ...rest,
  });
  return drawnSidebar(sidebarProps(tasks));
}

/** The sidebar over `sections`, Launch unless said, and a way to draw it again over other sections, as a refresh does. */
async function mountSidebarRedrawn(
  writes: TaskSectionWrite[],
  sections = SECTIONS,
  rest: Partial<TasksControl> = {},
) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const draw = async (sections: TaskSections) => {
    act(() =>
      root.render(
        withQueryClient(
          createElement(
            Fragment,
            null,
            sidebarOver(sections, writes, rest),
            createElement(ToastHost),
          ),
        ),
      ),
    );
    await settle();
  };
  await draw(sections);
  return { container, draw };
}

/** The sidebar over `sections`, Launch unless said, each write it asks heard by `writes`. */
async function mountSidebar(
  writes: TaskSectionWrite[],
  sections = SECTIONS,
  rest: Partial<TasksControl> = {},
): Promise<HTMLElement> {
  return (await mountSidebarRedrawn(writes, sections, rest)).container;
}

/** The header of the section titled `title`, failing where none is drawn. */
/** The first of a button's words a reader hears: a row's or a fold's name, before its count and its chord. */
function heardName(button: Element): string {
  const heard = [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true");
  return heard?.textContent ?? "";
}

function sectionHeader(sidebar: HTMLElement, title: string): HTMLElement {
  const fold = [
    ...sidebar.querySelectorAll('nav[aria-label="Sections"] button[aria-expanded]'),
  ].find((each) => heardName(each) === title);
  const found = fold?.closest<HTMLElement>(".ui-group-header-head");
  return found ?? assert.fail(`no ${title} section`);
}

/** Opens the row named `name`'s menu, then the item listing the sections: a task's Move to, an agent's Move to section. */
function openMoveToSection(sidebar: HTMLElement, name: string, label = "Move to"): void {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes(name),
  );
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  act(() => item(label).click());
}

/** The dialog's button whose words are `label`, or else whose label is, failing where none is drawn; Lucide's Save glyph is no Save button. */
function dialogButton(label: string): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const found =
    buttons.find((button) => button.textContent === label) ??
    buttons.find((button) => button.getAttribute("aria-label") === label);
  return found ?? assert.fail(`no ${label} button`);
}

/** The names of the tasks drawn under the region labeled `label`. */
function namesIn(sidebar: HTMLElement, label: string): string[] {
  const region = sidebar.querySelector(`nav[aria-label="${label}"]`);
  return [...(region?.querySelectorAll(".ui-list-row-title") ?? [])].map(
    (name) => name.firstChild?.textContent ?? "",
  );
}

/** The menu item named `label`, failing where none is drawn. */
function item(label: string): HTMLElement {
  const name = [...document.querySelectorAll(".ui-menu-item-label")].find(
    (each) => each.textContent === label,
  );
  const found = name?.closest<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]');
  return found ?? assert.fail(`no ${label} in the menu`);
}

test("a section stands over its tasks, which Tasks leaves out", async () => {
  const sidebar = await mountSidebar([]);

  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);
  assert.deepEqual(namesIn(sidebar, "My tasks"), ["Retry audit"]);
  const header = sidebar.querySelector('nav[aria-label="Sections"] button[aria-expanded]');
  assert.equal(header === null ? undefined : heardName(header), "Launch");
});

test("the column's task rows, a section's and Tasks', are one Tab stop that ↓ walks from one group into the next, wrapping", async () => {
  const sidebar = await mountSidebar([]);
  const row = (name: string) => {
    const found = [
      ...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-tasks > li > button"),
    ].find((each) => each.querySelector(".ui-list-row-title")?.firstChild?.textContent === name);
    return found ?? assert.fail(`no row for ${name}`);
  };
  const stops = () =>
    [...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-tasks > li > button")].filter(
      (each) => each.tabIndex === 0,
    );
  const down = () =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });

  assert.equal(stops().length, 1, "Tab lands on the column's rows once");
  await act(async () => row("Invite expiry").focus());
  down();
  assert.equal(document.activeElement, row("Retry audit"), "↓ goes from Launch into Tasks");
  assert.deepEqual(stops(), [row("Retry audit")]);
  down();
  assert.equal(document.activeElement, row("Invite expiry"), "the walk wraps to the first row");
});

test("a section folds on its title, aria-expanded following, counts its tasks folded, and keeps its ⋯ outside the fold", async () => {
  const sidebar = await mountSidebar([]);
  const launch = () =>
    [
      ...sidebar.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Sections"] button[aria-expanded]',
      ),
    ].find((each) => heardName(each) === "Launch") ?? assert.fail("no Launch fold");
  assert.equal(launch().getAttribute("aria-expanded"), "true");
  assert.equal(launch().textContent, "🚀Launch");
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);

  await act(async () => launch().click());
  assert.equal(launch().getAttribute("aria-expanded"), "false");
  assert.equal(launch().textContent, "🚀Launch1 task");
  assert.deepEqual(namesIn(sidebar, "Sections"), []);

  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Launch actions"]');
  await act(async () => actions?.click());
  assert.equal(launch().getAttribute("aria-expanded"), "false", "the ⋯ folds nothing");

  await act(async () => launch().click());
  assert.equal(launch().getAttribute("aria-expanded"), "true");
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);
});

test("a filter by person leaves out a section's task it would leave out of the list", async () => {
  const shared = { ...WORKSPACE, memberCount: 2 };
  window.localStorage.setItem(
    "app.sidebarTaskViews",
    JSON.stringify({
      [WORKSPACE.id]: { grouping: "repository", order: "updated", assignedTo: "user-ada" },
    }),
  );
  const sidebar = await mountSidebar([], SECTIONS, {
    workspace: shared,
    workspaces: [shared],
    me: "user-ada",
    tasks: [
      { ...INVITES, assignee: { userId: "user-grace", name: "Grace Hopper" } },
      { ...RETRIES, assignee: { userId: "user-ada", name: "Ada Lovelace" } },
    ],
  });

  assert.deepEqual(namesIn(sidebar, "Sections"), []);
  assert.deepEqual(namesIn(sidebar, "My tasks"), ["Retry audit"]);
});

test("the status filter leaves a section's backlog task out as it does the list's", async () => {
  const sidebar = await mountSidebar([], SECTIONS, {
    tasks: [
      { ...INVITES, status: TASK_STATUS.BACKLOG },
      { ...RETRIES, status: TASK_STATUS.TODO },
    ],
  });

  assert.deepEqual(namesIn(sidebar, "Sections"), []);
  assert.deepEqual(namesIn(sidebar, "My tasks"), ["Retry audit"]);
});

test("a section whose only task is done still says Drag tasks here", async () => {
  const sidebar = await mountSidebar([], SECTIONS, {
    tasks: [
      { ...INVITES, status: TASK_STATUS.DONE },
      { ...RETRIES, status: TASK_STATUS.DONE },
    ],
  });

  assert.ok(
    sidebar.querySelector('nav[aria-label="Sections"]')?.textContent?.includes("Drag tasks here"),
  );
});

test("a task's Move to puts it on top of the section chosen", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes("Retry audit"),
  );
  assert.ok(row);

  await act(async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  await act(async () => item("Move to").click());
  await act(async () => item("Launch").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: RETRIES.id, sectionId: LAUNCH },
  ]);
});

/** Launch holding both tasks, Invite expiry on top, and Someday holding none. */
const BOTH_IN_LAUNCH: TaskSections = {
  sections: ICONLESS.sections,
  entries: [
    { taskId: INVITES.id, sectionId: LAUNCH, addedAt: 3 },
    { taskId: RETRIES.id, sectionId: LAUNCH, addedAt: 2 },
  ],
  agentEntries: [],
};

/** Opens the section titled `title`'s menu from its ⋯. */
function openSectionMenu(sidebar: HTMLElement, title: string): void {
  const actions = sidebar.querySelector<HTMLButtonElement>(`[aria-label="${title} actions"]`);
  assert.ok(actions);
  act(() => actions.click());
}

/** The words of every item the open menus draw, in order. */
function menuLabels(): string[] {
  return [...document.querySelectorAll(".ui-menu-item-label")].map(
    (each) => each.textContent ?? "",
  );
}

/** Opens the menu of the task row named `name` with a right-click. */
function openRowMenu(sidebar: HTMLElement, name: string): void {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes(name),
  );
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
}

/** The sections' titles, in the order the sidebar draws them. */
function sectionTitles(sidebar: HTMLElement): string[] {
  const heads = sidebar.querySelectorAll('nav[aria-label="Sections"] .ui-group-header-head');
  return [...heads].map((head) => heardName(head.querySelector("button[aria-expanded]") ?? head));
}

/** `state` once the service has taken every write of `writes`, in order. */
function applied(state: TaskSections, writes: readonly TaskSectionWrite[]): TaskSections {
  return writes.reduce((was, write) => applySectionWrite(was, write, 30), state);
}

test("deleting a section removes it at once with no dialog, and Undo brings it back where it stood with its tasks", async () => {
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes, BOTH_IN_LAUNCH);
  const stood = sectionTitles(sidebar);
  openSectionMenu(sidebar, "Launch");

  await act(async () => item("Delete section").click());
  const deleted = applied(BOTH_IN_LAUNCH, writes.splice(0));
  await draw(deleted);

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing is asked");
  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
  assert.deepEqual(namesIn(sidebar, "My tasks"), ["Invite expiry", "Retry audit"]);
  assert.match(newestToastSays() ?? "", /Section deleted/u);

  // Note that the Undo runs through the undo stack, after every run before it, so it lands a turn later.
  await act(async () => newestToastAction()?.click());
  await draw(applied(deleted, writes));

  assert.deepEqual(stood, ["Someday", "Launch"]);
  assert.deepEqual(sectionTitles(sidebar), stood);
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry", "Retry audit"]);
  assert.deepEqual(namesIn(sidebar, "My tasks"), []);
  const icon = sectionHeader(sidebar, "Launch").querySelector(".ui-group-header-icon");
  assert.equal(icon?.textContent, "🚀");
});

test("a deleted section slides out where it stood, out of reach, and leaves once its exit has played; the one that stays is not held", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes, ICONLESS);
  openSectionMenu(sidebar, "Launch");

  await act(async () => item("Delete section").click());
  await draw(applied(ICONLESS, writes.splice(0)));

  const leaving = sidebar.querySelector<HTMLElement>("li[data-leaving]");
  assert.match(leaving?.textContent ?? "", /Launch/u, "it is drawn on");
  assert.equal(leaving?.hasAttribute("inert"), true, "out of reach while it goes");
  const out = motions.played.find((each) => each.element === leaving);

  await act(async () => out?.finish());
  assert.equal(sidebar.querySelector("[data-leaving]"), null);
  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
});

test("the last section deleted slides out too, and takes its group with it once its exit has played", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes);
  openSectionMenu(sidebar, "Launch");

  await act(async () => item("Delete section").click());
  await draw(applied(SECTIONS, writes.splice(0)));

  const leaving = sidebar.querySelector<HTMLElement>('nav[aria-label="Sections"] li[data-leaving]');
  assert.match(leaving?.textContent ?? "", /Launch/u, "it is drawn on");

  await act(async () => motions.played.find((each) => each.element === leaving)?.finish());
  assert.equal(sidebar.querySelector('nav[aria-label="Sections"]'), null);
});

test("deleting the last section hands focus to the first, rather than letting it fall to the window", async () => {
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes, BOTH_IN_LAUNCH);
  openSectionMenu(sidebar, "Launch");

  await act(async () => item("Delete section").click());
  await draw(applied(BOTH_IN_LAUNCH, writes.splice(0)));

  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
  assert.ok(sectionHeader(sidebar, "Someday").contains(document.activeElement));
});

test("a section holding tasks offers Rename, Change icon, its move, and Delete last, leaving what acts on all its tasks to the selection bar", async () => {
  const sidebar = await mountSidebar([], ICONLESS);

  openSectionMenu(sidebar, "Launch");

  assert.deepEqual(menuLabels(), ["Rename", "Change icon", "Move up", "Delete section"]);
});

test("a section holding no task offers only Rename, Add icon where it wears none, its move, and Delete", async () => {
  const sidebar = await mountSidebar([], {
    sections: ICONLESS.sections,
    entries: ICONLESS.entries.filter((entry) => entry.sectionId !== SOMEDAY),
    agentEntries: [],
  });

  openSectionMenu(sidebar, "Someday");

  assert.deepEqual(menuLabels(), ["Rename", "Add icon", "Move down", "Delete section"]);
});

test("⌘-clicking a section's task and one under Tasks chooses both, opening neither, and a right-click on either offers Status for both, which S on the focused one opens", async () => {
  const settled: [string, string | undefined][] = [];
  const opened: string[] = [];
  const sidebar = await mountSidebar([], SECTIONS, {
    onResume: (taskId) => opened.push(taskId),
  });
  // Each task's status leaves on the act port, which the service keeps.
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_SET_STANDING]: ({ taskId, status }) => {
      settled.push([taskId, status]);
      return Promise.resolve(true);
    },
  });
  const rowOf = (name: string) =>
    [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find((each) =>
      each.textContent?.includes(name),
    ) ?? assert.fail(`no ${name} row`);
  for (const name of [INVITES.name, RETRIES.name]) {
    act(() => {
      rowOf(name).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
      );
    });
  }
  assert.deepEqual(opened, []);
  assert.equal(rowOf(RETRIES.name).getAttribute("aria-description"), "Selected");

  openRowMenu(sidebar, RETRIES.name);
  assert.equal(document.querySelector(".ui-menu-heading")?.textContent, "2 tasks");
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });

  await act(async () => rowOf(RETRIES.name).focus());
  await act(async () => {
    assert.ok(runAppCommand(APP_COMMAND.SET_STATUS), "the focused row answers S");
  });
  await act(async () => undefined);
  assert.equal(document.querySelector(".ui-menu-heading")?.textContent, "2 tasks");
  assert.ok(document.querySelector('[role="menu"][aria-label="Status"]'), "S opens Status");
  await act(async () => item("Done").click());
  assert.deepEqual(settled, [
    [INVITES.id, TASK_STATUS.DONE],
    [RETRIES.id, TASK_STATUS.DONE],
  ]);
});

test("in a browser, a middle-click on a place or a task opens its address in a tab of its own, its menu offers Open in new tab under Copy link, and a ⌘-click still chooses it", async () => {
  const tabbed: string[] = [];
  const opened: string[] = [];
  onTestFinished(
    fakeAppPlatform({ ...QUIET_PANEL, openInTab: (link: string) => tabbed.push(link) }),
  );
  const sidebar = await mountSidebar([], SECTIONS, { onResume: (taskId) => opened.push(taskId) });
  const press = (button: HTMLElement, init: MouseEventInit) =>
    act(() => {
      button.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...init }),
      );
      button.dispatchEvent(
        new MouseEvent(init.button === 1 ? "auxclick" : "click", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  const inbox =
    [...sidebar.querySelectorAll<HTMLElement>("button")].find(
      (each) => heardName(each) === "Inbox",
    ) ?? assert.fail("no Inbox row");
  const retries =
    [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find((each) =>
      each.textContent?.includes(RETRIES.name),
    ) ?? assert.fail(`no ${RETRIES.name} row`);

  press(inbox, { button: 1 });
  press(retries, { button: 1 });
  assert.deepEqual(tabbed, [
    "https://vespin.dev/workspace-personal/inbox",
    "https://vespin.dev/workspace-personal/task/0a1b2c3d-0000-4000-8000-100000000002",
  ]);
  assert.deepEqual(opened, [], "a middle-click opens nothing in this tab");

  press(retries, { button: 0, metaKey: true });
  assert.equal(retries.getAttribute("aria-description"), "Selected");
  assert.equal(tabbed.length, 2, "a ⌘-click opens no tab");
  assert.deepEqual(opened, []);

  openRowMenu(sidebar, INVITES.name);
  const labels = menuLabels();
  assert.equal(labels[labels.indexOf("Copy link") + 1], "Open in new tab");
});

test("a plain click on any row, with tasks chosen and no bar to let them go, opens it and chooses none", async () => {
  const opened: string[] = [];
  const sidebar = await mountSidebar([], SECTIONS, { onResume: (taskId) => opened.push(taskId) });
  const rowOf = (name: string) =>
    [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find((each) =>
      each.textContent?.includes(name),
    ) ?? assert.fail(`no ${name} row`);
  const click = (name: string, keys: MouseEventInit = {}) =>
    act(() => {
      rowOf(name).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ...keys }),
      );
    });
  const chooseBoth = () => {
    click(INVITES.name, { metaKey: true });
    click(RETRIES.name, { metaKey: true });
    assert.equal(rowOf(INVITES.name).getAttribute("aria-description"), "Selected");
    assert.equal(rowOf(RETRIES.name).getAttribute("aria-description"), "Selected");
  };
  const noneChosen = () =>
    assert.ok(!sidebar.querySelector('[aria-description="Selected"]'), "no row is still chosen");
  chooseBoth();
  click(INVITES.name);
  assert.deepEqual(opened, [INVITES.id]);
  noneChosen();

  // A place, a row that cannot be chosen, lets them go too.
  chooseBoth();
  const home =
    [...sidebar.querySelectorAll<HTMLElement>("button")].find((each) =>
      each.textContent?.trim().startsWith("Home"),
    ) ?? assert.fail("no Home row");
  await act(async () => home.click());
  noneChosen();
});

test("a section's Mark all as read stands while a task in it is unread, and asks the service to mark every unread one read", async () => {
  const marks: string[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_MARK_READ]: ({ taskId, readMark }) => {
      marks.push(`${readMark}:${taskId}`);
      return Promise.resolve(true);
    },
  });
  const read = await mountSidebar([], BOTH_IN_LAUNCH, {
    tasks: [INVITES, RETRIES].map((each) => ({ ...each, readThrough: each.updatedAt })),
  });
  openSectionMenu(read, "Launch");
  assert.ok(!menuLabels().includes("Mark all as read"));
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  read.remove();

  const sidebar = await mountSidebar([], BOTH_IN_LAUNCH, {
    tasks: [
      { ...INVITES, readThrough: INVITES.updatedAt - 1 },
      { ...RETRIES, readThrough: RETRIES.updatedAt },
    ],
  });
  openSectionMenu(sidebar, "Launch");
  await act(async () => item("Mark all as read").click());
  await settle();

  assert.deepEqual(marks, [`read:${INVITES.id}`]);
});

test("a section without an icon draws its title behind the fold's chevron alone, and one with an icon behind its icon", async () => {
  const sidebar = await mountSidebar([], ICONLESS);

  const toggle = sectionHeader(sidebar, "Someday").querySelector("button[aria-expanded]");
  assert.ok(toggle?.querySelector(".ui-group-header-icon") === null, "no glyph is drawn");
  assert.ok(toggle?.querySelector(".ui-group-header-chevron"), "the chevron stands at rest");
  const launch = sectionHeader(sidebar, "Launch").querySelector(".ui-group-header-icon");
  assert.equal(launch?.textContent, "🚀");
});

test("Move to section names a section without an icon with no glyph beside it", async () => {
  const sidebar = await mountSidebar([], ICONLESS);

  openMoveToSection(sidebar, "Invite expiry");

  assert.equal(item("Launch").querySelector(".ui-menu-item-glyph")?.textContent, "🚀");
});

test("two sections titled alike are two items in Move to section, on one task's menu and on a chosen pair's", async () => {
  const twin = {
    id: "0a1b2c3d-0000-4000-8000-000000000005",
    workspaceId: WORKSPACE.id,
    title: "Launch",
    createdAt: 4,
  };
  const sidebar = await mountSidebar([], { ...SECTIONS, sections: [...SECTIONS.sections, twin] });

  openMoveToSection(sidebar, RETRIES.name);
  assert.deepEqual(
    menuLabels().filter((label) => label === "Launch"),
    ["Launch", "Launch"],
  );

  for (const name of [INVITES.name, RETRIES.name]) {
    const row =
      [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find((each) =>
        each.textContent?.includes(name),
      ) ?? assert.fail(`no ${name} row`);
    act(() => {
      row.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
      );
    });
  }
  openRowMenu(sidebar, RETRIES.name);
  assert.equal(document.querySelector(".ui-menu-heading")?.textContent, "2 tasks");
  await act(async () => item("Move to section").click());
  assert.deepEqual(
    menuLabels().filter((label) => label === "Launch"),
    ["Launch", "Launch"],
  );
});

/** The Tasks head's New section, which names a section in place. */
function newSectionButton(sidebar: HTMLElement): HTMLButtonElement {
  return (
    sidebar.querySelector<HTMLButtonElement>(
      '.sidebar-tasks-head button[aria-label="New section"]',
    ) ?? assert.fail("no New section on the Tasks head")
  );
}

/** Presses the Tasks head's New section, which names a section in place. */
function newSectionInPlace(sidebar: HTMLElement): HTMLInputElement {
  act(() => newSectionButton(sidebar).click());
  return sectionNameField();
}

/** The name field of the section being named in place, failing where none stands. */
function sectionNameField(): HTMLInputElement {
  return (
    document.querySelector<HTMLInputElement>(
      'nav[aria-label="Sections"] input[aria-label="Section name"]',
    ) ?? assert.fail("no section is named in place")
  );
}

/** Presses `key` in `field`. */
async function press(field: HTMLElement, key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

/** Opens the menu of the section titled `title`, then chooses `label` on it. */
function sectionMenuChoose(sidebar: HTMLElement, title: string, label: string): void {
  const actions =
    sidebar.querySelector<HTMLButtonElement>(`[aria-label="${title} actions"]`) ??
    assert.fail(`no ${title} actions`);
  act(() => actions.click());
  act(() => item(label).click());
}

/** Opens New section from Retry audit's Move to section, then its icon well's picker. */
async function dialogPicker(sidebar: HTMLElement): Promise<void> {
  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section").click());
  act(() => dialogButton("Add icon").click());
  await settleLoaded();
}

test("Move to section's New section asks in a card that says the task moves into it, and makes the section with no icon unless one is chosen", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  await act(async () => item("New section").click());
  const card = document.querySelector('[role="dialog"]') ?? assert.fail("no card");
  assert.ok(card.textContent?.includes("“Retry audit” moves into it"));
  assert.ok(dialogButton("Add icon"), "the icon well says no icon is chosen");
  typeInto(dialogField("Name"), "Someday");
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.equal(made.title, "Someday");
  assert.equal("icon" in made, false);
});

test("New section waits on a name, and Enter in it makes the section", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  await act(async () => item("New section").click());
  assert.equal(dialogButton("Create section").disabled, true, "a blank name is not offered");
  const name = dialogField("Name");
  assert.ok(name.closest('[role="dialog"]'), "a form is a dialog, not an alert");
  typeInto(name, "S");
  assert.equal(dialogButton("Create section").disabled, false);
  await press(name, "Enter");

  assert.equal(writes[0]?.kind, TASK_SECTION_WRITE.CREATE);
  assert.equal(writes[0]?.kind === TASK_SECTION_WRITE.CREATE && writes[0].title, "S");
});

test("New section's field is labeled, and Enter on a blank name marks it invalid with the reason on it", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  await act(async () => item("New section").click());
  const name = dialogField("Name");
  assert.equal(name.getAttribute("aria-label"), null, "the visible label names the field");
  assert.notEqual(name.placeholder, "Name", "the placeholder is not the label again");
  assert.equal(name.getAttribute("aria-invalid"), null);

  await press(name, "Enter");
  const error = document.querySelector('[role="dialog"] [data-slot="field-error"]');
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.equal(error?.textContent, "Name the section.");
  assert.ok(
    name
      .getAttribute("aria-describedby")
      ?.split(" ")
      .includes(error?.id ?? "missing"),
  );
  assert.deepEqual(writes, [], "no section is made from a blank name");
});

test("New section on the Tasks head names a section in place, with no dialog, and Return makes it", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  const name = newSectionInPlace(sidebar);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, name);
  typeInto(name, "Someday");
  await press(name, "Enter");

  assert.equal(writes.length, 1);
  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.equal(made.title, "Someday");
  assert.equal(made.workspaceId, WORKSPACE.id);
  assert.equal("icon" in made, false);
  assert.equal(document.querySelector('input[aria-label="Section name"]'), null);
});

test("Escape on a section named in place makes nothing and hands the focus back to New section", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  const name = newSectionInPlace(sidebar);
  typeInto(name, "Someday");
  await press(name, "Escape");

  assert.deepEqual(writes, []);
  assert.equal(document.querySelector('input[aria-label="Section name"]'), null);
  assert.equal(document.activeElement, newSectionButton(sidebar));
});

test("Rename names a section in place, and Return keeps the new name with the icon it wears", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  sectionMenuChoose(sidebar, "Launch", "Rename");
  const name = sectionNameField();
  assert.equal(name.value, "Launch");
  typeInto(name, "Launch week");
  await press(name, "Enter");

  assert.deepEqual(writes, [
    {
      kind: TASK_SECTION_WRITE.EDIT,
      id: LAUNCH,
      title: "Launch week",
      icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" },
    },
  ]);
});

test("Remove icon in the picker clears a section's icon", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  sectionMenuChoose(sidebar, "Launch", "Rename");
  await act(async () => dialogButton("Change icon").click());
  await settleLoaded();
  assert.equal(
    document.querySelector('button[aria-label="rocket"]')?.getAttribute("aria-pressed"),
    "true",
  );
  await act(async () => dialogButton("Remove icon").click());
  await settleLoaded();
  await press(sectionNameField(), "Enter");

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.EDIT, id: LAUNCH, title: "Launch", icon: null },
  ]);
});

/** Each row's height as laid out here, in CSS pixels. */
const ROW_HEIGHT = 30;

/** What a drag in the sidebar asked: each pin or unpin, each pin's new place, and each write to the sections. */
interface Asked {
  marks: [string, TaskMark][];
  moves: PinMove[];
  writes: TaskSectionWrite[];
}

/**
 * Lays the sidebar out down one column, as jsdom does not: each row, and
 * each empty section's word, a row's height below the one before, and
 * everything holding some of them over exactly those, so each drop zone
 * stands over its own rows and no other's.
 */
function layOutRows(): void {
  const slots = () => [
    ...document.querySelectorAll(".sidebar-tasks > li, .sidebar-section-slot, .ui-drop-slot"),
  ];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const all = slots();
    const own = all.indexOf(this);
    const held = own >= 0 ? [own] : all.flatMap((slot, at) => (this.contains(slot) ? [at] : []));
    const first = held[0];
    const last = held.at(-1);
    if (first === undefined || last === undefined) return DOMRect.fromRect();
    return DOMRect.fromRect({
      y: first * ROW_HEIGHT,
      width: 200,
      height: (last - first + 1) * ROW_HEIGHT,
    });
  });
  // jsdom captures no pointer; a drag asks its list to, as the window's would.
  for (const list of document.querySelectorAll(".sidebar-tasks")) {
    Object.assign(list, { setPointerCapture: () => undefined });
  }
}

/** The sidebar listing `plans` over `sections`, laid out down one column, what a drag asks heard by `asked`. */
async function mountDraggable(
  summaries: readonly TaskSummary[],
  sections: TaskSections,
  asked: Asked,
  rest: Partial<TasksControl> = {},
): Promise<HTMLElement> {
  writeListedTasks({ taskSections: sections });
  hearWrites(asked);
  const tasks = tasksControl({
    tasks: [...summaries],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    ...rest,
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
  await settle();
  layOutRows();
  return container;
}

const pointer = (type: string, y: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, clientY: y, pointerId: 1 });

/** Presses the row named `name` at its middle and carries it a little way toward `y`, past where a press is a drag. */
function lift(sidebar: HTMLElement, name: string, y: number): void {
  // Note that a row's name is its title's first words, before what only a screen reader hears of it.
  const label = [...sidebar.querySelectorAll<HTMLElement>(".ui-list-row-title")].find(
    (each) => each.firstChild?.textContent === name,
  );
  const row = label?.closest("li") ?? assert.fail(`no ${name} in the sidebar`);
  const top = row.getBoundingClientRect().top + ROW_HEIGHT / 2;
  act(() => {
    label?.dispatchEvent(pointer("pointerdown", top));
    window.dispatchEvent(pointer("pointermove", top + (y > top ? 10 : -10)));
  });
}

/** Carries the row lifted to `y` down the column and lets it go there. */
function letGo(y: number): void {
  act(() => {
    window.dispatchEvent(pointer("pointermove", y));
    window.dispatchEvent(pointer("pointerup", y));
  });
}

/** Drags the row named `name` from its middle to `y` down the column and lets it go there. */
function drag(sidebar: HTMLElement, name: string, y: number): void {
  lift(sidebar, name, y);
  letGo(y);
}

/** The sidebar's Pinned, where it stands. */
function pinnedGroup(sidebar: HTMLElement): HTMLElement | null {
  return sidebar.querySelector<HTMLElement>('nav[aria-label="Pinned"]');
}

/** A moment after every stamp the fixtures carry, at which a drag's writes are taken. */
const AFTER_FIXTURES = 10;

const noneAsked = (): Asked => ({ marks: [], moves: [], writes: [] });

/** A task pinned at the first place a drag gives. */
const PINNED = {
  ...task("0a1b2c3d-0000-4000-8000-100000000003", "Pin audit"),
  pinnedAt: 5,
  pinPosition: "a0",
};

test("Pinned's ⋯ stands while a pinned task is unread, and its Mark all as read asks the service to mark it read", async () => {
  const marks: string[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_MARK_READ]: ({ taskId, readMark }) => {
      marks.push(`${readMark}:${taskId}`);
      return Promise.resolve(true);
    },
  });
  const read = await mountSidebar([], SECTIONS, {
    tasks: [{ ...PINNED, readThrough: PINNED.updatedAt }],
  });
  assert.equal(read.querySelector('[aria-label="Pinned actions"]'), null);
  read.remove();

  const sidebar = await mountSidebar([], SECTIONS, {
    tasks: [{ ...PINNED, readThrough: PINNED.updatedAt - 1 }],
  });
  openSectionMenu(sidebar, "Pinned");
  await act(async () => item("Mark all as read").click());
  await settle();

  assert.deepEqual(marks, [`read:${PINNED.id}`]);
});

test("a task row in Pinned and in a section shows when its agents last did something, as a row in Tasks does", async () => {
  const active = { agents: { total: 1, working: 0, activityAt: 9_000, pullRequestTotal: 0 } };
  const sidebar = await mountSidebar([], SECTIONS, {
    tasks: [
      { ...PINNED, ...active },
      { ...INVITES, ...active },
    ],
  });
  const shown = (name: string) =>
    rowPress(sidebar, name).querySelector("time")?.getAttribute("dateTime");

  assert.equal(shown("Pin audit"), new Date(9_000).toISOString());
  assert.equal(shown("Invite expiry"), new Date(9_000).toISOString());
});

test("a task dragged from Tasks into Pinned is pinned below the pin it was let go under", async () => {
  const asked = noneAsked();
  // Down the column: Pin audit under Pinned, Invite expiry under Launch, Retry audit under Tasks.
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Retry audit", ROW_HEIGHT - 4);
  await settle();

  assert.deepEqual(asked.marks, [[RETRIES.id, TASK_MARK.PIN]]);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [RETRIES.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > PINNED.pinPosition, "it sorts after Pin audit");
  assert.deepEqual(asked.writes, []);
});

test("a task dragged from a section onto the top of Pinned leaves the section and is pinned on top", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Invite expiry", 4);
  await settle();

  assert.deepEqual(asked.marks, [[INVITES.id, TASK_MARK.PIN]]);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [INVITES.id],
  );
  assert.ok((asked.moves[0]?.position ?? "~") < PINNED.pinPosition, "it sorts before Pin audit");
  assert.deepEqual(asked.writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES.id, sectionId: null },
  ]);
});

test("a pinned task dragged onto Tasks is unpinned and leaves the section it was kept in", async () => {
  const asked = noneAsked();
  const kept: TaskSections = {
    ...SECTIONS,
    entries: [...SECTIONS.entries, { taskId: PINNED.id, sectionId: LAUNCH, addedAt: 3 }],
  };
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], kept, asked);

  drag(sidebar, "Pin audit", 3 * ROW_HEIGHT - 4);
  await settle();

  assert.deepEqual(asked.marks, [[PINNED.id, TASK_MARK.UNPIN]]);
  assert.deepEqual(asked.writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: PINNED.id, sectionId: null },
  ]);
});

test("a pinned task dragged into a section is unpinned and lands where it was let go", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Pin audit", 2 * ROW_HEIGHT - 4);
  await settle();

  assert.deepEqual(asked.marks, [[PINNED.id, TASK_MARK.UNPIN]]);
  const after = asked.writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    SECTIONS,
  );
  assert.deepEqual(sectionTaskIds(after, LAUNCH), [INVITES.id, PINNED.id]);
});

test("with nothing pinned Pinned stands nowhere, and a row lifted into a drag draws it, empty, to take the first pin", async () => {
  const asked = noneAsked();
  // Down the column: Invite expiry under Launch, Retry audit under Tasks; once a row is lifted, Pinned's slot above them.
  const sidebar = await mountDraggable([INVITES, RETRIES], SECTIONS, asked);
  assert.equal(pinnedGroup(sidebar), null, "no Pinned while nothing is pinned");

  lift(sidebar, "Retry audit", 0);

  const zone = pinnedGroup(sidebar) ?? assert.fail("Pinned stands while a row is carried");
  assert.ok(zone.querySelector(".ui-drop-slot"), "a slot to let it go in");
  assert.equal(zone.querySelector("[aria-expanded]"), null, "nothing to fold");
  assert.equal(zone.textContent, "Pinned", "no count, and no words beyond its name");

  letGo(4);
  await settle();

  assert.deepEqual(asked.marks, [[RETRIES.id, TASK_MARK.PIN]]);
});

test("a drag put back with nothing pinned takes the empty Pinned away again", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([INVITES, RETRIES], SECTIONS, asked);

  lift(sidebar, "Retry audit", 0);
  assert.ok(pinnedGroup(sidebar), "Pinned stands while a row is carried");
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();

  assert.equal(pinnedGroup(sidebar), null);
  assert.deepEqual(asked.marks, []);
});

test("Pinned stands once a pin exists, folding and counting it, and once the last is unpinned slides out before it goes", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const draw = async (summaries: readonly TaskSummary[]) => {
    const tasks = tasksControl({
      tasks: [...summaries],
      workspaces: [WORKSPACE],
      workspace: WORKSPACE,
    });
    writeListedTasks({ taskSections: SECTIONS });
    act(() => root.render(withQueryClient(drawnSidebar(sidebarProps(tasks)))));
    await settle();
  };
  await draw([PINNED, INVITES, RETRIES]);

  const fold = pinnedGroup(container)?.querySelector("button[aria-expanded]");
  assert.equal(fold?.getAttribute("aria-expanded"), "true", "it folds");
  await act(async () => fold?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  assert.match(pinnedGroup(container)?.textContent ?? "", /1 pin/u, "folded, it counts its pin");

  await draw([task(PINNED.id, PINNED.name), INVITES, RETRIES]);

  const leaving = pinnedGroup(container);
  assert.equal(leaving?.hasAttribute("data-leaving"), true, "it is drawn on while it goes");
  const out = motions.played.find((each) => each.element === leaving);
  assert.equal(out?.keyframes.at(-1)?.opacity, 0, "it fades out");
  await act(async () => out?.finish());
  assert.equal(pinnedGroup(container), null);
});

test("a pin dragged below the next one reorders the pins", async () => {
  const asked = noneAsked();
  const second = {
    ...task("0a1b2c3d-0000-4000-8000-100000000004", "Pin review"),
    pinnedAt: 4,
    pinPosition: "a1",
  };
  // Down the column: Pin audit and Pin review under Pinned, then the section and Tasks.
  const sidebar = await mountDraggable([PINNED, second, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Pin audit", 2 * ROW_HEIGHT - 4);
  await settle();

  assert.deepEqual(asked.marks, []);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [PINNED.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > second.pinPosition, "it sorts after Pin review");
});

test("a glyph found by searching asks its color over the grid, the text's own named as the dark window draws it, and the color pressed there makes it the new section's and this Mac's most recent", async () => {
  document.documentElement.setAttribute("data-ui-theme", "dark");
  onTestFinished(() => document.documentElement.removeAttribute("data-ui-theme"));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  await dialogPicker(sidebar);
  typeInto(dialogField("Search icons and emoji"), "telescope");
  await settleLoaded();
  await act(async () => dialogButton("Telescope").click());
  const colors =
    document.querySelector(".section-icon-colors") ?? assert.fail("the glyph's colors are asked");
  assert.equal(document.activeElement, colors.querySelector('[aria-label="White"]'));
  await act(async () => dialogButton("Teal").click());
  assert.equal(
    document.querySelector('input[aria-label="Search icons and emoji"]'),
    null,
    "a color chosen puts the picker away",
  );
  typeInto(dialogField("Name"), "Stars");
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.deepEqual(made.icon, {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: "telescope",
    color: TASK_SECTION_ICON_COLOR.TEAL,
  });
  assert.deepEqual(JSON.parse(window.localStorage.getItem(RECENT_ICONS) ?? "[]")[0], {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: "telescope",
    color: TASK_SECTION_ICON_COLOR.TEAL,
  });
});

test("Change icon opens a section's head with its picker open, where the glyph it wears, pressed, asks its color again from the one it wears", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, GLYPHS);

  sectionMenuChoose(sidebar, "Stars", "Change icon");
  await settleLoaded();
  const telescope = dialogButton("Telescope");
  assert.equal(telescope.getAttribute("aria-pressed"), "true");
  await act(async () => telescope.click());
  assert.equal(dialogButton("Teal").getAttribute("aria-pressed"), "true");
  await act(async () => dialogButton("Black").click());
  await press(sectionNameField(), "Enter");

  assert.deepEqual(writes, [
    {
      kind: TASK_SECTION_WRITE.EDIT,
      id: STARS,
      title: "Stars",
      icon: { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "telescope" },
    },
  ]);
});

test("a section wearing a glyph no Lucide knows still leaves the grid one tab stop", async () => {
  const sidebar = await mountSidebar([], GLYPHS);

  sectionMenuChoose(sidebar, "Lost", "Rename");
  await act(async () => dialogButton("Change icon").click());
  await settleLoaded();

  const panel = document.querySelector('[role="tabpanel"]') ?? assert.fail("no picker panel");
  assert.equal(panel.querySelectorAll('button:not([tabindex="-1"])').length, 1);
});

test("Enter in the search chooses the first thing it found, an emoji where no glyph matches", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  await dialogPicker(sidebar);
  const search = dialogField("Search icons and emoji");
  typeInto(search, "pickup truck");
  await settleLoaded();
  await press(search, "Enter");
  typeInto(dialogField("Name"), "Errands");
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.deepEqual(made.icon, { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🛻" });
});

test("Icons and Emoji are tabs over the picker's panel, which the tab shown names, and Remove icon stands only while there is an icon", async () => {
  const sidebar = await mountSidebar([]);

  await dialogPicker(sidebar);
  const kinds =
    document.querySelector<HTMLElement>('[role="tablist"][aria-label="Icon kind"]') ??
    assert.fail("the icon kinds are tabs");
  const tab = (label: string) =>
    [...kinds.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`no ${label} tab`);
  const shown = (label: string) => {
    const panel =
      document.getElementById(tab(label).getAttribute("aria-controls") ?? "") ??
      assert.fail(`${label} controls no panel`);
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab(label).id);
    return panel;
  };
  assert.equal(tab("Icons").getAttribute("aria-selected"), "true");
  assert.ok(shown("Icons").querySelector('button[aria-label="Folder"]'));
  assert.equal(
    [...document.querySelectorAll("button")].some((each) => each.textContent === "Remove icon"),
    false,
  );

  await act(async () => tab("Emoji").click());
  await settleLoaded();

  assert.equal(tab("Emoji").getAttribute("aria-selected"), "true");
  assert.ok(shown("Emoji").querySelector('button[aria-label="grinning face"]'));
});

test("Shift-Enter in the search presses the first glyph it found, as Enter does, the keyboard taken to its colors, walked by the arrows, and Escape there goes back to the glyph", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  await dialogPicker(sidebar);
  const search = dialogField("Search icons and emoji");
  typeInto(search, "telescope");
  await settleLoaded();
  await press(search, "Enter", true);
  const noColor = document.activeElement ?? assert.fail("nothing has the focus");
  assert.equal(noColor.getAttribute("aria-label"), "Black");
  await press(noColor as HTMLElement, "ArrowRight");
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Red");
  await press(document.activeElement as HTMLElement, "Escape");
  assert.equal(document.querySelector(".section-icon-colors"), null);
  assert.ok(dialogField("Search icons and emoji"), "Escape leaves the picker standing");
  await act(async () => dialogButton("Telescope").click());
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  typeInto(dialogField("Name"), "Stars");
  await act(async () => dialogButton("Create section").click());

  assert.deepEqual(writes[0]?.kind === TASK_SECTION_WRITE.CREATE ? writes[0].icon : undefined, {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: "telescope",
  });
});

test("Clear search empties the search, every glyph is offered again, and the caret stays in the search", async () => {
  const sidebar = await mountSidebar([]);

  await dialogPicker(sidebar);
  const search = dialogField("Search icons and emoji");
  typeInto(search, "telescope");
  await settleLoaded();
  assert.equal(document.querySelector('button[aria-label="Folder"]'), null);
  await act(async () => dialogButton("Clear search").click());

  assert.equal(search.value, "");
  assert.ok(dialogButton("Folder"));
  assert.equal(document.activeElement, search);
});

test("ArrowDown in the search hands the focus to the grid's tab stop", async () => {
  const sidebar = await mountSidebar([]);

  await dialogPicker(sidebar);
  const search = dialogField("Search icons and emoji");
  typeInto(search, "telescope");
  await settleLoaded();
  await press(search, "ArrowDown");

  assert.equal(document.activeElement?.getAttribute("aria-label"), "Telescope");
});

test("the arrows move the grid's one tab stop with the focus", async () => {
  const sidebar = await mountSidebar([]);

  await dialogPicker(sidebar);
  const folder = dialogButton("Folder");
  await act(async () => folder.focus());
  await act(async () => {
    folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });

  assert.equal(document.activeElement?.getAttribute("aria-label"), "Star");
  assert.equal(dialogButton("Star").getAttribute("tabindex"), "0");
  assert.equal(folder.getAttribute("tabindex"), "-1");
});

test("with a glyph's colors open, the arrows step the glyphs past them, and another glyph pressed takes the keyboard to its own colors", async () => {
  const sidebar = await mountSidebar([]);

  await dialogPicker(sidebar);
  await act(async () => dialogButton("Folder").click());
  const layers = dialogButton("Layers");
  await act(async () => layers.focus());
  await press(layers, "ArrowRight");
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Heart");

  await act(async () => dialogButton("Star").click());
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Black");
  assert.equal(document.querySelectorAll(".section-icon-colors").length, 1);
});

test("a glyph pressed again while its colors stand open closes them, its press taking the focus first as a pointer's does", async () => {
  const sidebar = await mountSidebar([]);

  await dialogPicker(sidebar);
  const folder = dialogButton("Folder");
  await act(async () => folder.click());
  assert.ok(document.querySelector(".section-icon-colors"), "the colors are asked");
  await act(async () => folder.focus());
  await act(async () => folder.click());

  assert.equal(document.querySelector(".section-icon-colors"), null);
});

test("an emoji typed into the search is offered first, one the grid leaves out included", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  await dialogPicker(sidebar);
  const search = dialogField("Search icons and emoji");
  typeInto(search, "🫩");
  await settleLoaded();
  await press(search, "Enter");
  typeInto(dialogField("Name"), "Tired");
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.deepEqual(made.icon, { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🫩" });
});

test("a glyph this Mac chose last is offered first under Recent in the color it was chosen in, which its colors start on", async () => {
  window.localStorage.setItem(
    RECENT_ICONS,
    JSON.stringify([
      {
        kind: TASK_SECTION_ICON_KIND.GLYPH,
        glyph: "telescope",
        color: TASK_SECTION_ICON_COLOR.RED,
      },
    ]),
  );
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  await dialogPicker(sidebar);
  const recent = document.querySelector('section[aria-label="Recent"]') ?? assert.fail("no Recent");
  const first = recent.querySelector("button") ?? assert.fail("nothing under Recent");
  assert.equal(first.getAttribute("aria-label"), "Telescope");
  assert.equal(first.querySelector("svg")?.getAttribute("data-icon-color"), "red");
  await act(async () => first.click());
  assert.equal(dialogButton("Red").getAttribute("aria-pressed"), "true");
  await act(async () => dialogButton("Teal").click());
  typeInto(dialogField("Name"), "Stars");
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.deepEqual(made.icon, {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: "telescope",
    color: TASK_SECTION_ICON_COLOR.TEAL,
  });
});

/** Answers the window's media queries as a phone does, its pointer a finger. */
function underAFinger(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/** A finger's touch of `type` at the row's corner, as the browser sends it. */
const touch = (type: string) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });

/** A finger held still on `target` well past a long press, then lifted. */
function longPress(target: HTMLElement): void {
  vi.useFakeTimers();
  try {
    act(() => {
      target.dispatchEvent(touch("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  } finally {
    vi.useRealTimers();
  }
  act(() => {
    target.dispatchEvent(touch("pointerup"));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
  });
}

/** The words of every item of the menus standing. */
function menuWords(): string[] {
  return [...document.querySelectorAll(".ui-menu-item-label")].map(
    (each) => each.textContent ?? "",
  );
}

/** The press of the sidebar row named `name`. */
function rowPress(sidebar: HTMLElement, name: string): HTMLElement {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes(name),
  );
  return row ?? assert.fail(`no ${name} row`);
}

/** A second pin, after Pin audit. */
const SECOND_PIN = {
  ...task("0a1b2c3d-0000-4000-8000-100000000004", "Pin review"),
  pinnedAt: 4,
  pinPosition: "a1",
};

test("under a finger, a pin held offers Move down, which moves it below the next pin, and no Move up from the top", async () => {
  underAFinger();
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, SECOND_PIN, INVITES], SECTIONS, asked);

  longPress(rowPress(sidebar, "Pin audit"));

  assert.ok(menuWords().includes("Move down"), "the menu offers Move down");
  assert.ok(!menuWords().includes("Move up"), "the top pin has no Move up");
  await act(async () => item("Move down").click());
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [PINNED.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > SECOND_PIN.pinPosition, "it sorts after Pin review");
});

test("with a mouse, a pin's menu offers its move too, with its chord", async () => {
  const sidebar = await mountDraggable([PINNED, SECOND_PIN, INVITES], SECTIONS, noneAsked());

  await act(async () => {
    rowPress(sidebar, "Pin review").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
  });

  assert.ok(menuWords().includes("Unpin"), "the pin's menu stands");
  assert.deepEqual(
    menuWords().filter((words) => words === "Move up" || words === "Move down"),
    ["Move up"],
  );
  assert.equal(item("Move up").querySelector(".ui-menu-item-hint")?.textContent, "⇧⌘↑");
});

test("under a finger, a section's menu moves it up among the sections", async () => {
  underAFinger();
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, ICONLESS);
  const drawn = workspaceSections(ICONLESS, WORKSPACE.id).map((section) => section.title);
  const last = drawn.at(-1) ?? assert.fail("two sections stand");
  const actions = sidebar.querySelector<HTMLButtonElement>(`[aria-label="${last} actions"]`);
  assert.ok(actions);

  await act(async () => actions.click());
  assert.ok(!menuWords().includes("Move down"), "the last section has no Move down");
  await act(async () => item("Move up").click());

  const after = writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    ICONLESS,
  );
  assert.deepEqual(
    workspaceSections(after, WORKSPACE.id).map((section) => section.title),
    [...drawn].reverse(),
  );
});

test("under a finger, a task in a section draws no ⋯ and no Pin or Mark done, and held moves down within it by its menu", async () => {
  underAFinger();
  const asked = noneAsked();
  const both: TaskSections = {
    ...SECTIONS,
    entries: [...SECTIONS.entries, { taskId: RETRIES.id, sectionId: LAUNCH, addedAt: 3 }],
  };
  const sidebar = await mountDraggable([INVITES, RETRIES], both, asked);
  const first = sectionTaskIds(both, LAUNCH)[0] === INVITES.id ? INVITES : RETRIES;
  const second = first === INVITES ? RETRIES : INVITES;
  const press = rowPress(sidebar, first.name);
  const row = press.parentElement ?? assert.fail("the press stands in its row");
  assert.ok(row.querySelector('[aria-label="Task actions"]') === null, "the row draws no ⋯");
  assert.ok(
    row.querySelector('[role="group"] button') === null,
    "the row draws no Pin or Mark done",
  );

  longPress(press);
  await act(async () => item("Move down").click());

  const after = asked.writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    both,
  );
  assert.deepEqual(sectionTaskIds(after, LAUNCH), [second.id, first.id]);
});

/** Gives a pin the place the act port heard, as main draws it; `PinsThatMove` sets it as it stands. */
let placePin: (taskId: string, position: string) => void = () => undefined;

/** The sidebar over two pins that sorts them by each place the act port hears, as the window's own state does. */
function PinsThatMove(): React.JSX.Element {
  const [pins, setPins] = useState([PINNED, SECOND_PIN]);
  placePin = (taskId, position) =>
    setPins((held) =>
      held.map((pin) => (pin.id === taskId ? { ...pin, pinPosition: position } : pin)),
    );
  const tasks = tasksControl({
    tasks: pins,
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
  });
  return drawnSidebar(sidebarProps(tasks));
}

test("⇧⌘↓ moves the pin that has the keyboard below the next and leaves it focused, so ⇧⌘↑ can move it back", async () => {
  // A pin's new place leaves on the act port, and main draws it.
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_PIN]: ({ taskId, position }) => {
      if (position !== undefined) placePin(taskId, position);
      return Promise.resolve(true);
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(createElement(PinsThatMove))));
  await settle();
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_ROW_DOWN), false, "no row has the keyboard");

  await act(async () => rowPress(container, "Pin audit").focus());
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_ROW_DOWN), true);
  await act(async () => {
    runAppCommand(APP_COMMAND.MOVE_ROW_DOWN);
  });
  assert.deepEqual(namesIn(container, "Pinned"), ["Pin review", "Pin audit"]);
  assert.equal(document.activeElement, rowPress(container, "Pin audit"));

  // Note that the last row has nowhere further down, so the chord leaves it where it stands.
  await act(async () => {
    runAppCommand(APP_COMMAND.MOVE_ROW_DOWN);
  });
  assert.deepEqual(namesIn(container, "Pinned"), ["Pin review", "Pin audit"]);
  await act(async () => {
    runAppCommand(APP_COMMAND.MOVE_ROW_UP);
  });
  assert.deepEqual(namesIn(container, "Pinned"), ["Pin audit", "Pin review"]);
  assert.equal(document.activeElement, rowPress(container, "Pin audit"));

  await act(async () => (document.activeElement as HTMLElement).blur());
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_ROW_DOWN), false, "the keyboard left the list");
});

test("⇧⌘↓ on a task in a section moves the task within it, and ⇧⌘↑ on the section's header moves the section", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([INVITES, RETRIES], BOTH_IN_LAUNCH, asked);
  const written = () =>
    asked.writes.reduce(
      (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
      BOTH_IN_LAUNCH,
    );
  const before = workspaceSections(BOTH_IN_LAUNCH, WORKSPACE.id).map((section) => section.title);

  await act(async () => rowPress(sidebar, "Invite expiry").focus());
  await act(async () => {
    runAppCommand(APP_COMMAND.MOVE_ROW_DOWN);
  });
  assert.deepEqual(sectionTaskIds(written(), LAUNCH), [RETRIES.id, INVITES.id]);
  assert.deepEqual(
    workspaceSections(written(), WORKSPACE.id).map((section) => section.title),
    before,
    "the section stayed where it stood",
  );

  const fold = sectionHeader(sidebar, "Launch").querySelector<HTMLElement>("button[aria-expanded]");
  await act(async () => fold?.focus());
  await act(async () => {
    runAppCommand(APP_COMMAND.MOVE_ROW_UP);
  });
  assert.deepEqual(
    workspaceSections(written(), WORKSPACE.id).map((section) => section.title),
    [...before].reverse(),
  );
});

test("in a shared workspace, your one task standing in a section leaves Tasks saying nothing of a view that matches none", async () => {
  const shared = { ...WORKSPACE, memberCount: 2 };
  const ada = { userId: "user-ada", name: "Ada Lovelace" };
  const sidebar = await mountSidebar([], SECTIONS, {
    tasks: [{ ...INVITES, assignee: ada }, RETRIES],
    workspace: shared,
    workspaces: [shared],
    me: ada.userId,
  });

  assert.match(sidebar.textContent ?? "", /Invite expiry/u);
  assert.doesNotMatch(sidebar.textContent ?? "", /No tasks match this view\./u);
});
