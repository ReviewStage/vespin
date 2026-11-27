// @vitest-environment jsdom

import { MAX_OPENED_TASKS, VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { useChosenWorkspace } from "./desktop/chosen-workspace.js";
import {
  FILE_TREE_WIDTH,
  INBOX_LIST_WIDTH,
  useFileTreeWidth,
  useFoldedGroups,
  useInboxListWidth,
  useInboxViewChoices,
  useRunsPanel,
} from "./desktop/folded-groups.js";
import { SIDEBAR_WIDTH, useSidebarCollapse } from "./desktop/sidebar-collapse.js";
import { useTaskListView } from "./desktop/task-list-view.js";
import { useConversationFilters } from "./tasks/conversation-filters.js";
import { settleQueries, withQueryClient } from "./testing/copy-feedback.js";
import { keepViewChoices } from "./testing/view-choices.js";

/**
 * kept-keys.test.ts -- a view choice kept before it moved onto `useKept` is
 * still kept: each is read from the name and in the shape an earlier build
 * wrote it, and written back under the same name in the same shape, so
 * nobody loses a fold, a width or a filter to the move; and one that moved
 * up to the account is read once from where an earlier build kept it,
 * handed up in the account's shape, and let go here. The stored texts are
 * spelled out here, never computed from the code under test.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** What the hook answered on its last draw. */
interface Drawn<T> {
  readonly now: () => T;
}

/** Draws a surface that calls `hook`, and answers what it last returned. */
function draw<T>(hook: () => T): Drawn<T> {
  let latest: T | undefined;

  function Surface(): null {
    latest = hook();

    return null;
  }

  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(withQueryClient(createElement(Surface))));

  return {
    now: () => {
      if (latest === undefined) throw new Error("the surface has not drawn");

      return latest;
    },
  };
}

function kept(name: string): string | null {
  return window.localStorage.getItem(name);
}

function keep(name: string, text: string): void {
  window.localStorage.setItem(name, text);
}

test("the sidebar's folds this Mac kept move up to the account under their own keys, the latest opened tasks within the bound, and leave the Mac", async () => {
  const opened = Array.from({ length: MAX_OPENED_TASKS + 1 }, (_, at) => `t${at}`);
  keep("app.sidebarFoldedGroups", '["acme/app",null]');
  keep("app.sidebarPinnedFolded", "true");
  keep("app.sidebarFoldedSections", '["s1"]');
  keep("app.sidebarOpenedTasks", JSON.stringify(opened));
  const written = keepViewChoices();
  const folds = draw(() => useFoldedGroups(false));
  await settleQueries();

  expect(written.map(({ key, workspaceId, value }) => ({ key, workspaceId, value }))).toEqual(
    expect.arrayContaining([
      { key: "sidebarFoldedGroups", workspaceId: null, value: ["acme/app", null] },
      { key: "sidebarPinnedFolded", workspaceId: null, value: true },
      { key: "sidebarFoldedSections", workspaceId: null, value: ["s1"] },
      { key: "sidebarOpenedTasks", workspaceId: null, value: opened.slice(1) },
    ]),
  );
  expect(written).toHaveLength(4);
  expect(folds.now().folded("acme/app")).toBe(true);
  expect(folds.now().folded("acme/other")).toBe(false);
  expect(folds.now().pinnedFolded).toBe(true);
  expect(folds.now().taskOpened("t0")).toBe(false);
  expect(folds.now().taskOpened("t1")).toBe(true);
  expect(kept("app.sidebarFoldedGroups")).toBeNull();
  expect(kept("app.sidebarPinnedFolded")).toBeNull();
  expect(kept("app.sidebarOpenedTasks")).toBeNull();
});

test("a fixture run's folds keep nothing, on the account or the Mac", async () => {
  keep("app.sidebarPinnedFolded", "true");
  const written = keepViewChoices();
  const folds = draw(() => useFoldedGroups(true));
  expect(folds.now().pinnedFolded).toBe(false);
  act(() => folds.now().toggle("acme/app"));
  await settleQueries();
  expect(folds.now().folded("acme/app")).toBe(true);
  expect(written).toEqual([]);
  expect(kept("app.sidebarFoldedGroups")).toBeNull();
  expect(kept("app.sidebarPinnedFolded")).toBe("true");
});

test("the Inbox opens on Open, addressed to me, where nothing was kept", () => {
  const opening = draw(() => useInboxViewChoices()).now();
  expect(opening.show).toBe("to-do");
  expect(opening.whose).toEqual({ kind: "mine" });
});

