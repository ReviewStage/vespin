// @vitest-environment jsdom

/**
 * desktop-agent-page.test.ts -- an agent on no task's own page: the line over its box counts the threads it posted that wait on the reader, read from the account's feed, and opens the Inbox on the oldest of them; a `/` in its box lists the skills of its own repository; ⌘F finds in its conversation; its box offers Talk; a Manager's Settings stands as a button beside its ⋯, which no longer lists it; a page its words link opens in the panel beside it; a Manager's Inbox tab lists its threads as the window's Inbox's view chooses; and a Manager's page on a phone stands on its chat with its threads. Synthetic throughout.
 */

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  AGENT_KIND,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type ListedAgent,
} from "@repo/features/agent-wire";
import { EVERYONES, INBOX_SHOW } from "@repo/features/inbox-list-model";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import type { ManagerFace } from "@repo/features/manager-face";
import { TASK_SKILL_SOURCE } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, type TasksSkillsParams } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import { MESSAGE_ROLE } from "@repo/wire";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand } from "../app-commands.js";
import { RoutedExitsProvider } from "../places/routed-exits.js";
import { type MessageReveal, MessageRevealProvider } from "../tasks/message-links.js";
import { useSidePanel } from "../tasks/use-side-panel.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import { handHostReads, handInboxItems, handState, holdPages } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, typeInComposer } from "../testing/composer.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { ACME, SHOW_KEY, WHOSE_KEY } from "../testing/desktop-inbox.js";
import { overListedTasks } from "../testing/desktop-sidebar.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import {
  agentsControl,
  pushedTranscripts,
  taskAgentsOf,
  tasksControl,
} from "../testing/tasks-control.js";
import { AgentRoutePage } from "./desktop-agent-page.js";

