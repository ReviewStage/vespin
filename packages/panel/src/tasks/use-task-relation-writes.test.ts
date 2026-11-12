// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import type { Task } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { handState } from "../testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "../testing/copy-feedback.js";
import { useOpenWorkspaceGitHub } from "./use-task-relation-writes.js";

/**
 * use-task-relation-writes.test.ts -- Connect GitHub under a task opens
 * Settings on the GitHub of the workspace the task is in.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ACME = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("Connect GitHub under a task opens Settings on its workspace's GitHub, read off the open document where the list did not land", async () => {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        listStatus: TASKS_READ.FAILED,
        workspaces: [ACME],
        activeTaskId: TASK.id,
      },
      [LIVE_READ.DESCRIPTION_DOCUMENT]: { [TASK.id]: { rows: { task: TASK } } },
    },
  );
  await writeHandedAppState();
  const links: SettingsLink[] = [];
  let open: ((taskId: string) => void) | undefined;

  const Probe = (): null => {
    open = useOpenWorkspaceGitHub((link) => links.push(link));

    return null;
  };

  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(withQueryClient(createElement(Probe))));

  act(() => (open ?? assert.fail("the hook stands"))(TASK.id));

  assert.deepEqual(links, [
    {
      page: SETTINGS_VIEW.WORKSPACE,
      section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
      workspaceId: ACME.id,
    },
  ]);
});
