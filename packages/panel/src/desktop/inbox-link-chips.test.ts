// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { createMemoryHistory } from "@tanstack/react-router";
import { Effect } from "effect";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import type { InboxChoice } from "../tasks/use-tasks-tab.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActPort,
  fakeActPortCalls,
  fakeActs,
} from "../testing/app-bridge.js";
import { signedInAs } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { holdingInboxChoice, windowRouter } from "../testing/window-router.js";
import { DesktopInbox } from "./desktop-inbox.js";

/**
 * inbox-link-chips.test.ts -- a link in a window Inbox item's words reads
 * through the item's own workspace, as it would in its task: a plan's item
 * through the plan's workspace, an item of an agent with no plan through
 * the agent's, whichever workspace the Inbox lists; an item whose workspace
 * the service did not name reads nothing and says what its address says.
 * Synthetic workspaces, plans, agents, and pull requests.
 */

const PULL = "https://github.com/acme/relay/pull/42";
const LEDGER_PULL = "https://github.com/globex/ledger/pull/5";

// A Markdown block is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** Acme and Globex, each with its GitHub App installed. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};
const GLOBEX: Workspace = {
  ...ACME,
  id: "workspace-globex",
  name: "Globex",
  slug: "globex",
  github: { login: "globex", active: true },
};

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};
const TASK_AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** A notice an agent posted, asking nothing, its thread one message of the words given. */
function item(id: string, agentId: string, words: string): InboxItem {
  return {
    id,
    agentId,
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "Ready for a look",
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `e${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: words,
        createdAt: 1_000,
      },
    ],
    postedAt: 1_000,
    updatedAt: 2_000,
  };
}

/** What the host holds of each pull request linked, by its address, as the App answers it through any workspace. */
const STANDINGS = {
  [PULL]: {
    rows: {
      pullRequest: {
        number: 42,
        title: "Send invitations in batches",
        url: PULL,
        state: PULL_REQUEST_STATE.MERGED,
      },
    },
  },
  [LEDGER_PULL]: {
    rows: {
      pullRequest: {
        number: 5,
        title: "Settle the ledger nightly",
        url: LEDGER_PULL,
        state: PULL_REQUEST_STATE.MERGED,
      },
    },
  },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The window's Inbox listing `listed`, holding the plan's items given, the first of them chosen, and every act it asked. */
async function inbox(options: {
  listed: Workspace | undefined;
  taskItems: readonly InboxItem[];
  /** The plan holding the items; Teammate invitations, in Acme, unless said. */
  task?: TaskSummary;
  /** The account's workspaces as main's document holds them; Acme and Globex unless said. */
  workspaces?: readonly Workspace[];
}) {
  const asked: AnyAct[] = [];
  const workspaces = options.workspaces ?? [ACME, GLOBEX];
  const task = options.task ?? TASK;
  // The account's feed holds the task's items, which the Inbox draws from; the host holds each link's standing through every workspace.
  const signedIn = signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" });
  const state = {
    ...signedIn,
    inbox: {
      ...signedIn.inbox,
      waiting:
        options.taskItems.length === 0
          ? []
          : [{ taskId: task.id, items: options.taskItems.map(waitingOf) }],
      tasks:
        options.taskItems.length === 0
          ? []
          : [{ taskId: task.id, items: options.taskItems.length, updatedAt: 2_000 }],
    },
    tasks: {
      ...IDLE_TASKS_VIEW,
      tasks: [task],
      taskAgents: [],
      workspaces,
    },
    [LIVE_READ.LINK_STANDINGS]: Object.fromEntries(workspaces.map(({ id }) => [id, STANDINGS])),
    [LIVE_READ.INBOX_ITEMS]: {
      rows: { [INBOX_SCOPE_KIND.PLAN]: { [task.id]: options.taskItems } },
    },
  };
  fakeActs({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      asked.push(request);
      switch (request.kind) {
        // A link's standing is held quietly, as the host holds one, what it holds already on the document.
        case ACT_KIND.TASKS_LINK_STANDING_FOLLOW:
          return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
        default:
          return Promise.resolve({
            status: FAKE_ANSWER.REFUSED,
            reason: "Not in this test.",
          });
      }
    },
  });
  fakeActPort({ ...fakeActPortCalls() });
  // Note that the first item stands chosen at its address, held as a press on its row holds it, so the item is drawn.
  const [first] = options.taskItems;
  const chosen: InboxChoice | undefined =
    first === undefined ? undefined : { taskId: task.id, itemId: first.id };
  function Page() {
    return createElement(DesktopInbox, {
      tasks: tasksControl({ workspace: options.listed, tasks: [task] }),
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const listedStep =
    options.listed === undefined ? "acme" : (options.listed.slug ?? options.listed.id);
  const at = `/${listedStep}/inbox${chosen === undefined ? "" : `/${chosen.itemId}`}`;
  const router = windowRouter(createMemoryHistory({ initialEntries: [at] }));
  const held = chosen === undefined ? null : holdingInboxChoice(chosen);
  act(() =>
    root?.render(
      router.provide(withQueryClient(createElement(Fragment, null, held, createElement(Page)))),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });
  return { container, asked };
}

/** The chips the chosen item's words draw, by the name each says and the state after it. */
function chips(container: HTMLElement): [string | null, string | null][] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-inbox-message-text] [data-mention-ref]"),
  ].map((chip) => [
    chip.querySelector(".ui-inline-ref-label")?.textContent ?? null,
    chip.querySelector(".ui-inline-ref-state")?.textContent ?? null,
  ]);
}

/** The workspace each link's standing was held through, with the link. */
function readThrough(asked: readonly AnyAct[]): string[] {
  return asked.flatMap((each) =>
    each.kind === ACT_KIND.TASKS_LINK_STANDING_FOLLOW
      ? [`${each.payload.workspaceId} ${each.payload.address}`]
      : [],
  );
}

test("a plan's item in the window's Inbox reads its links through the plan's workspace, as its task does", async () => {
  const { container, asked } = await inbox({
    listed: ACME,
    taskItems: [item("a1b2c3d4-0000-4000-8000-000000000001", TASK_AGENT, `Opened ${PULL}.`)],
  });

  // Note that the item's words stand once the account's inbox read reaches its query.
  await vi.waitFor(() => assert.deepEqual(chips(container), [["#42", "Merged"]]));
  assert.deepEqual(readThrough(asked), [`workspace-acme ${PULL}`]);
});

test("an item of a workspace an older service answered with no slug still reads its links through that workspace, by its id", async () => {
  const { slug: _slug, ...unslugged } = GLOBEX;
  const { container, asked } = await inbox({
    listed: undefined,
    taskItems: [item("a1b2c3d4-0000-4000-8000-000000000004", TASK_AGENT, `Opened ${LEDGER_PULL}.`)],
    task: { ...TASK, workspaceId: GLOBEX.id, repository: "globex/ledger" },
    workspaces: [ACME, unslugged],
  });

  await vi.waitFor(() => assert.deepEqual(chips(container), [["#5", "Merged"]]));
  assert.deepEqual(readThrough(asked), [`workspace-globex ${LEDGER_PULL}`]);
});
