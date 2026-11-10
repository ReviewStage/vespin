// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE, TURN_STATUS } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { menuItem } from "../testing/desktop-inbox.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { AgentTab } from "./agent-tab.js";

/**
 * agent-tab-send.test.ts -- a message sent from an agent's tab stands in
 * its transcript at once as the developer's line, the box empty and taking
 * words, and the row the service writes for it lands in the line's place,
 * drawn once, whichever of the row and the send's answer comes first; a
 * message refused stays where it went, marked Not delivered, whether its tab
 * stood as it landed or not, its alert offering Retry and Edit; the working line stands from the
 * press, before the service takes the line. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const KEY = "d16fbf9e-8c7d-42d0-9abb-be91cf7d8076";

/** When the tests press Send, by a clock they hold still. */
const PRESSED_AT = Date.parse("2026-10-30T15:42:00Z");

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

const MESSAGES: readonly AgentTranscriptMessage[] = [
  { id: "plan", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "# Fix the tile" }] },
  {
    id: "turn-1",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: "Looking at the tile." }],
    startedAt: 2_000,
    finishedAt: 80_000,
  },
];

const TAKEN: AgentAgentAnswer = {
  agent: {
    id: AGENT,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_000,
    status: AGENT_STATUS.RUNNING,
    turnId: null,
  },
};

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  laid?.remove();
  laid = undefined;
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
}

/**
 * The agent's tab, its sends answered only as the test lets it and its
 * transcript pushed with `later` once the test releases it.
 */
