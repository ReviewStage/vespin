// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { handState } from "../testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "../testing/copy-feedback.js";
import type { RepositoryChooser } from "./repository-chip.js";
import { useRepositoriesIn } from "./task-repository-menus.js";

/**
 * task-repository-menus.test.ts -- the repository chip's list for a
 * workspace offers the repositories its tasks were about lately that its
 * GitHub reaches, and says whether the account manages it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const PERSONAL = {
  id: "workspace-personal",
  name: "Personal",
  slug: "personal",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const ACME = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

let repositoriesIn: ((workspaceId: string | undefined) => RepositoryChooser) | undefined;
let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  repositoriesIn = undefined;
  document.body.innerHTML = "";
});

function row(id: string, at: number, workspaceId: string, repository: string): TaskSummary {
  return { id, workspaceId, name: id, createdAt: at, updatedAt: at, repository };
}

function Probe(): null {
  repositoriesIn = useRepositoriesIn();

  return null;
}

/** Draws the hook over main's document, its task list as given. */
async function mount(
  tasks: Pick<TasksView, "workspaces" | "tasks">,
): Promise<(workspaceId: string | undefined) => RepositoryChooser> {
  handState({}, { tasks: { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.READY, ...tasks } });
  await writeHandedAppState();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(withQueryClient(createElement(Probe))));

  return repositoriesIn ?? assert.fail("the hook stands");
}

test("a workspace's list is its own tasks' repositories, scoped to it", async () => {
  const chooser = await mount({
    workspaces: [
      { ...PERSONAL, github: { login: "alice", active: true } },
      { ...ACME, github: { login: "acme", active: true } },
    ],
    tasks: [row("notes", 4, PERSONAL.id, "alice/private"), row("alerts", 3, ACME.id, "acme/relay")],
  });

  const personal = chooser(PERSONAL.id);
  const acme = chooser(ACME.id);

  assert.deepEqual([personal.recent, personal.scope], [["alice/private"], PERSONAL.id]);
  assert.deepEqual([acme.recent, acme.scope], [["acme/relay"], ACME.id]);
});

test("a workspace's recent repositories are only those its GitHub reaches, so a task stranded there by #2524 offers its repository to none", async () => {
  const chooser = await mount({
    workspaces: [PERSONAL, { ...ACME, github: { login: "ReviewStage", active: true } }],
    tasks: [
      row("stranded", 5, PERSONAL.id, "ReviewStage/luke"),
      row("alerts", 4, ACME.id, "reviewstage/luke"),
      row("elsewhere", 3, ACME.id, "octo/site"),
    ],
  });

  assert.deepEqual(
    chooser(PERSONAL.id).recent,
    [],
    "a workspace with no GitHub connected reaches none",
  );
  assert.deepEqual(chooser(ACME.id).recent, ["reviewstage/luke"]);
});

test("newer tasks on repositories a workspace does not reach crowd out none it does, and a suspended GitHub reaches nothing", async () => {
  const tasks = [
    ...[5, 6, 7, 8, 9].map((at) => row(`stranded-${at}`, at, ACME.id, `octo/site-${at}`)),
    row("relay", 1, ACME.id, "acme/relay"),
  ];

  const reached = (
    await mount({
      workspaces: [PERSONAL, { ...ACME, github: { login: "acme", active: true } }],
      tasks,
    })
  )(ACME.id).recent;

  act(() => root?.unmount());

  const suspended = (
    await mount({
      workspaces: [PERSONAL, { ...ACME, github: { login: "acme", active: false } }],
      tasks,
    })
  )(ACME.id).recent;

  assert.deepEqual(reached, ["acme/relay"]);
  assert.deepEqual(suspended, []);
});

test("the list says the account manages the workspace it owns, and not one it is a member of", async () => {
  const chooser = await mount({ workspaces: [PERSONAL, ACME], tasks: [] });

  assert.deepEqual([chooser(PERSONAL.id).manages, chooser(ACME.id).manages], [true, false]);
});
