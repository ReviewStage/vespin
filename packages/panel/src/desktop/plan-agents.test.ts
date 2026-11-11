// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type AgentsControl, agentsArchiveMutation } from "../tasks/use-agents.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { item } from "../testing/desktop-inbox.js";
import { agentsControl } from "../testing/tasks-control.js";
import { PlanAgents } from "./plan-agents.js";

/**
 * plan-agents.test.ts -- the plan's agents list those waiting on the
 * developer first, each counting what needs them, then those at work,
 * then the newest started, each saying where it runs itself; a row opens its agent, its ⋯ offers the
 * agent's menu, its pull request's chip opens
 * the pull request and not the agent, and a task with no agent draws no
 * group; New agent stands on the group's head, and on a phone the task's
 * Inbox follows the group only while something waits there that no listed
 * agent's row marks, on a task that starts no agent too; and the agents
 * are chosen together, a row chosen among several offering the acts on
 * every one chosen.
 * Synthetic agents throughout.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** An agent of the plan, started at `createdAt`, standing at `status`. */
function agent(id: string, title: string, createdAt: number, status: AgentSummary["status"]) {
  return {
    id,
    planId: PLAN,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status,
    turnId: null,
  } satisfies AgentSummary;
}

// Note that the oldest ran on a device since removed, and the one at work runs on the member's Studio.
const OLDEST = {
  ...agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d21", "Research providers", 1, AGENT_STATUS.COMPLETED),
  machine: AGENT_MACHINE.DEVICE,
} satisfies AgentSummary;
const WORKING = {
  ...agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d22", "Expired invite page", 2, AGENT_STATUS.RUNNING),
  machine: AGENT_MACHINE.DEVICE,
  mac: { name: "Studio", deviceId: "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11" },
} satisfies AgentSummary;
const NEWEST = agent(
  "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d23",
  "Invite email",
  3,
  AGENT_STATUS.COMPLETED,
);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** `count` threads of the agent given waiting on the developer, by that agent, as `waitingByAgent` hands them. */
function waitingOn(agentId: string, count: number): ReadonlyMap<string, readonly InboxItem[]> {
  const items = Array.from({ length: count }, (_, at) => ({
    ...item(`a1b2c3d4-0000-4000-8000-00000000000${at}`, `Which retry budget, ${at}?`, at),
    agentId,
  }));
  return new Map([[agentId, items]]);
}

/** The group over `agents`, `NEWEST` holding a merged pull request, unfolded unless `folded` says, offering New agent on its head where `newAgent` says, a phone's where `phone` says; every agent, pull request, and start it opens recorded. */
function mount(
  agents: readonly AgentSummary[],
  {
    folded = false,
    newAgent = false,
    phone = false,
    waiting = new Map(),
    acts = {},
  }: {
    folded?: boolean;
    newAgent?: boolean;
    phone?: boolean;
    waiting?: ReadonlyMap<string, readonly InboxItem[]>;
    /** The agents control's acts the test answers itself. */
    acts?: Partial<AgentsControl>;
  } = {},
) {
  const opened: { agents: string[]; pullRequests: string[]; phone: string[] } = {
    agents: [],
    pullRequests: [],
    phone: [],
  };
  const controlOf = (listed: readonly AgentSummary[]) =>
    agentsControl({
      agents: listed,
      agentIds: listed.map((each) => each.id),
      models: [],
      pullRequests: new Map([
        [
          NEWEST.id,
          {
            number: 42,
            title: "Send the invite email",
            url: "https://github.com/acme/relay/pull/42",
            state: PULL_REQUEST_STATE.MERGED,
            checks: CHECK_SUMMARY.PASSING,
            additions: 10,
            deletions: 2,
            changedFiles: 1,
          },
        ],
      ]),
      ...acts,
    });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // Note that a redraw renders the same group over another list, as the task's agents move under it.
  const redraw = (listed: readonly AgentSummary[]) =>
    act(() =>
      root?.render(
        withQueryClient(
          createElement(PlanAgents, {
            agents: controlOf(listed),
            held: { agents: new Map(), workers: new Map() },
            tab: undefined,
            folded,
            waiting,
            shown: true,
            onOpenAgent: (agentId) => opened.agents.push(agentId),
            onOpenPullRequest: (agentId) => opened.pullRequests.push(agentId),
            newAgent: newAgent
              ? { label: "New agent", onSelect: () => opened.phone.push("new agent") }
              : undefined,
            phone: !phone
              ? undefined
              : {
                  onOpenArchived: (agentId) => opened.agents.push(agentId),
                  onOpenInbox: () => opened.phone.push("inbox"),
                },
          }),
        ),
      ),
    );
  redraw(agents);
  return { host, opened, redraw };
}

/** What a row says but when it last moved, which the fixture's clock leaves at no time worth reading. */
function rowWords(row: Element): string {
  const time = row.querySelector('[data-cell="updated"]')?.textContent ?? "";
  return (row.textContent ?? "").replace(time, "");
}

test("the agents at work come first, then the newest, each saying where it runs, each row and chip opening its own", () => {
  const { host, opened } = mount([OLDEST, WORKING, NEWEST]);
  const list = host.querySelector('[aria-label="Agents"]');
  assert.ok(list !== null);
  const rows = [...list.querySelectorAll("li")].map(rowWords);
  assert.deepEqual(
    rows.map((row) => row.replace("#42", "")),
    ["Expired invite pageStudio", "Invite emailCloud", "Research providersRemoved device"],
  );
  const chip = host.querySelector<HTMLAnchorElement>(
    'a[href="https://github.com/acme/relay/pull/42"]',
  );
  assert.ok(chip !== null);
  act(() => chip.click());
  assert.deepEqual(opened, { agents: [], pullRequests: [NEWEST.id], phone: [] });
  const press = [...list.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(OLDEST.title),
  );
  assert.ok(press !== undefined);
  act(() => press.click());
  assert.deepEqual(opened.agents, [OLDEST.id]);
});

