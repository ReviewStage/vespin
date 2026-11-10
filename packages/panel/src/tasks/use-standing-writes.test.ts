// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import { SETTLED_STATUS } from "@repo/features/tasks-model";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { Option, Schema } from "effect";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { KEPT, type Kept } from "../act.js";
import { type FakeActPort, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { newestToastAction } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { type StandingWrites, useStandingWrites } from "./use-standing-writes.js";

/** The one task the tab draws, at Todo. */
const NOTES = {
  id: "notes",
  workspaceId: "workspace-personal",
  name: "notes",
  createdAt: 4,
  updatedAt: 4,
  repository: null,
  status: TASK_STATUS.TODO,
};

/** The tasks the tab draws: `NOTES` alone. */
const VIEW: TasksView = { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.READY, tasks: [NOTES] };

/** A status write's payload, read back as the act's own schema admits it. */
const readStanding = Schema.decodeUnknownOption(
  Schema.Struct({ taskId: Schema.String, status: Schema.optionalKey(Schema.String) }),
);

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** The standing writes over `VIEW`, drawn under the window's toasts, the act port answering `standing` and writing down each payload. */
function mountWrites(standing: FakeActPort[typeof ACT_KIND.TASKS_SET_STANDING]): {
  writes: () => StandingWrites;
  payloads: unknown[];
} {
  const payloads: unknown[] = [];
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.TASKS_SET_STANDING]: (payload, ...rest) => {
      payloads.push(payload);
      return standing(payload, ...rest);
    },
  });
  let writes: StandingWrites | undefined;
  const Probe = () => {
    writes = useStandingWrites(() => VIEW);
    return null;
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(Fragment, null, createElement(Probe), createElement(ToastHost)),
      ),
    ),
  );
  return { writes: () => writes ?? assert.fail("the writes are drawn"), payloads };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("a member assigned from a chip goes to main with the name the reader knows them by, and a refusal answers so", async () => {
  const { writes, payloads } = mountWrites(() => Promise.resolve(false));
  let kept: Promise<Kept> = Promise.resolve(KEPT);

  await act(async () => {
    kept = writes().onSetTaskStanding(
      NOTES.id,
      { priority: TASK_PRIORITY.URGENT, assigneeId: "user-charles" },
      "Charles",
    );
  });

  assert.deepEqual(payloads, [
    {
      taskId: NOTES.id,
      priority: TASK_PRIORITY.URGENT,
      assigneeId: "user-charles",
      assigneeName: "Charles",
    },
  ]);
  assert.equal((await kept).kept, false);
});

test("Mark done's Undo leaves a status chosen since alone, though that choice is still unanswered", async () => {
  let answered = 0;
  // The Mark done is kept, and the status chosen after it waits on the service.
  const { writes, payloads } = mountWrites(() => {
    answered += 1;
    return answered === 1 ? Promise.resolve(true) : new Promise(() => undefined);
  });

  act(() => writes().onSettleTasks([NOTES.id], SETTLED_STATUS.DONE));
  await settle();
  void writes().onSetTaskStanding(NOTES.id, { status: TASK_STATUS.IN_PROGRESS });
  const undo = newestToastAction();
  assert.ok(undo, "no Undo on the toast");
  assert.equal(undo.textContent, "Undo");
  act(() => undo.click());
  await settle();

  const written = payloads.map((payload) => Option.getOrUndefined(readStanding(payload))?.status);
  assert.deepEqual(written, [TASK_STATUS.DONE, TASK_STATUS.IN_PROGRESS]);
});
