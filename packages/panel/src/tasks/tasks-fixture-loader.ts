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

import { ACT_KIND } from "@repo/host/acts";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fixtureMoved } from "./fixture-moves.js";

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
  | "fixtureOpensTasks"
>;

/** A list a fixture run stages. */
type StagedList = NonNullable<ReturnType<TasksFixture["fixtureTasksView"]>>;

let landed: TasksFixture | undefined;
let loading: Promise<void> | undefined;

/** The Query client the window's document is written into, whose `run` a fixture run's acts are staged by (`act.ts`). */
let documentClient: QueryClient | undefined;

/**
 * The tasks fixture with the Inbox's tasks, answers, and document laid over
 * its own, which come last. Note that the Inbox's list is laid once for each
 * list the tasks fixture hands, and handed again as the same list after,
 * as a live window's list stands the same until main writes another: every
 * selector over the document reads it, and a list laid afresh at each read
 * would make each of them walk and redraw it, which no live window pays.
 */
function laidOver(tasks: TasksModule, inbox: InboxModule): TasksFixture {
  const laid = new WeakMap<StagedList, { readonly profile: string; readonly view: StagedList }>();

  const fixtureTasksView: TasksFixture["fixtureTasksView"] = (run) => {
    const view = tasks.fixtureTasksView(run);

    if (view === undefined) return undefined;
    const kept = laid.get(view);

    if (kept?.profile === run.profile) return kept.view;
    const laidView = inbox.inboxTasksView(run.profile, view);
    laid.set(view, { profile: run.profile, view: laidView });

    return laidView;
  };

  return {
    fixtureSidePanel: tasks.fixtureSidePanel,
    fixtureColumnTab: tasks.fixtureColumnTab,
    fixturePlace: tasks.fixturePlace,
    fixtureOpensTasks: tasks.fixtureOpensTasks,
    fixtureTasksView,
    fixtureActAnswer: (run, kind, payload) => {
      const staged = inbox.inboxActAnswer(run.profile, kind, payload);

      // Note that a reaction or an edit the Inbox's Manager chat keeps, and a page of older items read, or a search's found items, moves its stage, so the window stages its document again to draw it.
      if (
        staged !== undefined &&
        (kind === ACT_KIND.AGENTS_CHAT_REACT ||
          kind === ACT_KIND.AGENTS_CHAT_EDIT ||
          kind === ACT_KIND.AGENTS_INBOX_OLDER_PAGE ||
          kind === ACT_KIND.AGENTS_INBOX_SEARCH)
      ) {
        fixtureMoved();
      }

      return staged ?? tasks.fixtureActAnswer(run, kind, payload);
    },
    fixtureAppState: (state) =>
      inbox.inboxAppState(tasks.fixtureAppState(state), tasks.FIXTURE_WORKSPACE_IDS),
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
