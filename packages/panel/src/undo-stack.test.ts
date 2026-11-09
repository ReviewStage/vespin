// @vitest-environment jsdom
import assert from "node:assert/strict";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, type TasksPinParams, type TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { createElement } from "react";
import { afterEach, test, vi } from "vitest";
import {
  forgetUndo,
  type HeldWrite,
  type LocalWrite,
  pressHeld,
  pressLocal,
  pressRows,
  pressWrite,
  ROW_WRITE,
  type RowDoors,
  redoLast,
  type TaskRows,
  UNDO_RAN,
  type UndoWrite,
  undoLast,
  withdrawUndo,
} from "./undo-stack.js";

/**
 * undo-stack.test.ts -- ⌘Z and ⇧⌘Z over one task's pin as the window draws
 * it: the keys take the pin back and put it back, a pin after ⌘Z leaves
 * nothing to put back, and a pin taken back since is left alone, as a row
 * entry and as a declared one. The act keeps each pin and draws the task as
 * it leaves it, as the host does. Synthetic throughout.
 */

const TASK_ID = "3f2c8a51-6d0e-4b7a-9c14-2e5f7a9b0d36";

afterEach(forgetUndo);

/** The tasks drawn: the one task, pinned or not. */
function tasksShowing(pinned: boolean): TasksView {
  const task: TaskSummary = {
    id: TASK_ID,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    ...(pinned ? { pinnedAt: 3 } : undefined),
  };
  return { ...IDLE_TASKS_VIEW, tasks: [task] };
}

/** A window drawing the task unpinned, its act keeping each pin and drawing the task as the pin leaves it. */
interface PinWindow {
  readonly doors: RowDoors<TaskRows, typeof ACT_KIND.TASKS_PIN>;
  /** Every pin the act was sent, in order. */
  readonly sent: TasksPinParams[];
  /** Draws the task pinned or not, as another Mac's pin would. */
  readonly show: (pinned: boolean) => void;
}

function standWindow(): PinWindow {
  let drawn = tasksShowing(false);
  const sent: TasksPinParams[] = [];
  const show = (pinned: boolean) => {
    drawn = tasksShowing(pinned);
  };
  const send = (payload: TasksPinParams) => {
    sent.push(payload);
    show(payload.pinned);
    return Promise.resolve(true);
  };
  return { doors: { rows: () => ({ tasks: drawn, held: undefined }), send }, sent, show };
}

/** Pins the task as its menu's Pin does: its row read as pressed, the pin sent, and kept for ⌘Z once the act keeps it. */
async function pin(window: PinWindow): Promise<void> {
  const pressed = pressRows(ROW_WRITE.TASK_PIN, window.doors, [
    { id: TASK_ID, after: { pinned: true, position: null } },
  ]);
  assert.equal(await window.doors.send({ taskId: TASK_ID, pinned: true }), true);
  pressed.keep("Task pinned");
}

test("⌘Z takes the task's pin back, and ⇧⌘Z puts it back", async () => {
  const window = standWindow();
  await pin(window);

  const undone = await undoLast();
  const redone = await redoLast();

  assert.equal(undone, UNDO_RAN.APPLIED);
  assert.equal(redone, UNDO_RAN.APPLIED);
  assert.deepEqual(window.sent, [
    { taskId: TASK_ID, pinned: true },
    { taskId: TASK_ID, pinned: false },
    { taskId: TASK_ID, pinned: true },
  ]);
});

test("a pin after ⌘Z leaves nothing for ⇧⌘Z to put back", async () => {
  const window = standWindow();
  await pin(window);
  await undoLast();
  await pin(window);

  const redone = await redoLast();

  assert.equal(redone, undefined);
  assert.equal(window.sent.length, 3, "a pin, its ⌘Z, and the pin after it, and nothing more");
});

test("⌘Z leaves a pin taken back since, on another Mac, as it stands, and sends nothing", async () => {
  const window = standWindow();
  await pin(window);
  window.show(false);

  const undone = await undoLast();

  assert.equal(undone, UNDO_RAN.CHANGED);
  assert.deepEqual(window.sent, [{ taskId: TASK_ID, pinned: true }]);
});

