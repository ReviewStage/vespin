// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentAgentAnswer } from "@repo/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { EXPERIMENT, type ExperimentChoices } from "@repo/settings";
import { MESSAGE_ROLE } from "@repo/wire";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";

/**
 * agent-tab-rewind.test.ts -- an edited message sent from an agent's tab asks
 * before it drops the messages after it, as Rewind conversation to here does: Cancel keeps
 * every later message and sends nothing, Send takes the agent back and sends,
 * and the last message is sent at once. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT_SUMMARY: AgentSummary = {
  id: AGENT,
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix the tile",
  createdAt: 1_000,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: AGENT_BRIEF.DESCRIPTION,
};

function line(
  id: string,
  role: AgentTranscriptMessage["role"],
  text: string,
): AgentTranscriptMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
    ...(role === MESSAGE_ROLE.ASSISTANT ? { startedAt: 2_000, finishedAt: 80_000 } : undefined),
  };
}

/** The agent's reply that edited a file, as the transcript carries the edit. */
/** The turn's reply as the service hands it once its runner diffed the turn: five files. */
const EDITED: AgentTranscriptMessage = {
  ...line("reply-2", MESSAGE_ROLE.ASSISTANT, "Dark variant done."),
  changedFiles: {
    total: 5,
    additions: 17,
    deletions: 2,
  },
};

const MESSAGES: readonly AgentTranscriptMessage[] = [
  line("plan", MESSAGE_ROLE.USER, "# Fix the tile"),
  line("reply-1", MESSAGE_ROLE.ASSISTANT, "Looking at the tile."),
  line("middle", MESSAGE_ROLE.USER, "Use the dark variant."),
  line("reply-2", MESSAGE_ROLE.ASSISTANT, "Dark variant done."),
  line("last", MESSAGE_ROLE.USER, "Now ship it."),
];

const REWOUND: AgentAgentAnswer = {
  agent: {
    id: AGENT,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_000,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  },
};

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
}

/**
 * The agent's tab over the transcript, every rewind and send it makes written
 * down in order, a rewind that puts the files back marked `:files`; the
 * reader has the account's experiments named in `experiments` on.
 */
async function drawnTab(
  holdSends = false,
  messages: readonly AgentTranscriptMessage[] = MESSAGES,
  experiments: ExperimentChoices = {},
) {
  const opened: string[] = [];
  const turns: [string, string][] = [];

  const page: TaskMentionsValue = {
    holder: { taskId: TASK },
    taskName: "Fix the tile",
    workspace: "acme",
    repository: "acme/relay",
    text: () => "",
    doors: {
      holder: { taskId: TASK },
      place: { workspace: "acme", repository: "acme/relay" },
      anchors: new Set(),
      onOpenTask: () => undefined,
      onOpenFile: (path) => {
        opened.push(path);
      },
      onOpenTurnChanges: (agentId, messageId) => {
        turns.push([agentId, messageId]);
      },
    },
  };

  if (Object.keys(experiments).length > 0) {
    handState(experiments, {
      tasks: {
        ...IDLE_TASKS_VIEW,
        taskAgents: [
          {
            id: AGENT,
            planId: TASK,
            turnId: null,
            title: AGENT_SUMMARY.title,
            model: AGENT_SUMMARY.model,
            effort: AGENT_SUMMARY.effort,
            status: AGENT_SUMMARY.status,
            createdAt: AGENT_SUMMARY.createdAt,
            workspaceId: "workspace-1",
            repository: "acme/relay",
          },
        ],
      },
    });
  } else {
    fakeAppBridge({});
  }

  const calls: string[] = [];
  pushedTranscripts(() => [
    {
      messages: [...messages],
      cursor: "5:0",
      status: AGENT_STATUS.COMPLETED,
      title: null,
    },
  ]);

  const control = agentsControl({
    agents: [AGENT_SUMMARY],
    onRewind: (_agentId, messageId, restoreFiles) => {
      calls.push(restoreFiles === true ? `rewind:${messageId}:files` : `rewind:${messageId}`);

      return Promise.resolve(REWOUND);
    },
    // The host takes the agent back before a line sent in another's place, then sends it.
    onMessage: (_agentId, { text, rewinds }) => {
      if (rewinds !== undefined) {
        calls.push(
          rewinds.restoreFiles === true
            ? `rewind:${rewinds.messageId}:files`
            : `rewind:${rewinds.messageId}`,
        );
      }

      calls.push(`send:${text}`);

      // A send held never answers, so its line stays sent and not yet read back.
      return holdSends ? new Promise(() => undefined) : Promise.resolve(REWOUND);
    },
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
        createElement(TaskMentions, {
          value: page,
          children: createElement(AgentTab, {
            agent: AGENT_SUMMARY,
            control,
            shown: true,
            onOpenSubagent: () => undefined,
            onOpenTarget: () => undefined,
            onHeld: () => undefined,
          }),
        }),
      ),
    ),
  );
  await settle();

  const message = (id: string) =>
    container.querySelector<HTMLElement>(`[data-message-id="${id}"]`) ??
    assert.fail(`${id} is drawn in the transcript`);

  /** Opens the message for writing again, replaces its words, and presses Send in its box. */
  const editAndSend = async (id: string, words: string) => {
    const edit = message(id).querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
    assert.ok(edit, `${id} offers Edit`);
    await act(async () => edit.click());
    await settle();
    const box = message(id);
    const field = composerEditor(box);
    act(() => field.focus());
    typeInComposer(box, "");
    typeInComposer(box, words);
    pressInComposer(box, "Enter");
    await settle();
  };

  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

  const press = async (name: string) => {
    const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (each) => each.textContent === name,
    );

    assert.ok(button, `the question offers ${name}`);
    await act(async () => button.click());
    await settle();
  };

  /** Sends words from the box at the tab's foot. */
  const sendFromFoot = async (words: string) => {
    typeInComposer(container, words);
    pressInComposer(container, "Enter");
    await settle();
  };

  return { container, calls, opened, turns, message, editAndSend, sendFromFoot, dialog, press };
}

