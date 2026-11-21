// @vitest-environment jsdom

/**
 * desktop-agent-page.test.ts -- an agent on no task's own page: the line over its box counts the threads it posted that wait on the reader, read from the account's feed, and opens the Inbox on the oldest of them; a `/` in its box lists the skills of its own repository; ⌘F finds in its conversation; and its box offers Talk. Synthetic throughout.
 */

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { AGENT_RUNTIME, AGENT_STATUS, type ListedAgent } from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { TASK_SKILL_SOURCE } from "@repo/features/task-wire";
import type { TasksSkillsParams } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand } from "../app-commands.js";
import { RoutedExitsProvider } from "../places/routed-exits.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import { handInboxItems, handState } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, typeInComposer } from "../testing/composer.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { ACME } from "../testing/desktop-inbox.js";
import { overListedTasks } from "../testing/desktop-sidebar.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { pushedTranscripts, tasksControl } from "../testing/tasks-control.js";
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
 * A router holding the agent's own address and the Inbox's item beneath the
 * window's pathless places, as the panel's names them, over `history`, the
 * agent's page drawn where its address stands under `tasks`. Note that the
 * panel's own routes draw the whole window, which this page needs none of.
 */
function agentRouter(
  history: ReturnType<typeof createMemoryHistory>,
  tasks: ReturnType<typeof tasksControl>,
) {
  const root = createRootRoute();
  const places = createRoute({ getParentRoute: () => root, id: "places" });
  const workspace = createRoute({ getParentRoute: () => places, path: "/$workspace" });

  const agent = createRoute({
    getParentRoute: () => workspace,
    path: "agent/$agentId",
    component: () => overListedTasks(tasks, createElement(AgentRoutePage, { tasks })),
  });

  const inbox = createRoute({ getParentRoute: () => workspace, path: "inbox/$itemId" });

  return createRouter({
    routeTree: root.addChildren([places.addChildren([workspace.addChildren([agent, inbox])])]),
    history,
  });
}

/** The agent's page drawn where `history` stands, under `tasks`, once its reads settle: the element it is drawn in. */
async function mountAgentPage(
  history: ReturnType<typeof createMemoryHistory>,
  tasks: ReturnType<typeof tasksControl>,
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
          createElement(RouterProvider, { router: agentRouter(history, tasks) }),
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
