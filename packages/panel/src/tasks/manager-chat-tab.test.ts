// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ApprovalAnswerRequest } from "@repo/features/agent-approval-wire";
import { AGENT_CALL_FAILURE, type ManagerChatSending } from "@repo/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_KIND,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { MESSAGE_ROLE } from "@repo/wire";
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
import { menuItem } from "../testing/desktop-inbox.js";
import { pointerCross } from "../testing/pointer-cross.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { ManagerChatTab } from "./manager-chat-tab.js";

/**
 * manager-chat-tab.test.ts -- a Manager's page as its own chat, drawn from
 * the chat's rows: the reader's messages at the right and everyone else's at
 * the left, each sender named over their run; an ended turn's work folded
 * over the Manager's first message of the turn; Reply beside any message,
 * the Manager's or a person's, quoting it whole into the box, which sends it
 * to the chat; a call the Manager holds for an answer standing at the chat's
 * foot with its answers; and Retry sending a refused message again with its
 * files. Synthetic words.
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

/** The Manager's page as Dean sees it, its chat's rows (oldest first here) and the messages on their way held on the app state, over its transcript; every message the box sends to the chat, by its words and its files' names, and every answer to an ask. */
async function drawChat(
  rows: readonly ManagerChatLiveMessage[],
  held: {
    readonly manager?: AgentSummary;
    readonly sending?: readonly ManagerChatSending[];
    readonly transcript?: readonly AgentTranscriptMessage[];
  } = {},
) {
  const manager = held.manager ?? MANAGER;
  const sent: string[] = [];
  // Each message's files as the box sent them to the chat, by their names.
  const carried: (readonly string[])[] = [];
  const answered: ApprovalAnswerRequest[] = [];

  fakeActs({
    act: (request) => {
      if (request.kind === ACT_KIND.AGENTS_CHAT_SEND) {
        sent.push(request.payload.text);
        carried.push((request.payload.attachments ?? []).map((file) => file.name));
      }

      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." });
    },
  });

  handState(
    {},
    {
      tasks: IDLE_TASKS_VIEW,
      [LIVE_READ.MANAGER_CHAT]: {
        [manager.id]: { rows: { messages: rows.toReversed(), sending: held.sending ?? [] } },
      },
    },
  );

  handMembers(() => ({ rows: { members: MEMBERS } }));
  pushedTranscripts(() => [
    {
      messages: [...(held.transcript ?? [])],
      cursor: "1:0",
      status: AGENT_STATUS.COMPLETED,
      title: null,
    },
  ]);

  const control = agentsControl({
    agents: [manager],
    me: DEAN.userId,
    onAnswerApproval: (_agentId, approvalId, request) => {
      answered.push(request);

      return Promise.resolve({ approval: { id: approvalId, status: "allowed" } });
    },
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
        createElement(MemberDirectory, {
          workspace: { id: "workspace-acme", memberCount: 2 },
          readerId: DEAN.userId,
          children: createElement(ManagerChatTab, { agent: manager, control, shown: true }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();

  return { container, sent, carried, answered };
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

test("an ended turn's work stands folded over the Manager's first message of the turn, saying how long the turn worked, and opens onto its calls", async () => {
  const { container } = await drawChat(
    [
      row("ask", 1, "What first?", DEAN),
      { ...row("told", 2, "The invite flow."), turnId: "turn-1" },
      { ...row("then", 3, "Then the reminders."), turnId: "turn-1" },
    ],
    {
      transcript: [
        {
          id: "turn-1",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            { type: "step-start" },
            {
              type: "tool-list_tasks",
              toolCallId: "list-1",
              state: "output-available",
              input: {},
              output: { tasks: [] },
            },
          ],
          startedAt: 1_000,
          finishedAt: 79_000,
        },
      ],
    },
  );

  const first =
    container.querySelector('[data-message-id="told"]') ?? assert.fail("the turn's first message");

  const words = first.textContent ?? "";
  const fold = words.indexOf("Worked for 1m 18s");
  assert.ok(
    fold >= 0 && fold < words.indexOf("The invite flow."),
    "the fold stands over the words",
  );
  assert.equal(
    container.querySelector('[data-message-id="then"]')?.textContent?.includes("Worked for"),
    false,
    "and over the turn's first message alone",
  );
  assert.equal(first.querySelector('[data-call-id="list-1"]'), null, "folded");

  const line = first.querySelector("summary") ?? assert.fail("the fold's line");
  await act(async () => line.click());
  await settleQueries();

  assert.ok(first.querySelector('[data-call-id="list-1"]'), "the fold opens onto the turn's call");
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

test("a call the Manager holds for an answer stands at the chat's foot, whose Allow sends the answer", async () => {
  const { container, answered } = await drawChat([row("told", 1, "Running the invite tests.")], {
    manager: {
      ...MANAGER,
      status: AGENT_STATUS.RUNNING,
      turnId: "turn-1",
      pendingApprovals: [
        {
          id: "0b1c4a39-3b5e-4f7c-9a52-8d4f0e7c2a11",
          toolUseId: "toolu_01InviteTests",
          toolName: "Bash",
          title: "Iris wants to run a command",
          input: { command: "pnpm test src/invites" },
          askedAt: 3_000,
        },
      ],
    },
  });

  const call =
    container.querySelector('[data-call-id="toolu_01InviteTests"]') ?? assert.fail("the held call");

  assert.ok(call.textContent?.includes("Waiting for approval"));

  const allow =
    [...container.querySelectorAll("button")].find((each) => each.textContent === "Allow") ??
    assert.fail("Allow");

  await act(async () => allow.click());
  await settleQueries();

  assert.deepEqual(answered, [{ answer: "allow" }]);
});

test("Retry on a refused message whose file ids this window no longer keeps sends it again with its files, from the host's record", async () => {
  // Note that the host still holds the refused message with its file, as it does once the tab that sent it closed and opened again.
  const { container, sent, carried } = await drawChat([row("ask", 1, "What first?", DEAN)], {
    sending: [
      {
        clientKey: "a3c5e1f0-6b2d-4e8a-9c71-2f4d8b6a0e93",
        text: "Here is the invite mock.",
        attachments: [{ name: "invite.png", mediaType: "image/png", data: "aW52aXRl" }],
        sentAt: 2_000,
        sentBy: DEAN.userId,
        refused: { failure: AGENT_CALL_FAILURE.UNANSWERED },
      },
    ],
  });

  const mark =
    container.querySelector<HTMLButtonElement>('button[aria-label="Not delivered"]') ??
    assert.fail("the refused message wears its alert");

  await act(async () => mark.click());
  await act(async () => menuItem("Retry").click());
  await settleQueries();

  assert.deepEqual(sent, ["Here is the invite mock."]);
  assert.deepEqual(carried, [["invite.png"]]);
});
