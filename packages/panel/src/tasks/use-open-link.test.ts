// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { LINK_PLACE, type LinkPlace, type ReadLink } from "@repo/features/link-grammar";
import { APP_HOME_LINK, LINK_ORIGIN } from "@repo/features/link-home";
import type { PagePlace } from "@repo/features/page-wire";
import type { TaskPullRequests } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { useQuery } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, createElement, memo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PullRequestLine } from "../desktop/task-card.js";
import { createPanelRouter } from "../panel-router.js";
import { LINK_ROUTED_PLACE, routedLinkOf } from "../places/link-places.js";
import { ADDRESS, addressOf, HERE, ROUTE, type Route } from "../places/pressed-address.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { testQueryClientNow, withQueryClient } from "../testing/copy-feedback.js";
import { appStateQuery, selectRun } from "../use-app-state.js";
import {
  type Listed,
  ListedPullRequests,
  OpenAddressesHere,
  OpenLinkProvider,
  openPullRequestsHere,
  type PagesHere,
  PullRequestsOnGitHub,
  throughWindow,
  useOpenLink,
} from "./use-open-link.js";

/**
 * use-open-link.test.ts -- a pull request inside a pull request's own tab
 * opens on GitHub, though a listed task's agent opened it, a new list
 * draws no part opening links again, which reads the list as the link
 * opens, and a link naming a listed task by its number reaches the place
 * pressed on by the task's id; what a task's or an agent's page opens beside
 * it, and where the window opens what no surface took, one row per kind of
 * address. What the window is handed is read as the window reads it,
 * matched on its route tree (`../places/link-places.ts`). Synthetic ids, a
 * task card's pull request row standing for every press.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const URL = "https://github.com/acme/relay/pull/42";

const LINE = {
  number: 42,
  title: "Expire invitations",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 3,
  deletions: 1,
  url: URL,
};

/** The listed task's pull requests, as the list followed live holds them. */
const LISTED: readonly TaskPullRequests[] = [
  { taskId: TASK, pullRequests: [{ ...LINE, agentId: AGENT }] },
];

/** The window's router, as its root makes one, which a link the window is handed is matched on. */
const router = createPanelRouter(
  createMemoryHistory({ initialEntries: ["/app"] }),
  testQueryClientNow(),
);

/** The link place the window's router matches a link at, by its declaration and the place it reads there. */
function matched(link: ReadLink) {
  const routed = routedLinkOf(router, link, "acme");
  return routed === undefined ? undefined : { declared: routed.declared, place: routed.link.place };
}

/** Opens `href` written in a part under the window's opener, answering the links the window was handed. */
function handed(href: string): readonly ReadLink[] {
  const links: ReadLink[] = [];
  let open: ((href: string) => void) | undefined;
  function Opener(): null {
    open = useOpenLink();
    return null;
  }
  fakeAppPlatform({ openGitHub: () => undefined, openWeb: () => undefined });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      withQueryClient(
        createElement(
          OpenLinkProvider,
          { value: (link: ReadLink) => links.push(link) },
          createElement(Opener),
        ),
      ),
    ),
  );
  act(() => open?.(href));
  return links;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Presses the pull request's row drawn as `wrap` holds it under the window's opener, answering where it went. */
function press(url: string, wrap: (row: ReactNode) => ReactNode = (row) => row) {
  const links: ReadLink[] = [];
  const github: string[] = [];
  fakeAppPlatform({ openGitHub: (href) => github.push(href) });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const row = createElement(
    "ul",
    null,
    createElement(PullRequestLine, { pullRequest: { ...LINE, url } }),
  );
  act(() =>
    root?.render(
      withQueryClient(
        createElement(
          OpenLinkProvider,
          { value: (link: ReadLink) => links.push(link) },
          createElement(ListedPullRequests, { tasks: LISTED, children: wrap(row) }),
        ),
      ),
    ),
  );
  const button =
    container.querySelector<HTMLElement>("[data-task-card-pull-request] button") ??
    assert.fail("the row is a press");
  act(() => button.click());
  return { places: links.map((link) => link.place), github };
}

test("inside a pull request's own tab, a link to it opens on GitHub", () => {
  assert.deepEqual(
    press(URL, (row) => createElement(PullRequestsOnGitHub, null, row)),
    { places: [], github: [URL] },
  );
});

