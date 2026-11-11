// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentBoot, BOOT_FAILURE, BOOT_PHASE } from "@repo/features/agent-boot";
import { BOOT_WORDS } from "@repo/features/agent-boot-words";
import { QUEUE_WORDS } from "@repo/features/agent-queue-words";
import { AGENT_BRIEF, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { readingWords } from "@repo/features/words";
import { agentTab } from "@repo/ui/tab-strip-model";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { MainTabContent } from "../desktop/main-tabs.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { openingLineOf } from "./agent-model.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { AgentTab, StartingAgentTab, type TranscriptCards } from "./agent-tab.js";

/**
 * starting-agent-tab.test.ts -- the tab of an agent New task is still
 * starting says it is starting over an empty transcript, the developer's
 * words as its queue's row, before the service has made the agent; the
 * column draws a Start on the description still out as that tab under the
 * press's key; and an agent's own tab while its first launch boots reads
 * its empty transcript as read, saying how the boot stands in its centered
 * line. Synthetic throughout.
 */

const roots: Root[] = [];

/** No row of a transcript hangs a card. */
const NO_CARDS: TranscriptCards = {
  target: () => undefined,
  worker: () => undefined,
  agent: () => undefined,
};

// The first line is a reply drawn at once, so the parser lands first, as the panel lands it before a transcript opens.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => installScrollIntoView());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("an agent still starting says so over an empty transcript and draws the words it was started on as its queue's row, never as a line", async () => {
  fakeAppBridge({});
  const prompt = "Make the sidebar keep its folds.";
  const line = openingLineOf({ key: "key-start", prompt, attachments: [] });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(createElement(StartingAgentTab, { line }))));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  const queue = container.querySelector(`[aria-label="${QUEUE_WORDS.LIST}"]`);
  assert.ok(queue?.textContent?.includes(prompt), "the words stand as the queue's row");
  assert.equal(
    container.textContent?.split(prompt).length,
    2,
    "the words are drawn once, in the queue alone",
  );
  assert.ok(
    container.textContent?.includes(BOOT_WORDS.STARTING),
    "the empty transcript says it is starting",
  );
});

/** An agent's own tab drawn over a transcript whose first launch stands as `boot` says, answered with the words it draws. */
async function bootingTabWords(boot: AgentBoot): Promise<string> {
  fakeAppBridge({});
  const agent: AgentSummary = {
    id: "agent-booting",
    planId: "task-booting",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Fix the tile",
    createdAt: 1_000,
    status: AGENT_STATUS.RUNNING,
    turnId: null,
    brief: AGENT_BRIEF.PROMPT,
  };
  pushedTranscripts(() => [
    { messages: [], cursor: "0:0", status: AGENT_STATUS.RUNNING, title: null, boot },
  ]);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
        createElement(AgentTab, {
          agent,
          control: agentsControl({ agents: [agent] }),
          shown: true,
          onOpenSubagent: () => undefined,
          onOpenTarget: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
  return container.textContent ?? "";
}

test("an agent's tab while its first launch boots reads its empty transcript as read, saying Starting… in its centered line and no placeholder", async () => {
  const words = await bootingTabWords({ phase: BOOT_PHASE.STARTING, since: Date.now() });

  assert.ok(words.includes(BOOT_WORDS.STARTING), "the empty transcript says it is starting");
  assert.ok(
    !words.includes(readingWords("the transcript")),
    "no placeholder stands for a transcript already read",
  );
});

test("an agent's tab whose first launch failed says why in its empty transcript, with Retry for its starter", async () => {
  const words = await bootingTabWords({
    phase: BOOT_PHASE.FAILED,
    since: Date.now(),
    failure: BOOT_FAILURE.CHECKOUT_FAILED,
  });

  assert.ok(words.includes("Couldn't start the machine: the repository couldn't be checked out."));
  assert.ok(words.includes(BOOT_WORDS.RETRY), "its starter may boot it again");
});

test("the column draws a Start still out on the description as its agent's tab saying it is starting, under the press's key", async () => {
  fakeAppBridge({});
  const base = agentsControl();
  const agents = agentsControl({
    agentIds: ["press-1"],
    start: { ...base.start, busy: true, pending: { key: "press-1", model: undefined } },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
        createElement(MainTabContent, {
          tab: agentTab("press-1"),
          agents,
          shown: true,
          views: {
            held: NOTHING_HELD,
            standings: new Map(),
            onAgentHeld: () => undefined,
            onWorkerHeld: () => undefined,
            onWorkerStatus: () => undefined,
          },
          onOpenDelegation: () => undefined,
          onOpenTarget: () => undefined,
          cards: { call: NO_CARDS, agent: () => NO_CARDS },
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  assert.match(container.textContent ?? "", /starting/iu);
});