const MANAGER: ListedAgent = {
  id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  taskId: null,
  workspaceId: ACME.id,
  repository: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Release manager",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** An open decide from the Manager, posted at `at`. */
function ask(id: string, title: string, at: number): InboxItem {
  return {
    id,
    agentId: MANAGER.id,
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `m${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Which one?",
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Yes" }, { label: "No" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: at,
      },
    ],
    postedAt: at,
    updatedAt: at,
  };
}

const OLDER = ask("7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d01", "Cut the release?", 10);
const NEWER = ask("7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d02", "Ship the notes?", 20);

const roots: Root[] = [];

/**
 * A router holding the agent's own address, the Inbox's item, and a task's
 * page beneath the window's pathless places, as the panel's names them, over
 * `history`, the agent's page drawn where its address stands under `tasks`
 * as `Page` draws it. Note that the
 * panel's own routes draw the whole window, which this page needs none of.
 */
function agentRouter(
  history: ReturnType<typeof createMemoryHistory>,
  tasks: ReturnType<typeof tasksControl>,
  Page: () => React.ReactNode,
) {
  const root = createRootRoute();
  const places = createRoute({ getParentRoute: () => root, id: "places" });
  const workspace = createRoute({ getParentRoute: () => places, path: "/$workspace" });

  const agent = createRoute({
    getParentRoute: () => workspace,
    path: "agent/$agentId",
    component: () => overListedTasks(tasks, createElement(Page)),
  });

  const inbox = createRoute({ getParentRoute: () => workspace, path: "inbox/$itemId" });
  const page = createRoute({ getParentRoute: () => workspace, path: "task/$taskId/page/$pageId" });

  return createRouter({
    routeTree: root.addChildren([
      places.addChildren([workspace.addChildren([agent, inbox, page])]),
    ]),
    history,
  });
}

/** The agent's page drawn where `history` stands, under `tasks`, once its reads settle: the element it is drawn in. */
async function mountAgentPage(
  history: ReturnType<typeof createMemoryHistory>,
  tasks: ReturnType<typeof tasksControl>,
  Page: () => React.ReactNode = () => createElement(AgentRoutePage, { tasks }),
): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(
          RoutedExitsProvider,
          null,
          createElement(RouterProvider, { router: agentRouter(history, tasks, Page) }),
        ),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();

  return container;
}

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

test("an agent on no task docks the threads it posted over its box, counted from the account's feed, and the dock opens the Inbox on the oldest waiting", async () => {
  handInboxItems({
    rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: { [MANAGER.id]: [NEWER, OLDER] } },
  });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [MANAGER] });
  const container = await mountAgentPage(history, tasks);

  const dock =
    container.querySelector<HTMLElement>(".agent-threads-dock") ??
    assert.fail("the agent's box docks its threads");

  assert.match(
    dock.textContent ?? "",
    /Inbox\s*2/u,
    "it counts both threads waiting on the reader",
  );

  const press =
    dock.querySelector<HTMLElement>("[role='button'], button") ?? assert.fail("the dock presses");

  act(() => press.click());
  await settleQueries();
  assert.equal(history.location.pathname, `/acme/inbox/${OLDER.id}`);
});

test("a / in an agent on no task's box lists the skills of its own workspace and repository", async () => {
  handState(experimentsOn(EXPERIMENT.SKILLS));
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const asked: TasksSkillsParams[] = [];
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.TASKS_SKILLS) return previous(request);
      asked.push(request.payload);

      const release = {
        name: "release",
        description: "Use to cut a release.",
        source: TASK_SKILL_SOURCE.REPOSITORY,
        path: ".agents/skills/release/SKILL.md",
      };

      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { skills: { repository: "acme/relay", branch: "main", skills: [release] } },
      });
    },
  });
  const manager = { ...MANAGER, repository: "acme/relay", runtime: AGENT_RUNTIME.CLAUDE_CODE };
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  const container = await mountAgentPage(history, tasks);

  typeInComposer(container, "/");
  await settleQueries();

  const options = [...document.querySelectorAll('[role="listbox"] [role="option"]')].map(
    (row) => row.textContent ?? "",
  );

  assert.ok(
    options.some((row) => row.includes("release")),
    "it lists the repository's skill",
  );
  assert.deepEqual(asked, [{ workspaceId: ACME.id, repository: "acme/relay" }]);
});

test("⌘F on an agent on no task's page opens the find bar over its conversation", async () => {
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [MANAGER] });
  const container = await mountAgentPage(history, tasks);

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.FIND), "the page offers find");
  });

  assert.ok(
    container.querySelector('.agent-page .find-scope > .find-bar input[aria-label="Find"]'),
    "the find bar stands over the agent's column",
  );
});

test("an agent on no task's box offers Talk, as an agent's tab on a task does", async () => {
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [MANAGER] });
  const container = await mountAgentPage(history, tasks);

  assert.ok(
    container.querySelector('.agent-composer [aria-label="Talk"]'),
    "the box offers a call into the agent",
  );
});

test("a Manager's page stands Settings as a button beside its ⋯, which opens its card, and its ⋯ no longer lists it", async () => {
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const manager = { ...MANAGER, kind: AGENT_KIND.MANAGER };
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  const container = await mountAgentPage(history, tasks);

  const more =
    container.querySelector<HTMLElement>('button[aria-label="Agent actions"]') ??
    assert.fail("the head stands its ⋯");

  act(() => more.click());

  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );

  assert.ok(items.length > 0, "the ⋯ opens its menu");
  assert.ok(!items.some((item) => item.includes("Settings")), "the ⋯ leaves Settings out");
  act(() => more.click());

  const settings =
    container.querySelector<HTMLElement>('button[aria-label="Settings"]') ??
    assert.fail("the head stands a Settings button");

  act(() => settings.click());
  await settleQueries();
  assert.ok(document.querySelector('[role="dialog"]'), "Settings opens the Manager's card");
});

test("a Manager's ⋯ Change face opens its name's field with the face's picker in the bar's lead, whose colors end nothing, and a face picked there is changed with the focus back in the name", async () => {
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const faced: { agentId: string; face: ManagerFace }[] = [];

  const manager: ListedAgent = {
    ...MANAGER,
    kind: AGENT_KIND.MANAGER,
    face: { character: "ghost", color: "yellow" },
  };

  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });

  const tasks = tasksControl({
    shown: true,
    workspace: ACME,
    listedAgents: [manager],
    agents: taskAgentsOf(
      agentsControl({
        onFace: (agentId, face) => {
          faced.push({ agentId, face });

          return Promise.resolve({ agent: { ...manager, face } });
        },
      }),
    ),
  });

  const container = await mountAgentPage(history, tasks);

  const more =
    container.querySelector<HTMLElement>('button[aria-label="Agent actions"]') ??
    assert.fail("the head stands its ⋯");

  act(() => more.click());

  const change =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith("Change face"),
    ) ?? assert.fail("the ⋯ offers Change face");

  await act(async () => change.click());
  const field = () => container.querySelector<HTMLInputElement>('input[aria-label="Agent name"]');

  assert.ok(field(), "the title is its field");

  const cat =
    document.querySelector<HTMLButtonElement>('button[aria-label="Cat"]') ??
    assert.fail("the face's picker stands open beside the name");

  await act(async () => cat.click());

  const purple =
    document.querySelector<HTMLButtonElement>('.ui-icon-picker-flyout [aria-label="Purple"]') ??
    assert.fail("the cat floats its colors");

  assert.ok(field(), "the colors floating end nothing");
  await act(async () => purple.click());
  await vi.waitFor(() =>
    assert.deepEqual(faced, [{ agentId: MANAGER.id, face: { character: "cat", color: "purple" } }]),
  );
  await vi.waitFor(() =>
    assert.equal(document.activeElement, field(), "the name takes the focus back"),
  );
});

test("a page a Manager's words link opens in the panel beside its chat, read on its task, as a task's page opens one, the Manager's page still standing", async () => {
  const taskId = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
  const pageId = "3c4d5e6f-0000-4000-8000-000000000001";
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    {
      messages: [
        {
          id: "answer",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            {
              type: "text",
              text: `The numbers are on [@Invite funnel](https://vespin.dev/acme/task/${taskId}/page/${pageId}).`,
            },
          ],
        },
      ],
      cursor: "1:0",
      status: AGENT_STATUS.COMPLETED,
      title: null,
    },
  ]);
  // The page's task holds it, as the host lays a task's pages once the panel holds them.
  holdPages(handHostReads({}).deliverPages, (place) => ({
    rows:
      place.taskId === taskId ? [{ id: pageId, title: "Invite funnel", version: 1, at: 1 }] : [],
  }));
  const at = `/acme/agent/${MANAGER.id}`;
  const history = createMemoryHistory({ initialEntries: [at] });
  const listed = tasksControl({ shown: true, workspace: ACME, listedAgents: [MANAGER] });

  // The window's own panel, held at the Manager's stop and standing for no task, as the window holds it on its page (`use-tasks-tab.ts`).
  function Paneled() {
    const sidePanel = useSidePanel(undefined, {
      id: undefined,
      holds: {},
      bare: true,
      stop: MANAGER.id,
    });

    return createElement(AgentRoutePage, { tasks: { ...listed, sidePanel } });
  }

  const container = await mountAgentPage(history, listed, Paneled);

  const chip =
    container.querySelector<HTMLElement>(".agent-page [data-mention-ref]") ??
    assert.fail("the Manager's words name the page");

  act(() => chip.click());
  await settleQueries();

  const tabs = [...container.querySelectorAll('aside[aria-label="Panel"] [role="tab"]')];
  assert.deepEqual(
    tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]),
    [["Invite funnel", "true"]],
    "the page stands in the panel beside the chat",
  );
  assert.equal(history.location.pathname, at, "the Manager's page still stands");
});

