// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { TASK_SECTION_WRITE, type TaskSectionWrite } from "@repo/features/task-section-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActResult } from "@repo/host/contract";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type FakeActPort, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { signedInAs } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { type PinWrites, usePinWrites } from "./use-pin-writes.js";

/** The account signed in as each case starts. */
const DEAN = signedInAs({ id: "user-1", email: "dean@example.com", name: "Dean" });

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** The pin and section writes, drawn under the window's toasts with `DEAN` signed in, the act port answering `procedures`. */
function mountWrites(procedures: Partial<FakeActPort>): () => PinWrites {
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(DEAN),
  });
  fakeActPort(procedures);
  writeAppState(DEAN);
  let writes: PinWrites | undefined;

  const Probe = () => {
    writes = usePinWrites(() => IDLE_TASKS_VIEW);

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

  return () => writes ?? assert.fail("the writes are drawn");
}

/** An agent's pin the port holds unanswered, answered by its resolver in the order asked. */
function heldAgentPins() {
  const asked: boolean[] = [];
  const answers: ((answer: PortActResult<typeof ACT_KIND.AGENTS_PIN>) => void)[] = [];

  const procedures: Partial<FakeActPort> = {
    [ACT_KIND.AGENTS_PIN]: ({ pinned }) =>
      new Promise((resolve) => {
        asked.push(pinned);
        answers.push(resolve);
      }),
  };

  return { asked, answers, procedures };
}

test("one agent's pins are asked one after another, so the service hears an Unpin pressed before a Pin landed after it", async () => {
  const { asked, answers, procedures } = heldAgentPins();
  const writes = mountWrites(procedures);

  await act(async () => {
    writes().onPinAgent("agent-1", true);
    writes().onPinAgent("agent-1", false);
  });
  const first = [...asked];
  // The first is answered as refused, which is no matter to the order the second is asked in.
  await act(async () => answers[0]?.({ failure: AGENT_CALL_FAILURE.NOT_FOUND }));

  assert.deepEqual(first, [true]);
  assert.deepEqual(asked, [true, false]);
});

test("an agent's pin still waiting its turn when the account changes is never asked, so it lands on no one else's pins", async () => {
  const { asked, answers, procedures } = heldAgentPins();
  const writes = mountWrites(procedures);
  await act(async () => {
    writes().onPinAgent("agent-1", true);
    writes().onPinAgent("agent-1", false);
  });

  act(() =>
    writeAppState(signedInAs({ id: "user-2", email: "teammate@example.com", name: "Teammate" })),
  );
  await act(async () => answers[0]?.({ failure: AGENT_CALL_FAILURE.NOT_FOUND }));

  assert.deepEqual(asked, [true]);
});

test("a pin dragged to a new place the service refuses puts back what the drop placed on this Mac, with a toast", async () => {
  const writes = mountWrites({ [ACT_KIND.TASKS_PIN]: () => Promise.resolve(false) });

  let putBack = 0;
  await act(async () =>
    writes().onMovePins([{ agent: false, id: "task-1", position: "a1" }], () => {
      putBack += 1;
    }),
  );

  assert.equal(putBack, 1);
  assert.equal(newestToastSays(), "The pin could not be moved. Try again.");
});

test("a drag's changes to the sections go to main as one ask, and a refused one says so in a toast", async () => {
  const sent: (readonly TaskSectionWrite[])[] = [];

  const writes = mountWrites({
    [ACT_KIND.TASKS_WRITE_SECTION]: ({ writes }) => {
      sent.push(writes);

      return Promise.resolve(false);
    },
  });

  const make = (id: string, title: string) => ({
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId: "workspace-1",
    title,
  });

  const asked = [
    make("0a1b2c3d-0000-4000-8000-000000000001", "Launch"),
    make("0a1b2c3d-0000-4000-8000-000000000002", "Later"),
  ];

  await act(async () => writes().onWriteSections(asked));

  assert.deepEqual(sent, [asked]);
  assert.equal(newestToastSays(), "Your sections could not be changed. Try again.");
});