test("the Inbox's choices this Mac kept move up to the account under their own keys, and leave the Mac", async () => {
  keep("app.inboxShow", '"all"');
  keep("app.inboxWhose", '{"kind":"person","userId":"u1","name":"Ana"}');
  keep("app.inboxPinnedFirst", "false");
  keep("app.inboxFoldedRuns", '["rest"]');
  const written = keepViewChoices();
  const choices = draw(() => useInboxViewChoices());
  await settleQueries();

  expect(written.map(({ key, workspaceId, value }) => ({ key, workspaceId, value }))).toEqual(
    expect.arrayContaining([
      { key: "inboxShow", workspaceId: null, value: "all" },
      {
        key: "inboxWhose",
        workspaceId: null,
        value: { kind: "person", userId: "u1", name: "Ana" },
      },
      { key: "inboxPinnedFirst", workspaceId: null, value: false },
      { key: "inboxFoldedRuns", workspaceId: null, value: ["rest"] },
    ]),
  );
  expect(written).toHaveLength(4);
  expect(choices.now().show).toBe("all");
  expect(choices.now().whose).toEqual({ kind: "person", userId: "u1", name: "Ana" });
  expect(choices.now().pinnedFirst).toBe(false);
  expect(choices.now().folded).toEqual(["rest"]);
  expect(kept("app.inboxShow")).toBeNull();
  expect(kept("app.inboxWhose")).toBeNull();
  expect(kept("app.inboxPinnedFirst")).toBeNull();
  expect(kept("app.inboxFoldedRuns")).toBeNull();
});

test("the list, the file tree and the Runs panel stand at the widths they were kept at, held to their bounds", () => {
  keep("app.inboxListWidth", "9999");
  keep("app.fileTreeWidth", "1");
  keep("app.automationRunsPanel", '{"width":300,"open":false}');

  const drawn = draw(() => ({
    inbox: useInboxListWidth(),
    tree: useFileTreeWidth(),
    runs: useRunsPanel(),
  }));

  expect(drawn.now().inbox.width).toBe(INBOX_LIST_WIDTH.MAX);
  expect(drawn.now().tree.width).toBe(FILE_TREE_WIDTH.MIN);
  expect(drawn.now().runs).toMatchObject({ width: 300, open: false });
  act(() => drawn.now().inbox.onResize(350.4));
  act(() => drawn.now().runs.onShow());
  expect(kept("app.inboxListWidth")).toBe("350");
  expect(kept("app.automationRunsPanel")).toBe('{"width":300,"open":true}');
});

test("the sidebar is folded and as wide as it was kept, and keeps a change under the same names", () => {
  keep("app.sidebar-collapsed", "true");
  keep("app.sidebar-width", "300");
  const sidebar = draw(() => useSidebarCollapse(false, false));
  expect(sidebar.now().collapsed).toBe(true);
  expect(sidebar.now().width).toBe(300);
  act(() => sidebar.now().onToggle());
  act(() => sidebar.now().onResize(9999));
  expect(kept("app.sidebar-collapsed")).toBe("false");
  expect(kept("app.sidebar-width")).toBe(String(SIDEBAR_WIDTH.MAX));
});

test("a sidebar never folded opens", () => {
  expect(draw(() => useSidebarCollapse(false, false)).now().collapsed).toBe(false);
});

test("a task list view this Mac kept with no Assigned to moves up for the workspace listed as the reader's own tasks, its finished sub-tasks hidden, and leaves the Mac", async () => {
  keep("app.sidebarTaskViews", '{"w1":{"grouping":"repository"},"w2":{"grouping":"none"}}');
  const written = keepViewChoices();
  const list = draw(() => useTaskListView("w2", false));
  await settleQueries();

  expect(written.map(({ key, workspaceId, value }) => ({ key, workspaceId, value }))).toEqual([
    {
      key: "sidebarTaskView",
      workspaceId: "w2",
      value: { grouping: "none", assignedTo: { kind: "me" }, finishedSubTasks: false },
    },
  ]);
  expect(list.now().view.grouping).toBe("none");
  expect(JSON.parse(kept("app.sidebarTaskViews") ?? "{}")).toEqual({
    w1: { grouping: "repository" },
  });
});

test("the sidebar and a person's page draw one task list view", async () => {
  keepViewChoices();

  const drawn = draw(() => ({
    sidebar: useTaskListView("w1", false),
    person: useTaskListView("w1", false),
  }));

  act(() => drawn.now().person.onAssignedTo({ kind: "member", userId: "u2" }));
  await settleQueries();
  expect(drawn.now().sidebar.view.assignedTo).toEqual({ kind: "member", userId: "u2" });
});

test("the chosen workspace is read from the id it was kept as", () => {
  const workspace = (id: string): Workspace => ({
    id,
    name: id,
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  });

  keep("app.chosenWorkspace", '"w2"');
  const chosen = draw(() => useChosenWorkspace([workspace("w1"), workspace("w2")], false));
  expect(chosen.now().chosen?.id).toBe("w2");
  act(() => chosen.now().choose("w1"));
  expect(kept("app.chosenWorkspace")).toBe('"w1"');
});

test("the conversation's filters and folds an earlier build kept move up to the account once, and leave the window", async () => {
  keep(
    "app.conversation-filters",
    '{"hideBots":true,"hideResolved":"no","descriptionOpen":false,"conversationOpen":true}',
  );
  const written = keepViewChoices();
  const drawn = draw(() => useConversationFilters());

  const moved = {
    hideBots: true,
    hideResolved: false,
    descriptionOpen: false,
    conversationOpen: true,
  };

  await vi.waitFor(() => expect(drawn.now().filters).toEqual(moved));
  expect(written.map(({ key, workspaceId, value }) => ({ key, workspaceId, value }))).toEqual([
    { key: VIEW_CHOICE_KEY.CONVERSATION_FILTERS, workspaceId: null, value: moved },
  ]);
  expect(kept("app.conversation-filters")).toBeNull();
});