async function drawnTab(
  later: readonly AgentTranscriptMessage[],
  agent = AGENT_SUMMARY,
  /** What each page says of the agent: the first, and the one that lands `later`. */
  statuses: readonly [AgentStatus, AgentStatus] = [AGENT_STATUS.COMPLETED, AGENT_STATUS.COMPLETED],
) {
  fakeAppBridge({});
  const answers: ((answer: AgentAgentAnswer) => void)[] = [];
  const sent: { text: string; clientKey: string }[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const page = (messages: readonly AgentTranscriptMessage[], status: AgentStatus) => ({
    messages: [...messages],
    cursor: "2:0",
    status,
    title: null,
  });
  pushedTranscripts(
    () => [page(MESSAGES, statuses[0]), page([...MESSAGES, ...later], statuses[1])],
    {
      page: 1,
      release: released,
    },
  );
  const control = agentsControl({
    agents: [agent],
    onMessage: (_agentId, text, clientKey) => {
      sent.push({ text, clientKey });
      return new Promise((resolve) => answers.push(resolve));
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  let drawn = agent;
  const draw = (open: boolean) =>
    act(async () =>
      root.render(
        withQueryClient(
          createElement(
            "div",
            null,
            open
              ? createElement(AgentTab, {
                  agent: drawn,
                  control,
                  shown: true,
                  onOpenSubagent: () => undefined,
                  onOpenTarget: () => undefined,
                  onHeld: () => undefined,
                })
              : null,
            createElement(ToastHost),
          ),
        ),
      ),
    );
  await draw(true);
  await settle();
  return {
    container,
    sent,
    send: async (words: string) => {
      typeInComposer(container, words);
      pressInComposer(container, "Enter");
      await settle();
    },
    answer: async (index: number, answer: AgentAgentAnswer) => {
      act(() => answers[index]?.(answer));
      await settle();
    },
    landRow: async () => {
      release();
      await settle();
    },
    /** Closes the tab, the window standing, as another tab or task opening does. */
    close: async () => {
      await draw(false);
      await settle();
    },
    /** Opens the tab again in the same window. */
    open: async () => {
      await draw(true);
      await settle();
    },
    /** Draws the agent as its task's list next carries it. */
    row: async (next: AgentSummary) => {
      drawn = next;
      await draw(true);
      await settle();
    },
    /** Draws the agent archived, as its task's list carries it once archived. */
    archive: async () => {
      drawn = { ...agent, archivedAt: 5 };
      await draw(true);
      await settle();
    },
    /** Picks `label` from the menu of the red alert beside the line reading `words`. */
    pick: async (words: string, label: string) => {
      const [line] = [...container.querySelectorAll<HTMLElement>(".is-user")].filter((each) =>
        each.textContent?.includes(words),
      );
      const mark =
        line?.querySelector<HTMLButtonElement>('button[aria-label="Not delivered"]') ??
        assert.fail("the line wears the red alert");
      await act(async () => mark.click());
      await act(async () => menuItem(label).click());
      await settle();
    },
    /** The developer's lines in the transcript reading `words`. */
    lines: (words: string) =>
      [...container.querySelectorAll<HTMLElement>(".is-user")].filter((each) =>
        each.textContent?.includes(words),
      ),
  };
}

/** The row of the transcript's list a line is drawn in. */
function rowOf(line: HTMLElement | undefined): Element {
  return line?.closest("[data-row-key]") ?? assert.fail("the line is drawn in a row of the list");
}

test("a message sent stands in the transcript at once with its time, the box empty and taking words, and its row lands in its place, drawn once, before the send answers", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
  vi.spyOn(Date, "now").mockReturnValue(PRESSED_AT);
  const row: AgentTranscriptMessage = {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Now the dark variant." }],
    clientId: sentLineId(KEY),
    sentAt: 90_000,
  };
  const tab = await drawnTab([row]);
  await tab.send("Now the dark variant.");

  const editor = composerEditor(tab.container);
  assert.equal(editor.textContent, "");
  assert.equal(editor.getAttribute("aria-disabled"), null, "the box takes words");
  assert.equal(document.activeElement, editor, "and keeps the caret");
  const [pending] = tab.lines("Now the dark variant.");
  const drawnAt = rowOf(pending);
  assert.equal(
    drawnAt.querySelector("time")?.getAttribute("datetime"),
    new Date(PRESSED_AT).toISOString(),
    "the press's time stands under it before its row lands",
  );

  await tab.landRow();
  const landed = tab.lines("Now the dark variant.");
  assert.equal(landed.length, 1, "the row takes the line's place rather than standing beside it");
  assert.ok(rowOf(landed[0]) === drawnAt, "in the same row of the list");

  await tab.answer(0, TAKEN);
  assert.equal(tab.lines("Now the dark variant.").length, 1);
});

test("a line whose row landed before its send answered offers Edit only once the service took it, since it may yet withdraw the row", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
  const row: AgentTranscriptMessage = {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Now the dark variant." }],
    clientId: sentLineId(KEY),
    sentAt: 90_000,
  };
  const tab = await drawnTab([row]);
  const edit = () =>
    tab.container.querySelector('[data-message-id="row-1"] button[aria-label="Edit"]');
  await tab.send("Now the dark variant.");
  await tab.landRow();

  assert.ok(edit() === null, "no Edit while the send is out");
  await tab.answer(0, TAKEN);
  assert.ok(edit(), "Edit once the service took it");
});

test("a message sent to an agent at rest draws the working line at once, before the service takes it, counting from the press rather than the turn before it", async () => {
  // The summary still holds the ended turn's start, as the task list does until the line wakes it.
  const tab = await drawnTab([], { ...AGENT_SUMMARY, runStartedAt: 2_000 });
  vi.spyOn(Date, "now").mockReturnValue(PRESSED_AT);
  assert.equal(tab.container.querySelector("[data-working]"), null, "an agent at rest");

  await tab.send("Now the dark variant.");

  const working = tab.container.querySelector("[data-working]");
  assert.ok(working, "working from the press");
  assert.equal(working.querySelector("time")?.textContent, "0s", "counted from the press");
  assert.equal(tab.sent.length, 1, "with the send still unanswered");
});

test("a Codex or Claude Code agent's box says nothing under it of the plan that pays", async () => {
  for (const runtime of [AGENT_RUNTIME.CODEX, AGENT_RUNTIME.CLAUDE_CODE]) {
    const tab = await drawnTab([], { ...AGENT_SUMMARY, runtime });
    const box = composerEditor(tab.container).closest(".agent-composer") ?? tab.container;
    for (const words of ["Codex plan", "Claude plan", "Manage usage"]) {
      assert.ok(!box.textContent?.includes(words), `${runtime} draws no "${words}"`);
    }
  }
});

test("two messages of the same words are two lines, each let go by its own row alone", async () => {
  const keys = [
    "e27a0caf-9d8e-43e1-8bcc-cfa2d08e9187",
    "f38b1db0-ae9f-44f2-9cdd-d0b3e19fa298",
  ] as const;
  const mint = vi.spyOn(crypto, "randomUUID");
  for (const key of keys) mint.mockReturnValueOnce(key);
  const row: AgentTranscriptMessage = {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "ok" }],
    clientId: sentLineId(keys[0]),
  };
  const tab = await drawnTab([row]);
  await tab.send("ok");
  await tab.send("ok");
  assert.equal(tab.lines("ok").length, 2);

  await tab.landRow();
  await tab.answer(0, TAKEN);
  assert.equal(tab.lines("ok").length, 2, "the first row lets go of the first line alone");
  assert.deepEqual(
    tab.sent.map((each) => each.clientKey),
    [...keys],
    "and the second went once the first answered",
  );
});

/** What the time under a line is led by where it did not go, said as an alert. */
function statusOf(line: HTMLElement | undefined): string | null | undefined {
  return line?.querySelector('.ui-message-line [role="alert"]')?.textContent;
}