test("a new list of tasks draws no part opening links again, and a link opened after it reads the new list", () => {
  const links: ReadLink[] = [];
  let open: ((href: string) => void) | undefined;
  // Note that the part holds while nothing it is handed changes, as a transcript's link does.
  const Opener = memo(function Opener() {
    open = useOpenLink();
    return null;
  });
  const openPlace = (link: ReadLink) => {
    links.push(link);
  };
  const draw = (tasks: readonly TaskPullRequests[]) =>
    withQueryClient(
      createElement(
        OpenLinkProvider,
        { value: openPlace },
        createElement(ListedPullRequests, { tasks, children: createElement(Opener) }),
      ),
    );
  fakeAppPlatform({ openGitHub: () => undefined });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(draw([])));
  act(() => root?.render(draw(LISTED)));
  act(() => open?.(URL));

  assert.deepEqual(links.map(matched), [
    {
      declared: LINK_ROUTED_PLACE.CHANGES,
      place: { kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT },
    },
  ]);
});

const AT_AGENT = `${LINK_ORIGIN}/acme/agent/${AGENT}`;
const ON_TASK = `${LINK_ORIGIN}/acme/task/${TASK}/agent/${AGENT}`;
const ON_PLAN = `${LINK_ORIGIN}/acme/plan/${TASK}/agent/${AGENT}`;

test.each([
  [
    "an agent's link",
    AT_AGENT,
    LINK_ROUTED_PLACE.AGENT,
    { kind: LINK_PLACE.AGENT, agentId: AGENT },
  ],
  [
    "an agent's link in the app's own scheme",
    `${APP_HOME_LINK}acme/agent/${AGENT}`,
    LINK_ROUTED_PLACE.AGENT,
    { kind: LINK_PLACE.AGENT, agentId: AGENT },
  ],
  [
    "an agent's link under its task",
    ON_TASK,
    LINK_ROUTED_PLACE.AGENT,
    { kind: LINK_PLACE.AGENT, planId: TASK, agentId: AGENT },
  ],
  [
    "an agent's link under /plan/",
    ON_PLAN,
    LINK_ROUTED_PLACE.AGENT,
    { kind: LINK_PLACE.AGENT, planId: TASK, agentId: AGENT },
  ],
  [
    "a message's link",
    `${AT_AGENT}/message/msg-7`,
    LINK_ROUTED_PLACE.MESSAGE,
    { kind: LINK_PLACE.MESSAGE, agentId: AGENT, messageId: "msg-7" },
  ],
  [
    "a message's link under /plan/",
    `${ON_PLAN}/message/msg-7`,
    LINK_ROUTED_PLACE.MESSAGE,
    { kind: LINK_PLACE.MESSAGE, planId: TASK, agentId: AGENT, messageId: "msg-7" },
  ],
  [
    "a worker's link",
    `${AT_AGENT}/worker/toolu_1`,
    LINK_ROUTED_PLACE.WORKER,
    { kind: LINK_PLACE.WORKER, agentId: AGENT, callId: "toolu_1" },
  ],
  [
    "a worker's link under its task",
    `${ON_TASK}/worker/toolu_1`,
    LINK_ROUTED_PLACE.WORKER,
    { kind: LINK_PLACE.WORKER, planId: TASK, agentId: AGENT, callId: "toolu_1" },
  ],
  [
    "a Changes link",
    `${AT_AGENT}/changes`,
    LINK_ROUTED_PLACE.CHANGES,
    { kind: LINK_PLACE.CHANGES, agentId: AGENT },
  ],
  [
    "a Changes link under /plan/",
    `${ON_PLAN}/changes`,
    LINK_ROUTED_PLACE.CHANGES,
    { kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT },
  ],
  [
    "a review thread's link",
    `${AT_AGENT}/changes/files/thread/PRRT_1`,
    LINK_ROUTED_PLACE.PULL_REQUEST_THREAD,
    {
      kind: LINK_PLACE.PULL_REQUEST_THREAD,
      agentId: AGENT,
      threadId: "PRRT_1",
      view: "files",
    },
  ],
  [
    "a review thread's link under its task",
    `${ON_TASK}/changes/conversation/thread/PRRT_1`,
    LINK_ROUTED_PLACE.PULL_REQUEST_THREAD,
    {
      kind: LINK_PLACE.PULL_REQUEST_THREAD,
      planId: TASK,
      agentId: AGENT,
      threadId: "PRRT_1",
      view: "conversation",
    },
  ],
  [
    "a worker of our own under /plan/, read as its task",
    `${LINK_ORIGIN}/acme/plan/${TASK}/worker/toolu_1`,
    LINK_ROUTED_PLACE.TASK,
    { kind: LINK_PLACE.TASK, planId: TASK },
  ],
  [
    "a channel's link, read as the Inbox",
    `${LINK_ORIGIN}/acme/channel/c-1`,
    LINK_ROUTED_PLACE.INBOX,
    { kind: LINK_PLACE.INBOX },
  ],
] as const)(
  "%s written in a part is handed to the window, which matches it on its route tree as that place",
  (_spelling, href, declared, place) => {
    assert.deepEqual(handed(href).map(matched), [{ declared, place }]);
  },
);

