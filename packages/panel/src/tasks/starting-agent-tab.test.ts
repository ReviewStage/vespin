// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentBoot, BOOT_FAILURE, BOOT_PHASE } from "@repo/features/agent-boot";
import { BOOT_WORDS } from "@repo/features/agent-boot-words";
import type { AgentQueue } from "@repo/features/agent-queue-wire";
import { AGENT_BRIEF, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { readingWords } from "@repo/features/words";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts, type ToldPage } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";

/**
 * starting-agent-tab.test.ts -- an agent's tab while its first launch
 * boots, its first page landed or not, reads its empty transcript as read,
 * saying how the boot stands. Synthetic throughout.
 */

const roots: Root[] = [];

// The first line is a reply drawn at once, so the parser lands first, as the panel lands it before a transcript opens.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => installScrollIntoView());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** An agent's own tab drawn over a transcript whose first launch stands as `boot` says, its queue as `queue` says where one is, answered with the words it draws. */
function bootingTabWords(boot: AgentBoot, queue?: AgentQueue): Promise<string> {
  return agentTabWords(AGENT_STATUS.RUNNING, [
    {
      messages: [],
      cursor: "0:0",
      status: AGENT_STATUS.RUNNING,
      title: null,
      boot,
      ...(queue === undefined ? undefined : { queue }),
    },
  ]);
}

/** An agent's own tab, its summary standing at `status` before its first turn, drawn over the transcript `pages` the host tells, answered with the words it draws. */
async function agentTabWords(
  status: AgentSummary["status"],
  pages: readonly ToldPage[],
): Promise<string> {
  fakeAppBridge({});

  const agent: AgentSummary = {
    id: "agent-booting",
    planId: "task-booting",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Fix the tile",
    createdAt: 1_000,
    status,
    turnId: null,
    brief: AGENT_BRIEF.PROMPT,
  };

  pushedTranscripts(() => pages);
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

test("an agent's tab while its first launch boots reads its empty transcript as read, saying its sandbox is starting and no placeholder", async () => {
  const words = await bootingTabWords({ phase: BOOT_PHASE.STARTING, since: Date.now() });

  assert.ok(
    words.includes("Starting a cloud sandbox…"),
    "the empty transcript says where it starts",
  );
  assert.ok(
    !words.includes(readingWords("the transcript")),
    "no placeholder stands for a transcript already read",
  );
});

test("an agent's tab just made, before its first transcript page lands, says Starting… as the start's own tab did rather than a placeholder", async () => {
  const words = await agentTabWords(AGENT_STATUS.STARTING, []);

  assert.ok(
    words.includes("Starting a cloud sandbox…"),
    "the empty transcript says it is starting",
  );
  assert.ok(
    !words.includes(readingWords("the transcript")),
    "no placeholder stands between the start's tab and the agent's",
  );
});

test("an agent's tab whose machine is up says the agent is starting, never counting an edit's wait as starting", async () => {
  // A boot begun ten minutes ago, its first message going now that a long edit to it ended.
  const words = await bootingTabWords({
    phase: BOOT_PHASE.HANDING_OFF,
    since: Date.now() - 600_000,
  });

  assert.ok(words.includes("Starting the agent…"));
  assert.ok(!words.includes("10m"), "the edit's wait is not counted as starting");
});

test("an agent's tab whose machine is up while its first message is held for an edit says it is ready rather than starting", async () => {
  const words = await bootingTabWords(
    { phase: BOOT_PHASE.HANDING_OFF, since: Date.now() },
    {
      revision: 1,
      messages: [{ id: "first", text: "Fix the tile", queuedBy: "user-other", editing: true }],
    },
  );

  assert.ok(words.includes("Ready. The first message is being edited."));
  assert.ok(!words.includes("Starting the agent…"), "nothing is starting while the edit holds it");
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
