// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ApprovalAnswerRequest } from "@repo/features/agent-approval-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentMarkReadParams,
  type ManagerChatReactParams,
  type ManagerChatSending,
} from "@repo/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_KIND,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { CHAT_REACTION_REFUSED_WORDS } from "@repo/features/manager-chat-view";
import { READ_MARK } from "@repo/features/read-mark";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { MESSAGE_ROLE } from "@repo/wire";
import { Effect } from "effect";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { FindScope } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { OpenPersonProvider } from "../person-door.js";
import { FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
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
import { standingToastWords } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { ManagerChatTab, ManagerThreadTab } from "./manager-chat-tab.js";
import { ThreadDoorsProvider } from "./manager-chat-threads.js";

/**
 * manager-chat-tab.test.ts -- a Manager's page as its own chat, drawn from
 * the chat's rows: the reader's messages at the right and everyone else's at
 * the left, each sender named over their run; an ended turn's work a press
 * away from the Manager's first message of the turn, and found by ⌘F; a call the Manager holds for an answer standing at the chat's
 * foot with its answers; Retry sending a refused message again with its
 * files; a 👍 drawn under its message from its press until its ask settles; and a thread opening beside the chat, as the page's side panel
 * opens it, its box the chat's own composer replying in it; and New over
 * the first message after the reader's mark, which Mark as unread moves
 * back and holds there as the page closes. Synthetic words.
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
  vi.unstubAllGlobals();
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
    /** Whether a find may open over the chat, as the page's scope lets ⌘F open one. */
    readonly findable?: boolean;
    /** What a reaction pressed is answered with, once it settles; refused at once where none is named. */
    readonly reactAnswer?: Promise<FakeActAnswer>;
    /** The message whose Mark as unread the service refuses, by its id. */
    readonly unreadRefused?: string;
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
  // Each reaction pressed, as the window asked it.
  const reacted: ManagerChatReactParams[] = [];
  // Each person's page a press opened, by their account.
  const people: string[] = [];
  // Each move of the reader's mark of the chat, as the window asked it.
  const marks: AgentMarkReadParams[] = [];

  fakeActs({
    act: (request) => {
      if (request.kind === ACT_KIND.AGENTS_CHAT_SEND) {
        sent.push(request.payload.text);
        threads.push(request.payload.threadRoot ?? null);
        keys.push([request.payload.clientKey, request.payload.retry === true]);
        carried.push((request.payload.attachments ?? []).map((file) => file.name));
      }

      if (request.kind === ACT_KIND.AGENTS_MANAGER_CHAT_OLDER) older.push(request.payload.before);

      if (request.kind === ACT_KIND.AGENTS_MARK_READ) {
        marks.push(request.payload);

        if (request.payload.unreadFrom?.messageId === held.unreadRefused) {
          return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." });
        }

        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agent: manager } });
      }

      if (request.kind === ACT_KIND.AGENTS_CHAT_REACT) {
        reacted.push(request.payload);

        if (held.reactAnswer !== undefined) return held.reactAnswer;
      }

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
        createElement(
          OpenPersonProvider,
          { value: (userId: string) => people.push(userId) },
          createElement(MemberDirectory, {
            workspace: { id: "workspace-acme", memberCount: 2 },
            readerId: DEAN.userId,
            children: createElement(
              FindScope,
              { active: held.findable === true, subject: { agent: manager.id } },
              createElement(ChatBesideThread, {
                agent: manager,
                control,
                opened: held.opened,
                alone: held.alone === true,
              }),
              createElement(ToastHost),
            ),
          }),
        ),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();

  return { container, root, sent, carried, answered, threads, keys, older, reacted, people, marks };
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

test("each message is a row under its sender's name where their run opens, a teammate's name opens their page, a thread's replies stand under its message as a count that opens the thread beside the chat, and the thread's box replies in it", async () => {
  const { container, sent, threads, people } = await drawChat([
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

  const teammate = [
    ...container.querySelectorAll<HTMLButtonElement>(".ui-channel-message-head button"),
  ].find((button) => button.textContent === CHARLES.name);

  act(() => teammate?.click());
  assert.deepEqual(people, [CHARLES.userId]);

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
    ["Reply in thread", "Copy", "Mark as unread"],
  );

  act(() => items[0]?.click());
  await settleQueries();

  assert.ok(container.querySelector("[data-thread-tab]"), "the thread opens beside the chat");
});

/** The words of the row New stands over, none where it stands nowhere. */
function newOver(container: Element): string | null | undefined {
  return container
    .querySelector(".ui-new-messages-rule")
    ?.parentElement?.querySelector(".ui-channel-message-words")?.textContent;
}

test("New stands over the first message after the mark the page opened on, the reader's own aside, and Mark as unread on their own last line moves the mark back to just before it, New with it, and holds it there as the page closes", async () => {
  const { container, root, marks } = await drawChat(
    [row("first", 1, "On it."), row("second", 2, "Shipped."), row("mine", 3, "Thanks.", DEAN)],
    { manager: { ...MANAGER, readThrough: 1_500, saidAt: 2_000 } },
  );

  assert.equal(newOver(container), "Shipped.");

  const words =
    [...container.querySelectorAll(".ui-channel-message-words")].find(
      (each) => each.textContent === "Thanks.",
    ) ?? assert.fail("the message stands");

  act(() => {
    words.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
    );
  });
  act(() => menuItem("Mark as unread").click());
  await settleQueries();

  assert.equal(newOver(container), "Thanks.");
  act(() => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  await settleQueries();

  assert.deepEqual(marks, [
    { agentId: MANAGER.id, readMark: READ_MARK.READ },
    {
      agentId: MANAGER.id,
      readMark: READ_MARK.UNREAD,
      unreadFrom: { messageId: "mine", sentAt: 3_000 },
    },
  ]);
});

test("a Mark as unread the service refuses lets New go back to where it stood: to an earlier mark the stay holds, which stays held, and else to where the page opened, its looks going on", async () => {
  /** Marks the message holding `text` unread from its menu. */
  const markUnreadOn = async (container: Element, text: string) => {
    const words =
      [...container.querySelectorAll(".ui-channel-message-words")].find(
        (each) => each.textContent === text,
      ) ?? assert.fail("the message stands");

    act(() => {
      words.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
      );
    });
    act(() => menuItem("Mark as unread").click());
    await settleQueries();
  };

  const rows = [row("first", 1, "On it."), row("second", 2, "Shipped.")];
  // The chat opens read, with no New.
  const manager = { ...MANAGER, readThrough: 2_500, saidAt: 2_000 };

  // Marked unread from the second message, then refused on the first: New goes back over the second, held as the page closes.
  const earlier = await drawChat(rows, { manager, unreadRefused: "first" });
  await markUnreadOn(earlier.container, "Shipped.");
  await markUnreadOn(earlier.container, "On it.");
  const heldOver = newOver(earlier.container);
  act(() => earlier.root.unmount());
  roots.splice(roots.indexOf(earlier.root), 1);
  await settleQueries();

  // Refused with nothing marked before: New goes back to where the page opened, nowhere, and its looks go on.
  const alone = await drawChat(rows, { manager, unreadRefused: "first" });
  await markUnreadOn(alone.container, "On it.");
  const openedOver = newOver(alone.container);
  act(() => alone.root.unmount());
  roots.splice(roots.indexOf(alone.root), 1);
  await settleQueries();

  assert.deepEqual(
    [
      heldOver,
      earlier.marks.map((mark) => mark.readMark),
      openedOver,
      alone.marks.map((mark) => mark.readMark),
    ],
    [
      "Shipped.",
      [READ_MARK.READ, READ_MARK.UNREAD, READ_MARK.UNREAD],
      undefined,
      [READ_MARK.READ, READ_MARK.UNREAD, READ_MARK.SEEN, READ_MARK.SEEN],
    ],
  );
});

test("a chat the reader marked unread from their own last line opens with New over it", async () => {
  const { container } = await drawChat(
    [row("first", 1, "On it."), row("mine", 2, "Thanks.", DEAN)],
    { manager: { ...MANAGER, readThrough: 1_999, saidAt: 1_000, markedUnread: true } },
  );

  assert.equal(newOver(container), "Thanks.");
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

test("an ended turn's work is offered as Show work beside the Manager's first message of the turn and in its menu, which opens it under the message and folds it again", async () => {
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

  const then =
    container.querySelector('[data-message-id="then"]') ?? assert.fail("the turn's next message");

  assert.equal(first.querySelector('[data-call-id="list-1"]'), null, "closed until asked");

  pointerCross(document.body, then);
  assert.equal(
    then.querySelector('button[aria-label="Show work"]'),
    null,
    "only the turn's first message offers its work",
  );

  pointerCross(then, first);

  const show =
    first.querySelector<HTMLButtonElement>('button[aria-label="Show work"]') ??
    assert.fail("Show work stands beside the message");

  await act(async () => show.click());
  await settleQueries();

  const bubble =
    [...first.querySelectorAll(".ui-channel-message-words")].find(
      (each) => each.textContent === "The invite flow.",
    ) ?? assert.fail("the message's words");

  const call =
    first.querySelector('[data-call-id="list-1"]') ?? assert.fail("the turn's call opens");

  assert.ok(
    bubble.compareDocumentPosition(call) & Node.DOCUMENT_POSITION_FOLLOWING,
    "under the message's words",
  );

  act(() => {
    bubble.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
    );
  });
  await act(async () => menuItem("Hide work").click());
  await settleQueries();

  assert.equal(first.querySelector('[data-call-id="list-1"]'), null, "the menu folds it away");
});

test("⌘F finds words in an ended turn's work while it stands closed, deep in a call's long output, and opens it under the message as Show work does", async () => {
  // jsdom paints no highlights; the find's are kept as a browser keeps them.
  vi.stubGlobal("CSS", { highlights: new Map(), escape: (words: string) => words });
  vi.stubGlobal("Highlight", Set);
  Range.prototype.getBoundingClientRect = () => new DOMRect();

  const { container } = await drawChat(
    [
      row("ask", 1, "What first?", DEAN),
      { ...row("told", 2, "The invite flow."), turnId: "turn-1" },
    ],
    {
      findable: true,
      transcript: [
        {
          id: "turn-1",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            { type: "step-start" },
            {
              type: "tool-run_command",
              toolCallId: "run-1",
              state: "output-available",
              input: { command: "cat invites.log" },
              // Note that the match stands past the 40 lines a code card shows before its cut, which a find opens too.
              output: Array.from({ length: 60 }, (_, at) =>
                at === 50 ? "the lantern invite" : `invite ${at}`,
              ).join("\n"),
            },
          ],
          startedAt: 1_000,
          finishedAt: 79_000,
        },
      ],
    },
  );

  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });

  const field =
    document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]') ??
    assert.fail("the find bar stands open");

  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field,
      "lantern",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settleQueries();

  assert.equal(
    document.querySelector('[role="search"][aria-label="Find"] .ui-search-field-tally')
      ?.textContent,
    "1 of 1",
  );

  const work =
    container.querySelector('[data-message-id="told"] [data-turn-work]') ??
    assert.fail("the turn's work is drawn");

  assert.equal(work.hasAttribute("hidden"), false, "and shown, the match in it");

  const told = container.querySelector('[data-message-id="told"]') ?? assert.fail("the message");
  pointerCross(document.body, told);
  assert.ok(
    told.querySelector('button[aria-label="Hide work"]'),
    "its press now folds the work away, as once Show work opened it",
  );
});