test("a link naming a listed task by its number is asked of the place it is pressed on by the task's id", async () => {
  const page = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const acme = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
    memberCount: 1,
  };
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [acme],
        tasks: [
          {
            id: TASK,
            workspaceId: "workspace-acme",
            name: "Teammate invitations",
            createdAt: 1,
            updatedAt: 2,
            repository: "acme/relay",
            number: 42,
          },
        ],
      },
    },
  );
  const asked: LinkPlace[] = [];
  let open: ((href: string) => void) | undefined;
  // Note that the part reads the window's document, so it is read by the press.
  function Opener(): null {
    useQuery({ ...appStateQuery, select: selectRun });
    open = useOpenLink();
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root?.render(
      withQueryClient(
        createElement(
          OpenAddressesHere,
          {
            value: (address) => {
              if (address.kind === ADDRESS.PLACE) asked.push(address.link.place);
              return true;
            },
          },
          createElement(Opener),
        ),
      ),
    ),
  );
  // The window's document lands a few turns after the read is asked.
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  act(() => open?.(`https://vespin.dev/acme/task/42/page/${page}`));

  assert.deepEqual(asked, [{ kind: LINK_PLACE.PAGE, planId: TASK, pageId: page }]);
});

const OTHER = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
const FILE = "https://github.com/acme/relay/blob/HEAD/src/invites.ts";
const APP = "https://vespin.dev/acme";

/** The window's router standing on Acme's Inbox, as it stands under every surface a press opens things beside. */
const ROUTER = createPanelRouter(
  createMemoryHistory({ initialEntries: ["/acme/inbox"] }),
  testQueryClientNow(),
);

/** A task's or an agent's: its repository, and one agent, which opened the pull request numbered 42. */
const HOLDING = {
  repository: "acme/relay",
  pullRequests: new Map([[AGENT, { url: URL }]]),
  agentIds: [AGENT],
  heldIds: undefined,
};

/** The same, its agent archived: no longer drawn, though still held. */
const ARCHIVED = { ...HOLDING, agentIds: [], heldIds: [AGENT] };

const TASK_PAGE: PagesHere = { kind: HERE.TASK, taskId: TASK, ...HOLDING };
const AGENT_PAGE: PagesHere = { kind: HERE.AGENT, agentId: AGENT, ...HOLDING };

/** What the window lists: the task, whose agent opened the pull request at `URL`. */
const WINDOW_LISTED: Listed = {
  tasks: [{ taskId: TASK, pullRequests: [{ url: URL, agentId: AGENT }] }],
};

function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
}

/** What a task's or an agent's page opened beside it: a pull request in an agent's tab, by its number where it is another, or a page read on its place; none where it left the address to the window. */
type OpenedBeside =
  | { readonly pullRequest: readonly [string, number | undefined] }
  | { readonly page: readonly [string, PagePlace] }
  | undefined;

/** What a press on `href` opens beside a task's or an agent's page. */
function openedOnPage(href: string, here: PagesHere): OpenedBeside {
  let opened: OpenedBeside;
  const open = openPullRequestsHere(
    here,
    (agentId, number) => {
      opened = { pullRequest: [agentId, number] };
    },
    (pageId, place) => {
      opened = { page: [pageId, place] };
    },
  );
  const took = open(addressOf(href, ROUTER));
  assert.equal(took, opened !== undefined);
  return opened;
}

