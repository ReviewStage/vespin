// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { MergeQueueAnswer } from "@repo/features/merge-queue-wire";
import { MERGE_QUEUE_ENTRY_STATE } from "@repo/features/merge-queue-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT, type ExperimentChoices } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeActPortAnswering } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { drawnSidebar, sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { windowRouter } from "../testing/window-router.js";
import { MergeQueuePage } from "./merge-queue-page.js";

/**
 * merge-queue-page.test.ts -- the Merge queue place stands only behind its
 * experiment: off, the sidebar offers no row for it; on, its row opens the
 * listed workspace's page, which lists each repository's queue front first.
 * Synthetic pull requests throughout.
 */

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** One entry of acme/relay's queue, at `position`, titled `title`. */
function entry(position: number, title: string) {
  return {
    position,
    state: MERGE_QUEUE_ENTRY_STATE.QUEUED,
    enqueuedAt: 1_000,
    pullRequest: {
      number: 40 + position,
      title,
      url: `https://github.com/acme/relay/pull/${40 + position}`,
      author: null,
    },
    task: null,
  };
}

const ANSWER: MergeQueueAnswer = {
  repositories: [
    {
      repository: "acme/relay",
      url: "https://github.com/acme/relay/queue/main",
      entries: [entry(1, "Expire invitations"), entry(2, "Rename the billing job")],
    },
  ],
};

/** Draws `element` on the test's client, waiting out its reads. */
async function drawn(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(element)));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  return container;
}

/** The sidebar's Merge queue row, where it stands. */
function mergeQueueRow(sidebar: HTMLElement): HTMLElement | undefined {
  return [...sidebar.querySelectorAll<HTMLElement>("button")].find(
    (each) => each.textContent?.trim() === "Merge queue",
  );
}

/** The sidebar beside the work, with the account's experiments as given, and where the window then stands. */
async function sidebarWith(experiments: ExperimentChoices) {
  handState(experiments);
  const router = windowRouter(createMemoryHistory({ initialEntries: ["/acme"] }));
  const control = tasksControl({ workspace: ACME, workspaces: [ACME] });

  const sidebar = await drawn(
    drawnSidebar({ ...sidebarProps(control), room: SHELL_ROOM.WIDE }, router),
  );

  return { sidebar, path: () => router.history.location.pathname };
}

test("with the experiment off the sidebar offers no Merge queue; on, its row opens the workspace's page, which lists a repository's entries by title, front first", async () => {
  fakeActPortAnswering((request) =>
    Promise.resolve(request.kind === ACT_KIND.WORKSPACE_MERGE_QUEUE_READ ? ANSWER : undefined),
  );

  const off = await sidebarWith({});
  assert.equal(mergeQueueRow(off.sidebar), undefined);
  act(() => roots.pop()?.unmount());

  const on = await sidebarWith(experimentsOn(EXPERIMENT.MERGE_QUEUE));
  const row = await vi.waitFor(() => mergeQueueRow(on.sidebar) ?? assert.fail("the row stands"));
  act(() => row.click());
  await vi.waitFor(() => assert.equal(on.path(), "/acme/merge-queue"));

  const page = await drawn(
    createElement(MergeQueuePage, { workspaceId: ACME.id, marked: undefined }),
  );

  await vi.waitFor(() =>
    assert.deepEqual(
      [...page.querySelectorAll('[aria-label="acme/relay"] .ui-list-row-title')].map(
        (each) => each.textContent ?? "",
      ),
      ["Expire invitations", "Rename the billing job"],
    ),
  );
});
