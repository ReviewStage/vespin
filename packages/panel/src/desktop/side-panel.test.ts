// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import type { TaskPullRequestLine } from "@repo/features/task-wire";
import { changesTab } from "@repo/ui/tab-strip-model";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { PullRequestCard } from "../tasks/pull-request-card.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { SidePanelControl, SidePanelTab } from "../tasks/use-side-panel.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { agentsControl, sidePanelControl } from "../testing/tasks-control.js";
import {
  ActivityList,
  changesOffers,
  type DrawnTab,
  type SidePanelDrawing,
  useSidePanelDrawing,
} from "./side-panel.js";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** An agent at rest on the task, named by its title. */
function agent(id: string, title: string, createdAt: number): AgentSummary {
  return {
    id,
    taskId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  };
}

/** An open pull request, numbered. */
function pullRequest(number: number, title: string): AgentPullRequest {
  return {
    number,
    title,
    url: `https://github.com/acme/relay/pull/${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 210,
    deletions: 14,
    changedFiles: 6,
  };
}

const FIRST = agent("8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", "Invite flow", 1);
const SECOND = agent("9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32", "Invite fixes", 2);
const THIRD = agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c", "Expiry job", 3);

/** The task's agents, the first two on one pull request and the third on its own. */
function agents(): AgentsControl {
  const shared = pullRequest(41, "Teammate invitations");

  return {
    ...agentsControl(),
    agents: [FIRST, SECOND, THIRD],
    agentIds: [FIRST.id, SECOND.id, THIRD.id],
    pullRequests: new Map([
      [FIRST.id, shared],
      [SECOND.id, shared],
      [THIRD.id, pullRequest(42, "Expire invitations")],
    ]),
  };
}

test("the \"+\" offers each pull request the task's lines name once, an agent's earlier one among them, with the agent that opened it beside it where one of the task's did", () => {
  const control = agents();

  const line = (number: number, agentId?: string): TaskPullRequestLine => ({
    number,
    title: `Pull request ${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 1,
    deletions: 1,
    url: `https://github.com/acme/relay/pull/${number}`,
    ...(agentId === undefined ? undefined : { agentId }),
  });

  const { url: _unlinked, ...unlinked } = line(39);

  const offered = changesOffers(
    [
      line(42, THIRD.id),
      // The third agent's earlier pull request, which its own row no longer names.
      line(40, THIRD.id),
      line(41, FIRST.id),
      { ...line(41, SECOND.id), url: "https://github.com/Acme/Relay/pull/41/files" },
      unlinked,
    ],
    control,
  );

  assert.deepEqual(
    offered.map((offer) => [offer.address.number, offer.label]),
    [
      [42, "Expiry job"],
      [40, undefined],
      [41, "Invite flow"],
    ],
  );
});

test("a pull request's card names the coding agent whose it is on a row by its tile and name, which hang the agent's card and open its tab", async () => {
  const opened: string[] = [];
  const control = agents();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const published = pullRequest(42, "Expire invitations");
  act(() =>
    root.render(
      withQueryClient(
        createElement(PullRequestCard, {
          pullRequest: published,
          place: { taskId: null },
          lines: published,
          files: published.changedFiles,
          agent: {
            subject: agentSubject(control, THIRD.id, NOTHING_HELD, false),
            models: [],
            onOpen: () => opened.push(THIRD.id),
          },
        }),
      ),
    ),
  );
  assert.equal(container.querySelector(".ui-hover-card-name")?.textContent, "Expire invitations");
  assert.equal(
    container.querySelector(".ui-hover-card-note")?.textContent,
    "+210 −14 in 6 files · Checks passing",
  );

  const named = container.querySelector<HTMLButtonElement>(
    '.ui-hover-card-row button[data-actor-ref][data-kind="agent"]',
  );

  assert.ok(named, "the agent is named as an actor");
  assert.equal(named.textContent, "Expiry job");

  restOn(named);
  await act(async () => {
    await Promise.resolve();
  });
  const card = document.querySelector(".ui-tooltip-card [data-agent-card] .ui-hover-card-name");
  assert.equal(card?.textContent, "Expiry job", "the agent's own card hangs from its name");
  act(() => named.click());
  assert.deepEqual(opened, [THIRD.id]);
  act(() => root.unmount());
  container.remove();
});

test("the phone's Activity list hangs each tab's card on its row, as the tab hangs it in the strip", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const tab: SidePanelTab = changesTab({ repository: "acme/relay", number: 42 });

  const strip: DrawnTab[] = [
    {
      tab,
      look: {
        icon: createElement("svg"),
        label: "#42 Expire invitations",
        selected: false,
        card: createElement("div", { "data-pull-request-card": "" }, "Expire invitations"),
        onSelect: () => undefined,
      },
      close: () => undefined,
    },
  ];

  act(() =>
    root.render(
      withQueryClient(
        createElement(ActivityList, { strip, offers: [], onListed: () => undefined }),
      ),
    ),
  );

  const row =
    container.querySelector<HTMLElement>("button.ui-list-row-main") ??
    assert.fail("the tab's row is drawn");

  restOn(row);
  assert.equal(
    document.querySelector(".ui-tooltip-card [data-pull-request-card]")?.textContent,
    "Expire invitations",
  );
  act(() => root.unmount());
  container.remove();
});

test("a panel shut by going to another stop is drawn there no longer, rather than slid out over it", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const shut = sidePanelControl();
  let drawing: SidePanelDrawing | undefined;

  const Drawn = ({ panel }: { panel: SidePanelControl }) => {
    drawing = useSidePanelDrawing(panel);

    return null;
  };

  const draw = (panel: SidePanelControl) => act(() => root.render(createElement(Drawn, { panel })));
  draw({
    ...shut,
    open: true,
    stop: TASK,
    tab: changesTab({ repository: "acme/relay", number: 41 }),
  });
  draw({ ...shut, open: false, stop: "0e9c4b1d-6a2f-4e3b-9c7d-1f2a3b4c5d6e" });
  assert.equal(drawing?.panel, undefined);
  act(() => root.unmount());
  container.remove();
});
