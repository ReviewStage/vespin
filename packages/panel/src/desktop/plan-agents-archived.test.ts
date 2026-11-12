// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_ARCHIVER, AGENT_STATUS, type AgentArchivedBy } from "@repo/features/agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { AgentsControl } from "../tasks/use-agents.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { agentsControl } from "../testing/tasks-control.js";
import { PlanAgents } from "./plan-agents.js";

/**
 * plan-agents-archived.test.ts -- a phone's Overview folds the task's
 * archived agents under Archived, standing as the reader left it; an
 * archived agent's row hangs the agent's tab's card, saying it was
 * archived, and by whom and why where the service said; and a press on it
 * opens the agent, whose tab is gone.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  // Note that the fold is kept in the window's storage, so each test starts with it folded.
  window.localStorage.clear();
});

/** A phone's Overview agents over `agents`, every archived one folded under Archived, `onOpen` hearing an archived row opened. */
function drawPhoneAgents(
  agents: AgentsControl,
  onOpen: (agentId: string) => void = () => undefined,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(PlanAgents, {
          agents,
          held: { agents: new Map(), workers: new Map() },
          tab: undefined,
          folded: false,
          waiting: new Map(),
          shown: true,
          onOpenAgent: () => undefined,
          onOpenPullRequest: () => undefined,
          newAgent: undefined,
          phone: { onOpenArchived: onOpen, onOpenInbox: () => undefined },
        }),
      ),
    ),
  );

  return container;
}

/** The Archived fold's own button, apart from the Agents group's over it. */
function archivedFold(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (button) => button.textContent?.startsWith("Archived") === true,
  );
}

/** The archived agent's row's press. */
function archivedRow(container: HTMLElement): HTMLButtonElement {
  return (
    [
      ...container.querySelectorAll<HTMLButtonElement>('[aria-label="Archived agents"] li button'),
    ].find((button) => button.textContent === "Retry audit") ??
    assert.fail("the archived agent is listed")
  );
}

/** The Overview, its one archived agent drawn, `onOpen` hearing a row opened. */
function drawArchived(onOpen: (agentId: string) => void = () => undefined): HTMLElement {
  const agents = agentsControl({
    archived: [
      {
        id: "agent-8",
        planId: "plan-1",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Retry audit",
        createdAt: 1,
        status: AGENT_STATUS.CANCELED,
        turnId: null,
        archivedAt: 2,
      },
    ],
  });

  return drawPhoneAgents(agents, onOpen);
}

test("the archived agents fold under a group header that counts them folded and lists them unfolded", () => {
  const agent = {
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 1,
    status: AGENT_STATUS.CANCELED,
    turnId: null,
    archivedAt: 2,
  } as const;

  const container = drawPhoneAgents(
    agentsControl({
      archived: [
        { ...agent, id: "agent-1", title: "Retry audit" },
        { ...agent, id: "agent-2", title: "Spike" },
      ],
    }),
  );

  const fold = () => archivedFold(container) ?? assert.fail("Archived is drawn");

  assert.equal(fold().getAttribute("aria-expanded"), "false");
  assert.equal(fold().textContent, "Archived2 archived agents");
  act(() => fold().click());
  assert.equal(fold().getAttribute("aria-expanded"), "true");
  assert.ok(container.querySelector('[aria-label="Archived agents"]'), "the agents are listed");
});

test("an unfolded Archived stands open as the Overview is drawn again, and one never unfolded stays folded", () => {
  const fold = archivedFold;
  const first = drawArchived();
  assert.equal(fold(first)?.getAttribute("aria-expanded"), "false");
  act(() => fold(first)?.click());
  assert.equal(fold(first)?.getAttribute("aria-expanded"), "true");

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  const again = drawArchived();
  assert.equal(fold(again)?.getAttribute("aria-expanded"), "true", "it stands as it was left");
  act(() => fold(again)?.click());

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  assert.equal(fold(drawArchived())?.getAttribute("aria-expanded"), "false", "and folded again");
});

test("an archived agent's row hangs its tab's card beside it, its name and when it was archived", () => {
  const container = drawArchived();
  act(() => archivedFold(container)?.click());
  restOn(archivedRow(container));
  const card = document.querySelector(".ui-tooltip-card [data-agent-card]");
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "Retry audit");
  assert.match(card?.querySelector(".ui-hover-card-corner")?.textContent ?? "", /^Archived · /u);
});

test("a press on an archived agent's row opens it, whose tab is gone", () => {
  const opened: string[] = [];
  const container = drawArchived((agentId) => opened.push(agentId));
  act(() => archivedFold(container)?.click());
  act(() => archivedRow(container).click());
  assert.deepEqual(opened, ["agent-8"]);
});

/** The notes the card hung over the archived agent's row says, with the reader and who archived it given. */
function archivedCardNotes(me: string | undefined, archivedBy: AgentArchivedBy): string[] {
  // Note that each draw unfolds Archived afresh, so the fold the last one kept is let go.
  window.localStorage.clear();

  const agents = {
    ...agentsControl({
      archived: [
        {
          id: "agent-8",
          planId: "plan-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Retry audit",
          createdAt: 1,
          status: AGENT_STATUS.COMPLETED,
          turnId: null,
          archivedAt: 2,
          archivedBy,
        },
      ],
    }),
    me,
  };

  const container = drawPhoneAgents(agents);
  act(() => archivedFold(container)?.click());
  restOn(archivedRow(container));

  return [
    ...document.querySelectorAll(".ui-tooltip-card [data-agent-card] .ui-hover-card-note"),
  ].map((note) => note.textContent ?? "");
}

test("an archived agent's card says who archived it, an agent or Vespin for a member, the reader as you, the reason given, and an archive made with its task", () => {
  const dean = { userId: "user-dean", name: "Dean Stratakos" };

  const byAgent = archivedCardNotes("user-sam", {
    by: AGENT_ARCHIVER.AGENT,
    member: dean,
    agent: { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "Bill by seat" },
    reason: "Its pull request merged.",
  });

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const byApp = archivedCardNotes("user-dean", { by: AGENT_ARCHIVER.APP, member: dean });
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";

  const withTask = archivedCardNotes("user-sam", {
    by: AGENT_ARCHIVER.MEMBER,
    member: dean,
    withTask: true,
  });

  assert.deepEqual(byAgent, [
    "Archived by Bill by seat for Dean Stratakos",
    "Its pull request merged.",
  ]);
  assert.deepEqual(byApp, ["Archived by Vespin for you"]);
  assert.deepEqual(withTask, ["Archived with its task by Dean Stratakos"]);
});