test.each<[string, string, PagesHere, OpenedBeside]>([
  [
    "a task: a page under its agent's pull request's, in that agent's own Pull request tab",
    `${URL}/files`,
    TASK_PAGE,
    { pullRequest: [AGENT, undefined] },
  ],
  [
    "a task: another pull request of its repository, by its number in its first agent's tab",
    "https://github.com/acme/relay/pull/41",
    TASK_PAGE,
    { pullRequest: [AGENT, 41] },
  ],
  [
    "a task: a pull request of another repository, the window's",
    "https://github.com/acme/other/pull/41",
    TASK_PAGE,
    undefined,
  ],
  [
    "a task: an archived agent's pull request, merged or not, in its own Pull request tab",
    URL,
    { ...TASK_PAGE, ...ARCHIVED },
    { pullRequest: [AGENT, undefined] },
  ],
  [
    "a task: an app link, to its own page among them, the window's",
    `${APP}/plan/${TASK}/page/${PAGE}`,
    TASK_PAGE,
    undefined,
  ],
  [
    "a task: another task's page, a subtask's among them, beside it read on that task",
    `${APP}/plan/${OTHER}/page/${PAGE}`,
    TASK_PAGE,
    { page: [PAGE, { taskId: OTHER }] },
  ],
  [
    "a task: another task's agent, the window's, which opens it in the middle",
    `${APP}/plan/${OTHER}/agent/${OTHER}`,
    TASK_PAGE,
    undefined,
  ],
  ["a task: a file of its repository, the window's", FILE, TASK_PAGE, undefined],
  [
    "an agent's page: the pull request it opened, in its Pull request tab",
    URL,
    AGENT_PAGE,
    { pullRequest: [AGENT, undefined] },
  ],
  [
    "an agent's page: a task's page, beside it read on that task",
    `${APP}/plan/${TASK}/page/${PAGE}`,
    AGENT_PAGE,
    { page: [PAGE, { taskId: TASK }] },
  ],
  [
    "an agent's page: a page under a task named by a number not found, the window's, which finds the task",
    `${APP}/task/42/page/${PAGE}`,
    AGENT_PAGE,
    undefined,
  ],
  [
    "an agent's page: another pull request of its repository, by its number",
    "https://github.com/acme/relay/pull/41",
    AGENT_PAGE,
    { pullRequest: [AGENT, 41] },
  ],
])("%s", (_, href, here, expected) => {
  assert.deepEqual(openedOnPage(href, here), expected);
});

test("a task's page: a related task's pull request, as its row presses it, the window's, in that task's agent's tab", () => {
  const opened: (readonly [string, number | undefined])[] = [];
  const page = openPullRequestsHere(
    { ...TASK_PAGE, taskId: OTHER, pullRequests: new Map(), agentIds: [OTHER] },
    (agentId, number) => opened.push([agentId, number]),
    () => undefined,
  );
  const { places } = press(URL, (row) => createElement(OpenAddressesHere, { value: page }, row));

  assert.deepEqual(
    { places, opened },
    { places: [{ kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT }], opened: [] },
  );
});

test.each<[string, string, boolean, Route]>([
  [
    "the window: an app link, to its place",
    `${APP}/agent/${AGENT}`,
    true,
    go({ workspace: "acme", place: { kind: LINK_PLACE.AGENT, agentId: AGENT } }),
  ],
  [
    "the window: a plan an older link names, to the plan",
    `luke://plan/${TASK}`,
    true,
    go({ workspace: "", place: { kind: LINK_PLACE.TASK, planId: TASK } }),
  ],
  [
    "the window: a pull request a listed task's agent opened, however spelled, to its Pull request tab on the task",
    `${URL}#issuecomment-1`,
    true,
    go({ workspace: "", place: { kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT } }),
  ],
  [
    "the window: a pull request nothing listed names, to the browser",
    "https://github.com/acme/relay/pull/7",
    true,
    { kind: ROUTE.EXTERNAL, href: "https://github.com/acme/relay/pull/7" },
  ],
  [
    "the window: any other page, to the browser",
    "https://example.com/docs",
    true,
    { kind: ROUTE.EXTERNAL, href: "https://example.com/docs" },
  ],
  [
    "outside the window: an app link, to the browser",
    `${APP}/agent/${AGENT}`,
    false,
    { kind: ROUTE.EXTERNAL, href: `${APP}/agent/${AGENT}` },
  ],
])("%s", (_, href, opensPlaces, expected) => {
  assert.deepEqual(
    throughWindow(
      addressOf(href, ROUTER),
      opensPlaces,
      opensPlaces ? WINDOW_LISTED : undefined,
      ROUTER,
    ),
    expected,
  );
});