/** The pin as a declared write, its inverse an unpin of its own, held while the task drawn is pinned. */
const PIN_WRITE = {
  words: "Task pinned",
  unmasked: () => true,
  kind: ACT_KIND.TASKS_PIN,
  read: (_rows, taskId) => taskId,
  act: (send, taskId) => send({ taskId, pinned: true }),
  undo: (send, taskId) => send({ taskId, pinned: false }),
  holds: ({ tasks }, taskId) => tasks.tasks.some((task) => task.id === taskId && task.pinnedAt),
  undone: ({ tasks }, taskId) => tasks.tasks.some((task) => task.id === taskId && !task.pinnedAt),
  refused: (kept) => (kept ? undefined : "The task could not be pinned."),
  surface: FAILURE_SURFACE.TASK_MARK,
} satisfies UndoWrite<TaskRows, string, string, typeof ACT_KIND.TASKS_PIN, boolean>;

test("⌘Z leaves a declared write's target changed since as it stands, and sends nothing", async () => {
  const window = standWindow();
  assert.equal(await pressWrite(PIN_WRITE, window.doors, TASK_ID), true);
  window.show(false);

  const undone = await undoLast();

  assert.equal(undone, UNDO_RAN.CHANGED);
  assert.deepEqual(window.sent, [{ taskId: TASK_ID, pinned: true }]);
});

/** A held write that answers every send at once, its undo once `undoing` settles, each send named in `sent` in order as it is sent. */
function heldWrite(
  sent: string[],
  undoing: Promise<void> = Promise.resolve(),
): HeldWrite<undefined, string, number, number> {
  return {
    words: (itemId) => `Resolved ${itemId}`,
    glyph: () => createElement("span"),
    unmasked: () => true,
    act: (_doors, itemId) => Promise.resolve(sent.push(`act ${itemId}`)),
    letGo: (_doors, itemId) => void sent.push(`let go ${itemId}`),
    undo: (_doors, itemId) => {
      const at = sent.push(`undo ${itemId}`);
      return undoing.then(() => at);
    },
    refused: () => undefined,
    unheld: () => undefined,
  };
}

test("⌘Z takes a held write back once, without letting its hold go, and leaves nothing to put back", async () => {
  const sent: string[] = [];
  await pressHeld(heldWrite(sent), undefined, "item-1");

  const undone = await undoLast();
  const again = await undoLast();
  const redone = await redoLast();

  assert.equal(undone, UNDO_RAN.APPLIED);
  assert.equal(again, undefined);
  assert.equal(redone, undefined);
  assert.deepEqual(sent, ["act item-1", "undo item-1"]);
});

test("once the account changes, an undo queued behind another sends nothing, and a write still out keeps no entry", async () => {
  const sent: string[] = [];
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const window = standWindow();
  await pressHeld(heldWrite(sent, gate), undefined, "item-1");
  await pressHeld(heldWrite(sent, gate), undefined, "item-2");
  const first = undoLast();
  const queued = undoLast();
  await vi.waitFor(() => assert.ok(sent.includes("undo item-2")));
  const pinning = pressWrite(
    { ...PIN_WRITE, act: (send, taskId) => gate.then(() => send({ taskId, pinned: true })) },
    window.doors,
    TASK_ID,
  );
  const pressed = pressRows(ROW_WRITE.TASK_PIN, window.doors, [
    { id: TASK_ID, after: { pinned: true, position: null } },
  ]);

  forgetUndo();
  open();
  await Promise.all([first, queued, pinning]);
  const said = pressed.keep("Task pinned");
  const after = await undoLast();

  assert.deepEqual(sent, ["act item-1", "act item-2", "undo item-2"]);
  assert.equal(said, undefined);
  assert.equal(after, undefined);
  assert.deepEqual(window.sent, [{ taskId: TASK_ID, pinned: true }]);
});

/** A line of held words as a window holds them alone, and its removal of one by key. */
const HELD_REMOVAL = {
  words: "Removed",
  unmasked: () => true,
  act: (held, word) => held.delete(word),
  undo: (held, word) => held.add(word),
  holds: (held, word) => !held.has(word),
  undone: (held, word) => held.has(word),
} satisfies LocalWrite<Set<string>, string>;

test("⌘Z leaves a local write withdrawn by its subject as it stands", async () => {
  const held = new Set(["first"]);
  pressLocal(HELD_REMOVAL, () => held, "first", TASK_ID);
  withdrawUndo(TASK_ID);

  const undone = await undoLast();

  assert.equal(undone, undefined);
  assert.deepEqual([...held], []);
});
