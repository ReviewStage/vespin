// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE, INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_TAKE_BACK,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState, stateWith } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { standingToastWords } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { UNDO_RAN, undoLast } from "../undo-stack.js";
import { type InboxReadMarks, type MarkSaying, useInboxReadMarks } from "./use-inbox-read-marks.js";

/**
 * use-inbox-read-marks.test.ts -- the Inbox's read marks say a refusal
 * once, unless the caller says it itself, Mark all as read names the
 * unread items it marks, which the host draws read, and acknowledges the
 * reader's notices with an Undo that takes them back at the service, and
 * ⌘Z puts back the reminder a new one replaced.
 * Synthetic plan and items.
 */

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-acme",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** An item of the plan's, open and asking words, read or unread as given. */
function item(id: string, unread: boolean): InboxItem {
  return {
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "Alert at 80%?",
    needsReply: true,
    thread: [
      {
        id: `e${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Alert at 80%, or later?",
        ask: { type: INBOX_ASK.ANSWER, status: INBOX_ASK_STATUS.OPEN },
        createdAt: 1_000,
      },
    ],
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    unread,
  };
}

/** The item given as a notice: its message asking nothing, and its agent not waiting to hear back. */
function notice(asked: InboxItem): InboxItem {
  const [opening] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with a message");
  const { ask: _ask, ...said } = opening;
  return { ...asked, needsReply: false, thread: [said] };
}

const X = "a1b2c3d4-0000-4000-8000-000000000001";
const Y = "a1b2c3d4-0000-4000-8000-000000000002";
const Z = "a1b2c3d4-0000-4000-8000-000000000003";
const W = "a1b2c3d4-0000-4000-8000-000000000004";
const V = "a1b2c3d4-0000-4000-8000-000000000005";
const U = "a1b2c3d4-0000-4000-8000-000000000006";
/** The revision the agent has since moved a notice on from, so the service takes no nod at it and answers the notice still open. */
const MOVED_ON = 2;
const READER = "user-reader";

/** One write the hook sent, and how to answer it. */
interface Sent {
  readonly words: string;
  readonly answer: (failed?: boolean) => Promise<void>;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/** The hook, every write it sends held until the test answers it. */
function marks() {
  const sent: Sent[] = [];
  /** Each held nod's item, by the key it went under. */
  const keys = new Map<string, string>();
  /** Each take-back sent, by its item, and whether it named the key its nod went under. */
  const tookBack: string[] = [];
  /** One write held until the test answers it, with the value it answers when it does not fail. */
  const sending = <Value>(words: string, value: Value) =>
    new Promise<Value | { failure: typeof AGENT_CALL_FAILURE.UNANSWERED }>((resolve) => {
      sent.push({
        words,
        answer: async (failed = false) => {
          await act(async () => {
            resolve(failed ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : value);
            for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
          });
        },
      });
    });
  fakeActPort({
    [ACT_KIND.AGENTS_INBOX_READ_ALL]: ({ workspaceId, itemIds }) =>
      sending(`all:${workspaceId}:${itemIds.join(",")}`, { marked: 1 }),
    [ACT_KIND.AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) =>
      sending(`${unread ? "unread" : "read"}:${itemId}`, { id: itemId, unread }),
    [ACT_KIND.AGENTS_INBOX_ANSWER]: ({ itemId, revision, reply, clientKey }) => {
      keys.set(clientKey, itemId);
      return sending(`${reply}:${itemId}@${revision}`, {
        item: item(itemId, false),
        taken: revision !== MOVED_ON,
      });
    },
    [ACT_KIND.AGENTS_INBOX_TAKE_BACK]: ({ itemId, clientKey }) => {
      tookBack.push(`${itemId === keys.get(clientKey) ? "taken back" : "wrong key"}:${itemId}`);
      return Promise.resolve({ item: item(itemId, false), outcome: INBOX_TAKE_BACK.TAKEN });
    },
  });
  let control: InboxReadMarks | undefined;
  function Harness() {
    control = useInboxReadMarks({ workspaceId: TASK.workspaceId, readerId: READER });
    return createElement(Fragment, null, createElement(ToastHost));
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(withQueryClient(createElement(Harness))));
  const held = () => control ?? assert.fail("the hook stands");
  return {
    sent,
    tookBack,
    /** The hook's presses as it stands. */
    get marks() {
      return held();
    },
    mark: (target: InboxItem, unread: boolean, saying?: MarkSaying) =>
      act(() => {
        void held().onMark(target, unread, saying);
      }),
    /** What each toast standing says, leaving out those on their way out. */
    toasts: () => standingToastWords(),
    markAll: (items: readonly InboxItem[]) => act(() => held().onMarkAll(items)),
  };
}

/** Lets the writes queued so far reach the act. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("a mark the service refused says so once, and Mark all as read names the unread items it marks and counts them refused", async () => {
  const hook = marks();
  hook.mark(item(X, false), true);
  await settle();
  await hook.sent[0]?.answer(true);
  assert.deepEqual(hook.toasts(), ["Could not mark 1 item unread"]);
  hook.markAll([item(X, false), item(Y, true)]);
  await settle();
  assert.deepEqual(
    hook.sent.map((each) => each.words),
    [`unread:${X}`, `all:${TASK.workspaceId}:${Y}`],
  );
  await hook.sent[1]?.answer(true);
  assert.deepEqual(hook.toasts(), ["Could not mark 1 item unread", "Could not mark 1 item read"]);
});

test("Mark all as read acknowledges the reader's notices, read or not or their reminder come due, leaving a question asking and a notice put away under a reminder still ahead, the nods under one Undo toast, and says a refused nod and a notice changed since as not taken", async () => {
  const hook = marks();
  const reminded = { ...notice(item(W, false)), remindAt: Date.UTC(2099, 0, 1) };
  const due = { ...notice(item(V, false)), remindAt: Date.UTC(2000, 0, 1) };
  const changed = { ...notice(item(U, false)), revision: MOVED_ON };
  hook.markAll([
    item(X, true),
    notice(item(Y, false)),
    notice(item(Z, true)),
    reminded,
    due,
    changed,
  ]);
  await settle();
  assert.deepEqual(hook.sent.map((each) => each.words).toSorted(), [
    `acknowledged:${Y}@1`,
    `acknowledged:${Z}@1`,
    `acknowledged:${V}@1`,
    `acknowledged:${U}@${MOVED_ON}`,
    `all:${TASK.workspaceId}:${X},${Z}`,
  ]);
  assert.deepEqual(hook.toasts(), ["4 items acknowledged"]);
  const nodOnY = hook.sent.find((each) => each.words === `acknowledged:${Y}@1`);
  await hook.sent.find((each) => each.words === `acknowledged:${Z}@1`)?.answer();
  await nodOnY?.answer(true);
  await hook.sent.find((each) => each.words === `acknowledged:${V}@1`)?.answer();
  await hook.sent.find((each) => each.words === `acknowledged:${U}@${MOVED_ON}`)?.answer();
  assert.deepEqual(hook.toasts(), ["4 items acknowledged", "2 items acknowledged, 2 could not be"]);
});

test("Undo after marking a notice read takes its Got it back at the service by its key, leaving the read mark", async () => {
  const hook = marks();
  hook.mark(notice(item(Y, true)), false);
  await settle();
  assert.deepEqual(hook.toasts(), ["Acknowledged “Alert at 80%?”"]);
  await act(() => undoLast());
  assert.deepEqual(hook.tookBack, [`taken back:${Y}`]);
  assert.deepEqual(
    hook.sent.map((each) => each.words),
    [`acknowledged:${Y}@1`, `read:${Y}`],
  );
});

test("a refused mark from a caller that says the refusal itself toasts nothing, and still answers not kept", async () => {
  const hook = marks();
  let answered: boolean | undefined;
  act(() => {
    void hook.marks.onMark(item(X, false), true, { quiet: true }).then((mark) => {
      answered = mark.kept;
    });
  });
  await settle();
  await hook.sent[0]?.answer(true);
  assert.equal(answered, false);
  assert.deepEqual(hook.toasts(), []);
});

test("⌘Z puts back the reminder a new one replaced, through the undo stack", async () => {
  const EARLIER = Date.UTC(2026, 10, 9, 9);
  const LATER = Date.UTC(2026, 10, 16, 9);
  // The window's document holds the item in the account's feed, reminded as given, as the host draws a reminder the moment it is asked.
  const holding = (remindAt: number): AppStateSnapshot =>
    stateWith(
      {},
      {
        [LIVE_READ.INBOX_ITEMS]: {
          rows: {
            [INBOX_SCOPE_KIND.PLAN]: { [TASK.id]: [{ ...item(X, false), remindAt }] },
          },
        },
      },
    );
  const sent: (number | null)[] = [];
  fakeActPort({
    [ACT_KIND.AGENTS_INBOX_REMIND]: ({ itemId, until }) => {
      sent.push(until);
      writeAppState(holding(until ?? 0));
      return Promise.resolve({ id: itemId, unread: false });
    },
  });
  handState({}, holding(EARLIER));
  writeAppState(holding(EARLIER));
  let control: InboxReadMarks | undefined;
  function Harness() {
    control = useInboxReadMarks({ workspaceId: TASK.workspaceId, readerId: READER });
    return createElement(Fragment, null, createElement(ToastHost));
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(withQueryClient(createElement(Harness))));

  await act(() => control?.onRemind({ ...item(X, false), remindAt: EARLIER }, LATER));
  const undone = await act(() => undoLast());

  assert.equal(undone, UNDO_RAN.APPLIED);
  assert.deepEqual(sent, [LATER, EARLIER]);
});
