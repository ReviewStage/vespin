// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_BRIEF,
  AGENT_KIND,
  AGENT_STATUS,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { FAKE_ANSWER, fakeActs } from "../testing/app-bridge.js";
import { handMembers, handState } from "../testing/app-state.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { pointerCross } from "../testing/pointer-cross.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { ManagerChatTab } from "./manager-chat-tab.js";

/**
 * manager-chat-tab.test.ts -- a Manager's page as its own chat, drawn from
 * the chat's rows: the reader's messages at the right and everyone else's at
 * the left, each sender named over their run, and Reply beside any message,
 * the Manager's or a person's, quoting it whole into the box, which sends it
 * to the chat. Synthetic words.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
];

const MANAGER: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  taskId: null,
  kind: AGENT_KIND.MANAGER,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Iris",
  createdAt: 1_000,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: AGENT_BRIEF.BLANK,
  startedBy: DEAN,
};

/** One message of the chat, by its id and `seq`, from a person or the Manager, sent a second after the one before it. */
function row(
  id: string,
  seq: number,
  text: string,
  person?: { readonly userId: string; readonly name: string },
): ManagerChatLiveMessage {
  return {
    id,
    seq,
    authorKind: person === undefined ? MANAGER_CHAT_AUTHOR.AGENT : MANAGER_CHAT_AUTHOR.PERSON,
    authorUserId: person?.userId ?? null,
    authorName: person?.name ?? "Iris",
    text,
    attachments: [],
    threadRoot: null,
    broadcast: false,
    turnId: null,
    lineId: null,
    createdAt: seq * 1_000,
    editedAt: null,
  };
}

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
  vi.restoreAllMocks();
});

/** The Manager's page as Dean sees it, its chat's rows (oldest first here) held on the app state, and every message the box sends to the chat, by its words. */
async function drawChat(rows: readonly ManagerChatLiveMessage[]) {
  const sent: string[] = [];

  fakeActs({
    act: (request) => {
      if (request.kind === ACT_KIND.AGENTS_CHAT_SEND) sent.push(request.payload.text);

      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." });
    },
  });

  handState(
    {},
    {
      tasks: IDLE_TASKS_VIEW,
      [LIVE_READ.MANAGER_CHAT]: { [MANAGER.id]: { rows: { messages: rows.toReversed() } } },
    },
  );

  handMembers(() => ({ rows: { members: MEMBERS } }));
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const control = agentsControl({ agents: [MANAGER], me: DEAN.userId });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
        createElement(MemberDirectory, {
          workspace: { id: "workspace-acme", memberCount: 2 },
          readerId: DEAN.userId,
          children: createElement(ManagerChatTab, { agent: MANAGER, control, shown: true }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();

  return { container, sent };
}

test("the reader's message stands at the right, and a teammate's and the Manager's at the left, each named over their run, each message on a bubble of its own", async () => {
  const { container } = await drawChat([
    row("dean", 1, "Ship the invite flow.", DEAN),
    row("charles", 2, "Seven days.", CHARLES),
    row("charles-more", 3, "Not five.", CHARLES),
    row("first", 4, "On it."),
    row("second", 5, "Seven days it is."),
  ]);

  const drawn = [...container.querySelectorAll("[data-message-id]")].map((message) => [
    message.classList.contains("is-user") ? "right" : "left",
    message.querySelector(".ui-chat-bubble")?.textContent ?? "",
    message.querySelector(".ui-message-head-sender")?.textContent?.trim() ?? null,
  ]);

  assert.deepEqual(drawn, [
    ["right", "Ship the invite flow.", null],
    ["left", "Seven days.", CHARLES.name],
    ["left", "Not five.", null],
    ["left", "On it.", "Iris"],
    ["left", "Seven days it is.", null],
  ]);
});

test.each([
  ["the Manager's", "told"],
  ["a teammate's", "seven"],
])(
  "Reply beside %s message quotes the whole message into the box, which sends it to the chat with the words after it",
  async (_sender, messageId) => {
    const told = `**Plan**: the invite flow ships first.\n\n${"Then the reminders, once the invite flow has run a week. ".repeat(6).trim()}`;

    const { container, sent } = await drawChat([
      row("ask", 1, "What first?", DEAN),
      row("told", 2, told),
      row("seven", 3, told, CHARLES),
    ]);

    // The pointer comes onto the message, which draws its actions at once.
    const message = container.querySelector(`[data-message-id="${messageId}"]`);
    assert.ok(message, "the message is drawn");
    pointerCross(document.body, message);

    const reply = message.querySelector<HTMLButtonElement>('button[aria-label="Reply"]');
    assert.ok(reply, "Reply stands beside the message");
    act(() => reply.click());
    await settleQueries();
    typeInComposer(container, "Ship it");
    pressInComposer(container, "Enter");
    await settleQueries();

    assert.deepEqual(sent, [
      `> **Plan**: the invite flow ships first.\n>\n> ${"Then the reminders, once the invite flow has run a week. ".repeat(6).trim()}\n\nShip it`,
    ]);
  },
);
