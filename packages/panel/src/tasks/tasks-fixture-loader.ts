/**
 * tasks-fixture-loader.ts -- the synthetic tasks a fixture run draws, imported on demand.
 *
 * Note that `tasks-fixture.ts` is reached only through the dynamic import
 * here, because its synthetic tasks must never ship in the bundle every
 * launch parses. A fixture run's window is drawn once it has landed
 * (`App`), so the tasks tab reads it synchronously, as it once read a static
 * import. The Inbox's synthetic items (`@repo/host/fixture-inbox`) land with it,
 * laid over its tasks, its answers, and main's document under the profiles
 * that stage them, and the agents and pull requests its task list follows
 * are laid on main's document too, as the host lays them.
 */

import type { TasksView } from "@repo/features/tasks-view";
import type { AppStateSnapshot } from "@repo/host/app-state";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type TasksModule = typeof import("./tasks-fixture.js");
type InboxModule = typeof import("@repo/host/fixture-inbox");

/** The fixture a run draws: the tasks fixture's doors, the Inbox's laid over the three it stages, and the reader it signs in as. */
type TasksFixture = {
  /** The account that reads the fixture's tasks as its own, under a profile that signs one in; none under any other. */
  readonly fixtureReader: (run: { readonly profile: string }) => string | undefined;
} & Pick<
  TasksModule,
  | "fixtureTasksView"
  | "fixtureSidePanel"
  | "fixtureColumnTab"
  | "fixtureActAnswer"
  | "fixtureAppState"
  | "fixturePlace"
>;

let landed: TasksFixture | undefined;
let loading: Promise<void> | undefined;

/** The Query client the window's document is written into, whose `run` a fixture run's acts are staged by (`act.ts`). */
let documentClient: QueryClient | undefined;

/** Each document's task list with a fixture's followed lists laid on it, one object for each. */
const followedLists = new WeakMap<AppStateSnapshot["tasks"], AppStateSnapshot["tasks"]>();

/**
 * Main's document with the agents and pull requests of the task list the
 * fixture draws (`view`) laid on its own list, as the host lays the list it
 * follows, so every reader of a task's agents or pull requests
 * (`use-task-work.ts`) reads those the fixture's rows count.
 */
function withFollowed(state: AppStateSnapshot, view: TasksView | undefined): AppStateSnapshot {
  if (view === undefined) return state;
  const held = followedLists.get(state.tasks);
  if (held !== undefined) return { ...state, tasks: held };
  const tasks = {
    ...state.tasks,
    ...(view.taskAgents === undefined ? undefined : { taskAgents: view.taskAgents }),
    ...(view.taskPullRequests === undefined
      ? undefined
      : { taskPullRequests: view.taskPullRequests }),
  };
  followedLists.set(state.tasks, tasks);
  return { ...state, tasks };
}

/** No pull request moved, as the prototype stages them. */
const NO_PULL_REQUEST_MOVES = new Map();

/** The task the Inbox threads prototype has open in the window under the Inbox profile, whose host opens none. */
let protoOpenTask: string | undefined;

export function setProtoOpenTask(taskId: string | undefined): void {
  protoOpenTask = taskId;
}

/** Whether an act opens or closes a task, which the prototype answers in the window. */
export function isTaskOpen(kind: string): boolean {
  return kind === "tasks.select" || kind === "tasks.close";
}

/** The tasks fixture with the Inbox's tasks, answers, and document laid over its own, which come last. */
function laidOver(tasks: TasksModule, inbox: InboxModule): TasksFixture {
  const fixtureTasksView: TasksFixture["fixtureTasksView"] = (run) => {
    const view = tasks.fixtureTasksView(run);
    const laid = view === undefined ? undefined : inbox.inboxTasksView(run.profile, view);
    if (laid === undefined || run.profile !== "inbox") return laid;
    const { activeTaskId: _held, ...rest } = laid;
    return protoOpenTask === undefined ? rest : { ...rest, activeTaskId: protoOpenTask };
  };
  return {
    fixtureSidePanel: tasks.fixtureSidePanel,
    fixtureColumnTab: tasks.fixtureColumnTab,
    fixturePlace: tasks.fixturePlace,
    fixtureTasksView,
    fixtureActAnswer: (run, kind, payload) =>
      inbox.inboxActAnswer(run.profile, kind, payload) ??
      tasks.fixtureActAnswer(run, kind, payload),
    fixtureAppState: (state) => {
      const staged = inbox.inboxAppState(tasks.fixtureAppState(state), tasks.FIXTURE_WORKSPACE_IDS);
      // Note that the Inbox threads prototype stages the invitations agent's pull requests on the web too, as the iPhone's fixture does, so its Pull request tab draws.
      const parts =
        state.run.profile === "inbox"
          ? inbox.pullRequestPartsAppState(staged, NO_PULL_REQUEST_MOVES)
          : staged;
      return withFollowed(parts, fixtureTasksView(state.run));
    },
    fixtureReader: (run) => inbox.inboxReader(run.profile),
  };
}

/** Imports the fixture once; a chunk that fails to load settles the same, leaving the run to draw no fixture. */
export function loadTasksFixture(): Promise<void> {
  loading ??= Promise.all([import("./tasks-fixture.js"), import("@repo/host/fixture-inbox")]).then(
    ([tasks, inbox]) => {
      landed = laidOver(tasks, inbox);
    },
    () => undefined,
  );
  return loading;
}

/**
 * Hands the fixture the Query client the window's document is written into,
 * and answers what takes it back: the subscription writing it hands it on
 * as it starts (`followAppState`), so an act staged by a fixture
 * run reads the run from the cache rather than a copy of its own.
 */
export function handFixtureClient(client: QueryClient): () => void {
  documentClient = client;
  return () => {
    if (documentClient === client) documentClient = undefined;
  };
}

/** The Query client the window's document is written into, once the subscription has handed it on. */
export function fixtureClient(): QueryClient | undefined {
  return documentClient;
}

/** The fixture, once it has landed. */
export function loadedTasksFixture(): TasksFixture | undefined {
  return landed;
}

/** Whether there is nothing left to wait for: true at once for a live run, which draws no fixture, and for a fixture run once its tasks have landed. */
export function useTasksFixtureLanded(fixtureMode: boolean): boolean {
  const [settled, setSettled] = useState(landed !== undefined);
  useEffect(() => {
    if (!fixtureMode) return;
    let live = true;
    loadTasksFixture().then(() => {
      if (live) setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [fixtureMode]);
  return !fixtureMode || settled;
}