test("a message refused stays where it went, marked Not delivered, the box empty, and its alert's Retry sends it again under its key as the newest line", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.send("Then fix CI");

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(
    composerEditor(tab.container).textContent,
    "",
    "the words never come back into the box",
  );
  assert.equal(statusOf(tab.lines("Rebase on main")[0]), "Not delivered");
  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Then fix CI"],
    "the line behind it still goes",
  );
  await tab.answer(1, TAKEN);

  await tab.pick("Rebase on main", "Retry");
  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Then fix CI", "Rebase on main"],
  );
  assert.equal(tab.sent[2]?.clientKey, tab.sent[0]?.clientKey);
  const order = [...tab.container.querySelectorAll(".is-user")].map((each) => each.textContent);
  assert.ok(
    order.findIndex((words) => words?.includes("Rebase on main")) >
      order.findIndex((words) => words?.includes("Then fix CI")),
    "the line tried again stands last",
  );
  assert.equal(statusOf(tab.lines("Rebase on main")[0]), undefined, "and is on its way again");
});

test("a message the plan's usage limit refused says the limit's words where Not delivered stands, its mark's Retry sending it again", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");

  await tab.answer(0, {
    failure: AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED,
    resetsAt: Date.UTC(2026, 10, 10, 4),
  });
  const [line] = tab.lines("Rebase on main");
  assert.match(statusOf(line) ?? "", /^Usage limit reached · Resets /u);

  const mark =
    line?.querySelector<HTMLButtonElement>('button[aria-label^="Usage limit reached"]') ??
    assert.fail("the line's mark is named by the limit's words");
  await act(async () => mark.click());
  await act(async () => menuItem("Retry").click());
  await settle();
  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Rebase on main"],
  );
});

test("Edit takes a message that did not go back into the box, ahead of the words written since, and lets its line go", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  typeInComposer(tab.container, "Then fix CI");

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  await tab.pick("Rebase on main", "Edit");
  assert.equal(tab.lines("Rebase on main").length, 0, "the line is gone");
  pressInComposer(tab.container, "Enter");
  await settle();

  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Rebase on main\n\nThen fix CI"],
  );
  assert.notEqual(tab.sent[1]?.clientKey, tab.sent[0]?.clientKey, "as a message of its own");
});

test("a refusal for good marks the lines refused for now before it as not delivered too, offering no Retry the closed box could not take", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  await tab.send("Then fix CI");
  await tab.answer(1, { failure: AGENT_CALL_FAILURE.AGENT_RETIRED });

  const mark =
    tab
      .lines("Rebase on main")[0]
      ?.querySelector<HTMLButtonElement>('button[aria-label="Not delivered"]') ??
    assert.fail("the earlier line wears the red alert");
  await act(async () => mark.click());
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent),
    [],
    "its menu says why with nothing to press",
  );
});

test("a line refused before its agent was archived offers only Delete, since an archived agent takes no message", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  await tab.archive();

  const mark =
    tab
      .lines("Rebase on main")[0]
      ?.querySelector<HTMLButtonElement>('button[aria-label="Not delivered"]') ??
    assert.fail("the line wears the red alert");
  await act(async () => mark.click());
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent),
    ["Delete"],
  );
});

test("a refusal for good that lands while the tab is closed says the message was not delivered in a toast", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.close();

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.AGENT_RETIRED });

  assert.match(newestToastSays() ?? "", /^Message not delivered/);
});

test("a refusal that lands while the tab is closed is drawn where the line went once the tab opens again, never in the box", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.close();

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  await tab.open();

  assert.equal(statusOf(tab.lines("Rebase on main")[0]), "Not delivered");
  assert.equal(composerEditor(tab.container).textContent, "");
});

test("a line another hand sent after a stopped turn puts the tab to work once the list names the turn it queued: no Stopped under it, and ⌘ turns Send into Queue", async () => {
  const handedOn: AgentTranscriptMessage = {
    id: "row-queued",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Open the pull request." }],
    sentAt: 90_000,
  };
  const stopped: AgentSummary = {
    ...AGENT_SUMMARY,
    status: AGENT_STATUS.CANCELED,
    runtime: AGENT_RUNTIME.CLAUDE_CODE,
    turnId: "7a1c3e5b-2d4f-4b6a-8c0e-1f3a5b7c9d21",
    turn: {
      id: "7a1c3e5b-2d4f-4b6a-8c0e-1f3a5b7c9d21",
      queuedAt: 10_000,
      status: TURN_STATUS.CANCELED,
    },
  };
  const tab = await drawnTab([handedOn], stopped, [AGENT_STATUS.CANCELED, AGENT_STATUS.RUNNING]);
  assert.match(tab.container.textContent ?? "", /Stopped/u, "the stopped turn ends on Stopped");

  await tab.landRow();
  // The list names the turn the line queued, which is what puts the tab to work, whatever the page says.
  const queued = {
    id: "9b2d4f6a-3e5c-4d7b-9f1a-2c4e6a8b0d32",
    queuedAt: 90_000,
    status: TURN_STATUS.QUEUED,
  };
  await tab.row({ ...stopped, status: AGENT_STATUS.RUNNING, turnId: queued.id, turn: queued });
  typeInComposer(tab.container, "Then run the tests.");
  await settle();

  assert.doesNotMatch(tab.container.textContent ?? "", /Stopped/u);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true })));
  assert.ok(
    tab.container.querySelector('button[aria-label="Queue"]'),
    "holding ⌘ turns Send into Queue",
  );
});