test("an agent's row offers the agent's menu from its ⋯, as its row on a person's page does", () => {
  const { host } = mount([NEWEST]);
  const more = host.querySelector<HTMLButtonElement>('button[aria-label="Agent actions"]');
  assert.ok(more !== null, "the row draws a ⋯");
  act(() => more.click());
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  assert.ok(labels.includes("Rename"));
  assert.ok(labels.includes("Archive"));
  assert.ok(labels.includes("Permanently delete"));
});

test("an agent waiting on the developer comes first, counting what needs them but not naming the thread, and a phone's Inbox row leaves that thread to it", () => {
  const { host } = mount([OLDEST, WORKING, NEWEST], {
    phone: true,
    waiting: waitingOn(OLDEST.id, 1),
  });
  const rows = [...(host.querySelector('[aria-label="Agents"]')?.querySelectorAll("li") ?? [])];
  assert.deepEqual(
    rows.map((row) => rowWords(row).replace("#42", "")),
    [
      "Research providers1 needs youRemoved device",
      "Expired invite pageStudio",
      "Invite emailCloud",
    ],
  );
  assert.doesNotMatch(host.textContent ?? "", /thread needs you/u, "no Inbox row says it again");
});

test("the group starts folded unless the page says otherwise, its head counting the agents", () => {
  const { host } = mount([OLDEST, WORKING, NEWEST], { folded: true });
  const head = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  assert.equal(head?.getAttribute("aria-expanded"), "false");
  assert.match(head?.textContent ?? "", /Agents3/u);
  assert.equal(host.querySelector('[aria-label="Agents"]'), null);
});

test("New agent stands on the group's head, a task with no agent draws the group's head alone, and on a phone the task's Inbox follows only while something waits there", () => {
  const press = (host: HTMLElement, words: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes(words),
    );
    assert.ok(found !== undefined, `the group offers ${words}`);
    act(() => found.click());
  };
  const none = mount([], { newAgent: true, phone: true });
  assert.ok(!none.host.textContent?.includes("need"), "no Inbox row while nothing waits");
  act(() => none.host.querySelector<HTMLButtonElement>("button[aria-label='New agent']")?.click());
  assert.deepEqual(none.opened.phone, ["new agent"], "the empty group's + starts one");
  assert.equal(none.host.querySelector("li"), null, "the empty group draws no row");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const one = mount([OLDEST], { newAgent: true, folded: true });
  act(() => one.host.querySelector<HTMLButtonElement>("button[aria-label='New agent']")?.click());
  assert.deepEqual(one.opened.phone, ["new agent"], "the head's + starts one, the group folded");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // Note that the threads are an agent's the group does not list, an archived one's, so no row marks them.
  const waiting = mount([OLDEST], {
    newAgent: true,
    phone: true,
    waiting: waitingOn(NEWEST.id, 2),
  });
  press(waiting.host, "2 threads need you");
  assert.deepEqual(waiting.opened.phone, ["inbox"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // A task whose agents are all archived starts none, and its waiting threads still stand.
  const archived = mount([], { phone: true, waiting: waitingOn(NEWEST.id, 1) });
  press(archived.host, "1 thread needs you");
  assert.deepEqual(archived.opened.phone, ["inbox"]);
});

test("a group folded before its last agent left stands open again for the next one", () => {
  const { host, redraw } = mount([OLDEST], { newAgent: true });
  const head = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  act(() => (head ?? assert.fail("the group folds")).click());
  redraw([]);
  redraw([NEWEST]);
  assert.match(
    host.querySelector('[aria-label="Agents"]')?.textContent ?? "",
    new RegExp(NEWEST.title, "u"),
    "the next agent's row stands",
  );
});

test("the agents are chosen together by their boxes, and a row chosen among several archives every one chosen at once", async () => {
  const archived: (readonly string[])[] = [];
  const { host, opened } = mount([OLDEST, NEWEST], {
    acts: {
      archiveAgents: agentsArchiveMutation(({ agentIds }) => {
        archived.push(agentIds);
        return Promise.resolve(agentIds.map(() => ({ status: ACTION_RESULT_STATUS.ACCEPTED })));
      }),
    },
  });
  const rows = [...host.querySelectorAll('[aria-label="Agents"] li')];
  for (const title of [OLDEST.title, NEWEST.title]) {
    const box = rows
      .find((row) => row.textContent?.includes(title))
      ?.querySelector<HTMLElement>('[role="checkbox"]');
    act(() => (box ?? assert.fail(`${title} draws its box`)).click());
  }
  assert.deepEqual(opened.agents, [], "choosing opens nothing");

  const more = rows
    .find((row) => row.textContent?.includes(OLDEST.title))
    ?.querySelector<HTMLButtonElement>('button[aria-label="Agent actions"]');
  act(() => (more ?? assert.fail("the row draws a ⋯")).click());
  const menu = document.querySelector('[role="menu"]:not([data-leaving])');
  assert.match(menu?.textContent ?? "", /2 agents/u);
  const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Archive", "Permanently delete"],
  );
  act(() => items[0]?.click());
  await act(async () => undefined);
  assert.deepEqual(archived, [[NEWEST.id, OLDEST.id]]);
});