test("a Manager's Inbox tab counts its open threads, and the dock over its box opens that tab on the oldest waiting rather than the window's Inbox", async () => {
  handInboxItems({
    rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: { [MANAGER.id]: [NEWER, OLDER] } },
  });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const manager: ListedAgent = { ...MANAGER, kind: AGENT_KIND.MANAGER };
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  const container = await mountAgentPage(history, tasks);

  const inboxTab =
    [...container.querySelectorAll<HTMLElement>("[role='tab']")].find((tab) =>
      /^Inbox/u.test(tab.textContent ?? ""),
    ) ?? assert.fail("a Manager's page offers an Inbox tab");

  assert.match(inboxTab.textContent ?? "", /Inbox\s*2/u, "it counts both open threads");

  const press =
    container.querySelector<HTMLElement>(
      ".agent-threads-dock [role='button'], .agent-threads-dock button",
    ) ?? assert.fail("the Manager's box docks its threads");

  act(() => press.click());
  await settleQueries();
  assert.equal(history.location.pathname, `/acme/agent/${MANAGER.id}`, "the page stands");
  assert.equal(inboxTab.getAttribute("aria-selected"), "true", "the Inbox tab is chosen");
  assert.ok(
    [...container.querySelectorAll("h2")].some((heading) => heading.textContent === OLDER.title),
    "the oldest waiting thread is shown",
  );
});