test("a 👍 pressed beside a message stands under it at once as the reader's, and goes once the service refuses it, saying so", async () => {
  const { promise: reactAnswer, resolve: answer } = Promise.withResolvers<FakeActAnswer>();

  const { container, reacted } = await drawChat(
    [row("ask", 1, "What first?", DEAN), row("told", 2, "The invite flow.")],
    { reactAnswer },
  );

  const message = container.querySelector('[data-message-id="told"]');
  assert.ok(message, "the message is drawn");

  /** The reactions under the message, by what each says to a reader. */
  const reactions = () =>
    [...message.querySelectorAll(".ui-reactions button")].map((chip) =>
      chip.getAttribute("aria-label"),
    );

  assert.deepEqual(reactions(), []);
  pointerCross(document.body, message);
  const thumbsUp = message.querySelector<HTMLButtonElement>('button[aria-label="Thumbs up"]');
  assert.ok(thumbsUp, "Thumbs up stands beside the message");
  await act(async () => thumbsUp.click());
  // Note that the press is written to the document at once but drawn one notify tick later, which a loaded runner can stretch.
  await settleQueries();

  assert.deepEqual(reacted, [
    { agentId: MANAGER.id, messageId: "told", kind: "thumbsup", reacted: true },
  ]);
  assert.deepEqual(reactions(), ["You reacted with thumbs up"]);
  assert.equal(thumbsUp.getAttribute("aria-pressed"), "true");

  // The service refuses it, which the host answers rather than fails, and the chat it holds never carried it.
  await act(async () =>
    answer({ status: FAKE_ANSWER.DONE, value: { failure: AGENT_CALL_FAILURE.UNANSWERED } }),
  );
  await settleQueries();
  assert.deepEqual(reactions(), []);
  assert.deepEqual(standingToastWords(), [CHAT_REACTION_REFUSED_WORDS]);
});

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
