// @vitest-environment jsdom

import assert from "node:assert/strict";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { type QuickAddStart, useQuickAddStart } from "./use-new-task.js";

/**
 * use-new-task.test.ts -- a group's quick add sends one quiet start in the
 * listed workspace with the group's standing and no agent.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let quickAdd: QuickAddStart | undefined;
let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  fakeAppBridge({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  quickAdd = undefined;
  document.body.innerHTML = "";
});

function Probe({ workspaceId }: { workspaceId: string | undefined }): null {
  quickAdd = useQuickAddStart(workspaceId);

  return null;
}

test("a group's quick add sends one quiet start in the listed workspace with the group's standing and no agent, asking no one assigned as nothing", async () => {
  const sent: unknown[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_START]: (start) => {
      sent.push(start);

      return Promise.resolve({ planId: "task-1" });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(withQueryClient(createElement(Probe, { workspaceId: "workspace-acme" }))));

  let refused: Failure | undefined = { reason: FAILURE_REASON.OTHER, text: "unanswered" };
  await act(async () => {
    refused = await (quickAdd ?? assert.fail("the quick add stands"))("Export invoices as CSV", {
      standing: { status: TASK_STATUS.BACKLOG, priority: TASK_PRIORITY.HIGH, assigneeId: null },
    });
  });

  assert.equal(refused, undefined);
  assert.deepEqual(sent, [
    {
      name: "Export invoices as CSV",
      workspaceId: "workspace-acme",
      status: TASK_STATUS.BACKLOG,
      priority: TASK_PRIORITY.HIGH,
      planning: false,
      quiet: true,
    },
  ]);
});