/** A Manager's chat message, said by the Manager, in the thread of `threadRoot` where one is named. */
function said(
  id: string,
  seq: number,
  text: string,
  threadRoot: string | null,
): ManagerChatLiveMessage {
  return {
    id,
    seq,
    clientKey: `key-${id}`,
    authorKind: MANAGER_CHAT_AUTHOR.AGENT,
    authorUserId: null,
    authorName: "Release manager",
    text,
    attachments: [],
    threadRoot,
    broadcast: false,
    turnId: null,
    lineId: null,
    createdAt: seq * 1_000,
    editedAt: null,
  };
}

/** A Manager whose chat holds one message with one reply in its thread, newest first, as the service pages it. */
function managerWithThread(): ListedAgent {
  handInboxItems({ rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: {} } });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const manager: ListedAgent = { ...MANAGER, kind: AGENT_KIND.MANAGER };
  handState(
    {},
    {
      tasks: IDLE_TASKS_VIEW,
      [LIVE_READ.MANAGER_CHAT]: {
        [manager.id]: {
          rows: {
            messages: [
              said("reply", 2, "The web app's.", "first"),
              said("first", 1, "On it.", null),
            ],
            sending: [],
          },
        },
      },
    },
  );

  return manager;
}

test("a Manager's page on a phone stands on its chat, a message's thread summed under it, with no row of views, where its transcript stood", async () => {
  const manager = managerWithThread();
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });

  const container = await mountAgentPage(history, tasks, () =>
    createElement(AgentRoutePage, { tasks, away: { label: "Home", onPress: () => {} } }),
  );

  const page = container.querySelector(".agent-page") ?? assert.fail("the Manager's page stands");
  assert.match(page.textContent ?? "", /On it\./u, "the chat's message stands");
  assert.match(page.textContent ?? "", /1 reply/u, "its thread's reply is summed under it");
  assert.equal(page.querySelector("[role='tablist']"), null, "no row of views stands");
});

/** Opens the thread of the message under `container` that sums it, from that summary. */
async function openThread(container: HTMLElement): Promise<void> {
  const summary =
    [...container.querySelectorAll<HTMLElement>("button")].find((button) =>
      /1 reply/u.test(button.textContent ?? ""),
    ) ?? assert.fail("the message sums its thread");

  act(() => summary.click());
  await settleQueries();
}

/** The thread standing in the page under `container`; none while it is shut. */
function threadShown(container: HTMLElement): Element | null {
  return container.querySelector(".agent-page section[aria-label='Thread']");
}

test("a wide Manager's page opens a message's thread inside Messages beside the chat, not in the panel, and its close and Escape shut it", async () => {
  const manager = managerWithThread();
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  const container = await mountAgentPage(history, tasks);

  await openThread(container);

  const thread = threadShown(container) ?? assert.fail("the thread stands in the page");

  assert.match(thread.textContent ?? "", /The web app's\./u, "the thread shows its reply");
  assert.match(
    container.querySelector(".agent-page")?.textContent ?? "",
    /On it\./u,
    "the chat still stands beside it",
  );
  assert.equal(container.querySelector('aside[aria-label="Panel"]'), null, "no panel opens");

  const close =
    container.querySelector<HTMLElement>("button[aria-label='Close thread']") ??
    assert.fail("the thread offers its close");

  act(() => close.click());
  await settleQueries();
  assert.equal(threadShown(container), null, "the close shuts the thread");

  await openThread(container);
  assert.notEqual(threadShown(container), null, "the thread opens again");
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.CLOSE_THREAD), "Escape closes the thread");
  });
  await settleQueries();
  assert.equal(threadShown(container), null, "Escape shuts the thread");
});