test("sending an edited middle message asks first, and Cancel keeps every later message and sends nothing", async () => {
  const tab = await drawnTab();

  await tab.editAndSend("middle", " and the light one");

  assert.ok(tab.dialog(), "the question stands");
  assert.deepEqual(tab.calls, [], "nothing was cut yet");
  await tab.press("Cancel");

  assert.equal(tab.dialog(), null);
  assert.deepEqual(tab.calls, []);

  for (const id of ["reply-2", "last"]) assert.ok(tab.message(id), `${id} is kept`);
  assert.ok(tab.message("middle").hasAttribute("data-editing"), "the edit stays open");
});

test("Send in the question takes the agent back before the edited message and sends the new words", async () => {
  const tab = await drawnTab();

  await tab.editAndSend("middle", " and the light one");
  await tab.press("Send message");

  assert.deepEqual(tab.calls, ["rewind:middle", "send:Use the dark variant. and the light one"]);
});

test("sending an edited last message sends at once, with no question", async () => {
  const tab = await drawnTab();

  await tab.editAndSend("last", " today");

  assert.equal(tab.dialog(), null);
  assert.deepEqual(tab.calls, ["rewind:last", "send:Now ship it. today"]);
});

test("a line sent and not yet read back follows the last message, so editing it asks first", async () => {
  const tab = await drawnTab(true);

  await tab.sendFromFoot("And the docs.");
  await tab.editAndSend("last", " today");

  assert.ok(tab.dialog(), "the question stands");
  assert.deepEqual(tab.calls, ["send:And the docs."], "nothing was cut yet");
});

test("an edited message whose turn recorded the files offers them back in its box while the reader has the experiment on, and Send in the question hands the choice on with the rewind", async () => {
  const recorded = MESSAGES.map((each) =>
    each.id === "middle" ? { ...each, filesRestorable: true as const } : each,
  );

  const plain = await drawnTab(false, recorded);

  const plainEdit = plain
    .message("middle")
    .querySelector<HTMLButtonElement>('button[aria-label="Edit"]');

  assert.ok(plainEdit);
  await act(async () => plainEdit.click());
  await settle();
  assert.equal(
    plain.message("middle").querySelector('[role="checkbox"]'),
    null,
    "with the experiment off, the box offers no files back",
  );

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const tab = await drawnTab(false, recorded, { [EXPERIMENT.REWIND_FILES]: true });
  const edit = tab.message("middle").querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
  assert.ok(edit);
  await act(async () => edit.click());
  await settle();
  const choice = tab.message("middle").querySelector<HTMLElement>('[role="checkbox"]');
  assert.ok(choice, "the box offers the files back");
  await act(async () => choice.click());
  await settle();
  const box = tab.message("middle");
  act(() => composerEditor(box).focus());
  typeInComposer(box, " and the light one");
  pressInComposer(box, "Enter");
  await settle();
  assert.ok(
    tab.dialog()?.textContent?.includes("The agent's files also go back"),
    tab.dialog()?.textContent ?? "no question stands",
  );
  await tab.press("Send message");

  assert.deepEqual(tab.calls, [
    "rewind:middle:files",
    "send:Use the dark variant. and the light one",
  ]);
});

test("a turn that changed files says how many and its lines added and removed on its Worked for line, naming no file, while the reader has Turn changes on, and says nothing of them while it is off", async () => {
  const edited = MESSAGES.map((each) => (each.id === "reply-2" ? EDITED : each));
  const off = await drawnTab(false, edited);
  assert.equal(off.message("reply-2").querySelector("[data-turn-files]"), null);

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const on = await drawnTab(false, edited, { [EXPERIMENT.TURN_CHANGES]: true });
  const row = on.message("reply-2").querySelector<HTMLElement>("[data-turn-files]");
  assert.ok(row, "the row stands");
  assert.equal(row.querySelector("[data-mention-ref]"), null, "no file is named by chip");
  assert.ok(
    on.message("reply-2").querySelector("[data-turn-foot]")?.textContent?.includes("Worked for"),
    "the count stands on the Worked for line",
  );

  const totals = [...row.querySelectorAll("button")].find(
    (each) => each.textContent === "5 files+17 −2",
  );

  assert.ok(totals, row.textContent ?? "");
  await act(async () => totals.click());
  assert.deepEqual(
    [on.turns, on.opened],
    [[[AGENT, "middle"]], []],
    "the count opens the turn's changes, by the line that opened the turn",
  );
  assert.equal(
    on.message("reply-1").querySelector("[data-turn-files]"),
    null,
    "a turn with no edit draws none",
  );
});
