/**
 * use-task-outside.ts -- the reads that bring a task the window's list holds not into it, for a chip or a key naming one: by its id, or by its workspace's key.
 *
 * The host keeps only some of the account's tasks live, so a chip may name
 * a task the window's list holds not, a finished one say. Each read here
 * asks the host for it once, which reads it from the service and draws it
 * in the list as a cold task (`TasksComposer.openedOutside`), where the chip
 * then finds its name and its status as it finds any task's. Nothing is
 * read back here: the answer arrives as the list's. A task the list holds
 * already is asked for nothing, so nothing is asked while every task is live.
 */

import type { tasksFindAnswerSchema } from "@repo/features/tasks-view";
import { keyWordsIn, taskKey } from "@repo/features/workspace-key";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { tellAct } from "../act.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { appStateQuery } from "../use-app-state.js";
import { taskByNumberQueryOptions } from "./agent-reads.js";
import { useWordTargets } from "./use-known-names.js";

/** A key's number, the digits after its last hyphen (`ACME-42` is 42); none for words no key could be. */
function keyNumber(key: string): number | undefined {
  const number = Number(key.slice(key.lastIndexOf("-") + 1));

  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** How long a find stays fresh: a task found, for the session, since its number names it for good; an unanswered find, not at all, so the next chip asks again. */
function foundStaysFresh(query: {
  readonly state: { readonly data: (typeof tasksFindAnswerSchema)["Type"] | undefined };
}): number {
  const { data } = query.state;

  return data !== undefined && "taskId" in data ? Number.POSITIVE_INFINITY : 0;
}

/** The one workspace whose tasks `key` could name, by its slug; none where none could, or more than one, as two whose names begin alike. */
function keyedWorkspace(workspaces: readonly Workspace[], key: string): string | undefined {
  const number = keyNumber(key);

  if (number === undefined) return undefined;

  const named = workspaces.filter(
    (each) => each.slug !== undefined && taskKey(each.name, number) === key,
  );

  return named.length === 1 ? named[0]?.slug : undefined;
}

/** Each task a key among the words could name that the window lists not, by its workspace's slug and its number, each once. */
function keyedTasks(
  words: string,
  targets: ReadonlyMap<string, string>,
  workspaces: readonly Workspace[],
): readonly { readonly workspace: string; readonly number: number }[] {
  const keys = new Set(
    keyWordsIn(words)
      .map((span) => span.key)
      .filter((key) => !targets.has(key)),
  );

  return [...keys].flatMap((key) => {
    const workspace = keyedWorkspace(workspaces, key);
    const number = keyNumber(key);

    return workspace === undefined || number === undefined ? [] : [{ workspace, number }];
  });
}

/** The workspaces of the document, which tell their readers only when one is a new list. */
const selectWorkspaces = (state: AppStateSnapshot): readonly Workspace[] => state.tasks.workspaces;

/**
 * Reads the task `taskId` names into the window's list where it holds it
 * not (`TASKS_READ_OUTSIDE`), so a chip naming it wears its name and its
 * status once it lands; none, or a task the list holds, asks nothing.
 */
export function useTaskReadIn(taskId: string | undefined): void {
  const row = useTaskListRow(useTaskListCollections().tasks, taskId);
  const outside = row === undefined ? taskId : undefined;

  useEffect(() => {
    if (outside !== undefined) tellAct(ACT_KIND.TASKS_READ_OUTSIDE, { taskId: outside });
  }, [outside]);
}

/**
 * Finds the task a workspace's number names on the service where the
 * window lists it not (`TASKS_FIND`), which reads it into the list beside
 * the answer; its id once found, none while it is asked, where it is found
 * nowhere, or where `asked` is none. Each number is asked once a session.
 */
export function useTaskFound(
  asked: { readonly workspace: string; readonly number: number } | undefined,
): string | undefined {
  const { data } = useQuery({
    ...taskByNumberQueryOptions(asked?.workspace ?? "", asked?.number ?? 0),
    enabled: asked !== undefined && asked.workspace !== "",
    staleTime: foundStaysFresh,
  });

  return asked !== undefined && data !== undefined && "taskId" in data ? data.taskId : undefined;
}

/**
 * The link a task's key written among words names its task with, as
 * `useWordTargets` holds it; where the window lists no task by it, the
 * task is found on the service by its workspace's number (`useTaskFound`),
 * and the key names it once the list holds it. None until then, or where
 * no one workspace's tasks could be keyed so.
 */
export function useKeyTarget(key: string): string | undefined {
  const target = useWordTargets().get(key);

  const select = useCallback(
    (state: AppStateSnapshot) =>
      target === undefined ? keyedWorkspace(state.tasks.workspaces, key) : undefined,
    [target, key],
  );

  const workspace = useQuery({ ...appStateQuery, select }).data;
  const number = keyNumber(key);
  useTaskFound(workspace === undefined || number === undefined ? undefined : { workspace, number });

  return target;
}

/**
 * Finds on the service each task a key among `words` names that the window
 * lists not (`useTaskFound`), while `asked`, so the words link it as they
 * link a listed task's key once the list holds it (`useWordTargets`).
 */
export function useKeysFound(words: string, asked: boolean): void {
  const targets = useWordTargets();
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;

  const sought = useMemo(
    () => (!asked || workspaces === undefined ? [] : keyedTasks(words, targets, workspaces)),
    [asked, words, targets, workspaces],
  );

  useQueries({
    queries: sought.map(({ workspace, number }) => ({
      ...taskByNumberQueryOptions(workspace, number),
      staleTime: foundStaysFresh,
    })),
  });
}