test("with a thread open beside a Manager's chat, ⌘F finds in whichever of the two the reader was in last", async () => {
  const manager = managerWithThread();
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  const container = await mountAgentPage(history, tasks);
  await openThread(container);

  const thread = threadShown(container) ?? assert.fail("the thread stands in the page");

  const chat =
    container.querySelector(".agent-page .desktop-task-column") ??
    assert.fail("the chat stands beside it");

  /** The reader pressing in `where`, then ⌘F. */
  const findFrom = (where: Element) => {
    act(() => {
      where.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => {
      assert.ok(runAppCommand(APP_COMMAND.FIND), "the page offers find");
    });
  };

  /** Whether the find bar stands over the scope holding `inside`. */
  const barOver = (inside: Element) =>
    inside.closest(".find-scope")?.querySelector(":scope > .find-bar") != null;

  findFrom(chat);
  assert.equal(barOver(chat), true, "from the chat, it finds in the chat");
  assert.equal(barOver(thread), false, "not in the thread");

  findFrom(thread);
  assert.equal(barOver(thread), true, "from the thread, it finds in the thread");
});

test("a link to a Manager's message while its thread stands alone over the chat closes the thread, so the chat shows the message", async () => {
  const manager = managerWithThread();
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  let ask: (reveal: MessageReveal) => void = () => undefined;

  /** The page under a link's standing ask, which `ask` raises. */
  function Asked(): React.ReactNode {
    const [reveal, setReveal] = useState<MessageReveal | undefined>(undefined);
    ask = setReveal;

    return createElement(
      MessageRevealProvider,
      { value: { reveal, onRevealed: () => undefined } },
      createElement(AgentRoutePage, { tasks }),
    );
  }

  const container = await mountAgentPage(history, tasks, Asked);
  await openThread(container);

  // Messages stands narrower than the chat's least and the thread's together, so the thread stands alone.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("ui-side-split") ? new DOMRect(0, 0, 600, 800) : new DOMRect();
  });
  act(() => relayout());

  const split =
    container.querySelector<HTMLElement>(".ui-side-split") ?? assert.fail("the split stands");

  assert.equal(split.hasAttribute("data-alone"), true, "the thread stands alone over the chat");

  act(() => ask({ agentId: manager.id, messageId: "first", ask: 1 }));
  await settleQueries();

  assert.equal(threadShown(container), null, "the thread closes");
  assert.equal(split.hasAttribute("data-alone"), false, "the chat shows again");
});

test("a Manager's Inbox tab lists its threads as the window's Inbox's view chooses, offering that view's menu", async () => {
  const answered: InboxItem = {
    ...ask("7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d03", "Rename the branch?", 5),
    status: INBOX_STATUS.ANSWERED,
  };

  // The window's Inbox shows Open, addressed to anyone.
  window.localStorage.setItem(SHOW_KEY, JSON.stringify(INBOX_SHOW.OPEN));
  window.localStorage.setItem(WHOSE_KEY, JSON.stringify(EVERYONES));
  handInboxItems({
    rows: { [INBOX_SCOPE_KIND.TASK]: {}, agents: { [MANAGER.id]: [NEWER, answered] } },
  });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const manager: ListedAgent = { ...MANAGER, kind: AGENT_KIND.MANAGER };
  const history = createMemoryHistory({ initialEntries: [`/acme/agent/${MANAGER.id}`] });
  const tasks = tasksControl({ shown: true, workspace: ACME, listedAgents: [manager] });
  const container = await mountAgentPage(history, tasks);

  const inboxTab =
    [...container.querySelectorAll<HTMLElement>("[role='tab']")].find((tab) =>
      /^Inbox/u.test(tab.textContent ?? ""),
    ) ?? assert.fail("a Manager's page offers an Inbox tab");

  act(() => inboxTab.click());
  await settleQueries();

  const threads =
    container.querySelector<HTMLElement>(".agent-threads") ??
    assert.fail("the Inbox tab draws the Manager's threads");

  assert.ok(
    threads.querySelector("[aria-label='View options']") !== null,
    "the list offers the window's Inbox's view's menu",
  );
  assert.match(threads.textContent ?? "", /Ship the notes\?/u, "the open thread is listed");
  assert.doesNotMatch(
    threads.textContent ?? "",
    /Rename the branch\?/u,
    "the answered thread is left out under the window's Inbox's Open",
  );
});
