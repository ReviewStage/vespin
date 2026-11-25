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
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { FAKE_ANSWER, fakeActs } from "../testing/app-bridge.js";
import { handMembers, handState } from "../testing/app-state.js";
import {
  composerWords,
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
import { ManagerChatTab, ManagerThreadTab } from "./manager-chat-tab.js";
import { ThreadDoorsProvider } from "./manager-chat-threads.js";

/**
 * manager-chat-tab.test.ts -- a Manager's page as its own chat, drawn from
 * the chat's rows: the reader's messages at the right and everyone else's at
 * the left, each sender named over their run; an ended turn's work folded
 * over the Manager's first message of the turn; Reply beside any message,
 * the Manager's or a person's, quoting it whole into the box, which sends it
 * to the chat; a call the Manager holds for an answer standing at the chat's
 * foot with its answers; Retry sending a refused message again with its
 * files; and a thread opening beside the chat, as the page's side panel
 * opens it, its box the chat's own composer replying in it. Synthetic words.
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
    clientKey: `key-${id}`,
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

/**
 * The chat with the thread it opens drawn beside it, as the page's side
 * panel draws a Thread tab (`desktop-agent-page.tsx`), in its own box.
 */
function ChatBesideThread({
  agent,
  control,
  opened,
  alone,
}: {
  agent: AgentSummary;
  control: ReturnType<typeof agentsControl>;
  /** The thread the panel already shows as the page opens, as a tab left open there does. */
  opened: string | undefined;
  /** Whether the thread stands with no chat beside it, as beside the Manager's Overview. */
  alone: boolean;
}): ReactNode {
  const [open, setOpen] = useState<string | undefined>(opened);

  return createElement(
    ThreadDoorsProvider,
    { value: { open, onOpen: setOpen } },
    alone ? null : createElement(ManagerChatTab, { agent, control, shown: true }),
    open === undefined
      ? null
      : createElement(
          "div",
          { "data-thread-tab": "" },
          createElement(ManagerThreadTab, { agent, control, shown: true, root: open }),
        ),
  );
}

/** The Manager's page as Dean sees it, its chat's rows (oldest first here) and the messages on their way held on the app state, over its transcript; every message the box sends to the chat, by its words and its files' names, and every answer to an ask. */
async function drawChat(
  rows: readonly ManagerChatLiveMessage[],
  held: {
    readonly manager?: AgentSummary;
    readonly sending?: readonly ManagerChatSending[];
    readonly transcript?: readonly AgentTranscriptMessage[];
    readonly opened?: string;
    /** Where the page older than `rows` stands, where the chat's start is not read. */
    readonly before?: number;
    /** Whether the thread opened stands with no chat beside it. */
    readonly alone?: boolean;
  } = {},
) {
  const manager = held.manager ?? MANAGER;
  const sent: string[] = [];
  // Each message's files as the box sent them to the chat, by their names.
  const carried: (readonly string[])[] = [];
  const answered: ApprovalAnswerRequest[] = [];
  // The thread each message to the chat replied in, by its root, null for one at the chat's top.
  const threads: (string | null)[] = [];
  // Each message's key, and whether it went as a retry under it.
  const keys: (readonly [string, boolean])[] = [];
  // Each older page asked for, by the `seq` it stands before.
  const older: number[] = [];

  fakeActs({
    act: (request) => {
      if (request.kind === ACT_KIND.AGENTS_CHAT_SEND) {
        sent.push(request.payload.text);
        threads.push(request.payload.threadRoot ?? null);
        keys.push([request.payload.clientKey, request.payload.retry === true]);
        carried.push((request.payload.attachments ?? []).map((file) => file.name));
      }

      if (request.kind === ACT_KIND.AGENTS_MANAGER_CHAT_OLDER) older.push(request.payload.before);

      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." });
    },
  });

  handState(
    {},
    {
      tasks: IDLE_TASKS_VIEW,
      [LIVE_READ.MANAGER_CHAT]: {
        [manager.id]: {
          rows: {
            messages: rows.toReversed(),
            sending: held.sending ?? [],
            ...(held.before === undefined ? undefined : { before: held.before }),
          },
        },
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
          children: createElement(ChatBesideThread, {
            agent: manager,
            control,
            opened: held.opened,
            alone: held.alone === true,
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();

  return { container, sent, carried, answered, threads, keys, older };
}

/** Each row a scope draws, the greeting aside: its sender's name where its run opens, and its words. */
function rowsIn(scope: Element) {
  return [...scope.querySelectorAll(".ui-channel-message")].flatMap((drawn) =>
    drawn.closest("[data-manager-greeting]") === null
      ? [
          [
            drawn.querySelector(".ui-channel-message-head > span")?.textContent?.trim() ?? null,
            drawn.querySelector(".ui-channel-message-words")?.textContent ?? "",
          ],
        ]
      : [],
  );
}

test("each message is a row under its sender's name where their run opens, a thread's replies stand under its message as a count that opens the thread beside the chat, and the thread's box replies in it", async () => {
  const { container, sent, threads } = await drawChat([
    row("dean", 1, "Ship the invite flow.", DEAN),
    row("charles", 2, "Seven days.", CHARLES),
    row("charles-more", 3, "Not five.", CHARLES),
    row("first", 4, "On it."),
    { ...row("asked", 5, "Which repo?", CHARLES), threadRoot: "first" },
    { ...row("answered", 6, "The web app's."), threadRoot: "first" },
  ]);

  assert.deepEqual(rowsIn(container), [
    [DEAN.name, "Ship the invite flow."],
    [CHARLES.name, "Seven days."],
    [null, "Not five."],
    ["Iris", "On it."],
  ]);

  const count = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.endsWith("2 replies") === true,
  );

  assert.ok(count, "the Manager's message says how many replies its thread holds");
  act(() => count.click());
  await settleQueries();

  const thread =
    container.querySelector("[data-thread-tab]") ?? assert.fail("the thread opens beside the chat");

  assert.deepEqual(rowsIn(thread), [
    ["Iris", "On it."],
    [CHARLES.name, "Which repo?"],
    ["Iris", "The web app's."],
  ]);

  /** The presses a box offers beside its field, by their names. */
  const pressesIn = (scope: Element) =>
    [...(scope.querySelector(".agent-tab-foot")?.querySelectorAll("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
    );

  // Note that what acts on the Manager itself stands in the chat's own box alone: its machine, its ports, its model, its MCP servers in the +, and Talk.
  assert.deepEqual(pressesIn(container.querySelector(".agent-tab") ?? container), [
    "Add files and more",
    "Machine: Cloud, Off",
    "Ports: Ports",
    "Opus 5.5 High",
    "Dictate",
    "Composer actions",
    "Talk",
  ]);
  assert.deepEqual(pressesIn(thread), ["Attach files", "Dictate", "Composer actions", "Send"]);

  typeInComposer(thread, "And the nightly?");
  pressInComposer(thread, "Enter");
  await settleQueries();

  assert.deepEqual(sent, ["And the nightly?"]);
  assert.deepEqual(threads, ["first"]);
});

test("a message's menu, a right-click or a long press, leads with Reply in thread, which opens its thread beside the chat", async () => {
  const { container } = await drawChat([row("first", 1, "On it.")]);

  const words =
    [...container.querySelectorAll(".ui-channel-message-words")].find(
      (each) => each.textContent === "On it.",
    ) ?? assert.fail("the message stands");

  act(() => {
    words.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
    );
  });

  const items = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Reply in thread", "Reply", "Copy"],
  );

  act(() => items[0]?.click());
  await settleQueries();

  assert.ok(container.querySelector("[data-thread-tab]"), "the thread opens beside the chat");
});

test("a person's picture stands as its chip where their words name it, not as a marker over a copy of it, and each line they typed stays its own", async () => {
  const { container } = await drawChat([
    {
      ...row("charles", 1, "This [Picture 1] reads wrong.\nTake it?", CHARLES),
      attachments: [{ id: "picture-1", mediaType: "image/png", name: "Picture 1" }],
    },
  ]);

  const words =
    container.querySelector('[data-message-id="charles"] .ui-channel-message-words') ??
    assert.fail("Charles's message is drawn");

  assert.equal(words.querySelector('ul[aria-label="Attached files"]'), null);
  // Note that the chip reads as a picture by its name, as a screen reader hears it.
  assert.deepEqual(
    [...words.querySelectorAll("p")].map(
      (line) => line.innerHTML.includes("<br>") && line.textContent,
    ),
    ["This picture Picture 1 reads wrong.\nTake it?"],
  );
});

test("a message on its way stands in its sender's run as its row will, under the message before it", async () => {
  const { container } = await drawChat(
    [
      row("ask", 1, "Ship the invite flow.", DEAN),
      row("told", 2, "On it."),
      row("seven", 3, "Seven days.", DEAN),
    ],
    {
      sending: [
        {
          clientKey: "9e2f4a6c-1d3b-4e5f-8a7c-0b2d4f6e8a1c",
          text: "Not five.",
          sentAt: 4_000,
          sentBy: DEAN.userId,
        },
      ],
    },
  );

  // Note that the working line the send opens stands under it, which is no message.
  assert.deepEqual(rowsIn(container).slice(0, 4), [
    [DEAN.name, "Ship the invite flow."],
    ["Iris", "On it."],
    [DEAN.name, "Seven days."],
    [null, "Not five."],
  ]);
});

test("a thread's reply the service refused stands marked in its thread, and Retry sends it again there under its own key, with its files", async () => {
  const { container, threads, keys, carried } = await drawChat(
    [
      row("first", 1, "On it."),
      { ...row("asked", 2, "Which repo?", CHARLES), threadRoot: "first" },
    ],
    {
      sending: [
        {
          clientKey: "c4d1e7a2-5b3f-4e9a-8c60-1f2e3d4c5b6a",
          text: "And the nightly?",
          attachments: [{ name: "nightly.png", mediaType: "image/png", data: "bmlnaHRseQ==" }],
          sentAt: 3_000,
          sentBy: DEAN.userId,
          threadRoot: "first",
          refused: { failure: AGENT_CALL_FAILURE.UNANSWERED },
        },
      ],
    },
  );

  assert.equal(
    container.querySelector('button[aria-label="Not delivered"]'),
    null,
    "a reply refused in a thread stands in its thread, not at the chat's end",
  );

  const count = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.endsWith("1 reply") === true,
  );

  assert.ok(count, "the Manager's message says its thread holds a reply");
  act(() => count.click());
  await settleQueries();

  const thread =
    container.querySelector("[data-thread-tab]") ?? assert.fail("the thread opens beside the chat");

  const mark =
    thread.querySelector<HTMLButtonElement>('button[aria-label="Not delivered"]') ??
    assert.fail("the refused reply wears its alert");

  await act(async () => mark.click());
  await act(async () => menuItem("Retry").click());
  await settleQueries();

  assert.deepEqual(threads, ["first"]);
  assert.deepEqual(keys, [["c4d1e7a2-5b3f-4e9a-8c60-1f2e3d4c5b6a", false]]);
  assert.deepEqual(carried, [["nightly.png"]]);
});

test("a thread whose message is gone from the chat, its start read, says so rather than reading on", async () => {
  const { container } = await drawChat([row("first", 1, "On it.")], { opened: "rewound" });

  const thread =
    container.querySelector("[data-thread-tab]") ?? assert.fail("the thread's tab stands");

  assert.match(thread.textContent ?? "", /This thread is no longer in the chat\./u);
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

test("a chat longer than its first page asks once for the page before it as it opens, and one that did not answer offers Retry", async () => {
  const { container, older } = await drawChat([row("later", 7, "Shipped.")], { before: 7 });

  assert.deepEqual(older, [7]);
  assert.ok(
    [...container.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
    "the page that did not answer offers Retry",
  );
});

test("a thread whose message is older than the pages read asks for the page it may stand in, and one that did not answer says so with Retry, which asks again", async () => {
  // Note that the thread stands beside the Manager's Overview, so no chat beside it reads older pages of its own.
  const { container, older } = await drawChat([row("later", 7, "Shipped.")], {
    opened: "first",
    before: 7,
    alone: true,
  });

  const thread =
    container.querySelector("[data-thread-tab]") ?? assert.fail("the thread's tab stands");

  const retry =
    [...thread.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("the page that did not answer offers Retry");

  act(() => retry.click());
  await settleQueries();

  assert.deepEqual(older, [7, 7]);
});

test("Reply on a message in a thread quotes it into the thread's box, and the chat's own box holds nothing of it", async () => {
  const { container } = await drawChat(
    [
      row("first", 1, "On it."),
      { ...row("asked", 2, "Which repo?", CHARLES), threadRoot: "first" },
    ],
    { opened: "first" },
  );

  const thread =
    container.querySelector("[data-thread-tab]") ?? assert.fail("the thread's tab stands");

  const message =
    thread.querySelector('[data-message-id="asked"]') ?? assert.fail("the reply is drawn");

  pointerCross(document.body, message);

  const reply =
    message.querySelector<HTMLButtonElement>('button[aria-label="Reply"]') ??
    assert.fail("Reply stands beside the reply");

  act(() => reply.click());
  await settleQueries();

  const chat = container.querySelector(".agent-tab") ?? assert.fail("the chat stands");
  assert.equal(composerWords(thread).trim(), "Which repo?");
  assert.equal(composerWords(chat), "");
});

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
