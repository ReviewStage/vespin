/**
 * history-rows.ts -- the task list's rows the window's history names and reaches, read by id from the task list's collections.
 *
 * Back's and Forward's lists, ⌃Tab's cards, and whether a step can still be
 * gone to read a handful of tasks and agents: those the steps stand on. They
 * are read by id from the window's task-list collections
 * (`task-list-collections.tsx`'s `useTaskListRows`), which draws the history
 * again only when one of those rows moves, so a delivery moving any other
 * task does no work here.
 *
 * A step whose task was once listed and is no longer is passed over, and a
 * version history's address names its task by the step its links name it by
 * (`taskLinkStep`), so every task ever listed is kept by its id and that
 * step. Both only grow, and are fed by the rows each delivery moves
 * (`subscribeChanges`), never by walking the list again.
 */

import { taskLinkStep } from "@repo/features/link-grammar";
import type { TaskSummary } from "@repo/features/task-wire";
import type { Collection } from "@tanstack/react-db";
import { useEffect, useMemo, useState } from "react";
import {
  type TaskListRows,
  useTaskListCollections,
  useTaskListRows,
} from "../task-list-collections.js";

/** The rows the window's history reads, by id, as the task list holds them now. */
export interface HistoryRows extends TaskListRows {
  /** Whether the list has ever held the task, so a step on one it no longer holds is one deleted. */
  readonly everListed: (taskId: string) => boolean;
  /** The task ever listed under `workspaceId` by the step its links name it by (`taskLinkStep`); none for a step no listed task was named by. */
  readonly everStepped: (workspaceId: string, step: string) => string | undefined;
}

/** Every task the list has held, by id and by the step its links name it by under its workspace. */
interface EverListed {
  readonly ids: Set<string>;
  readonly steps: Map<string, Map<string, string>>;
}

/** Keeps `task` among those ever listed. */
function keepListed(ever: EverListed, task: TaskSummary): void {
  ever.ids.add(task.id);
  const stepped = ever.steps.get(task.workspaceId) ?? new Map<string, string>();
  stepped.set(taskLinkStep(task), task.id);
  ever.steps.set(task.workspaceId, stepped);
}

/** The tasks a collection holds now, as those ever listed. */
function everListedOf(tasks: Collection<TaskSummary, string>): EverListed {
  const ever: EverListed = { ids: new Set(), steps: new Map() };

  for (const task of tasks.values()) keepListed(ever, task);

  return ever;
}

/**
 * The rows the window's history reads, by id. Each id asked is followed from
 * the next commit on, so the history is drawn again when that row moves; a
 * lookup always reads the collection as it stands, so an id asked for the
 * first time reads its row at once.
 */
export function useHistoryRows(): HistoryRows {
  const collections = useTaskListCollections();
  const rows = useTaskListRows();
  const [ever] = useState(() => everListedOf(collections.tasks));
  useEffect(() => {
    // Note that the rows held now are told again, since a row may have landed between the first draw and this subscription.
    const subscription = collections.tasks.subscribeChanges(
      (changes) => {
        for (const change of changes) if (change.type !== "delete") keepListed(ever, change.value);
      },
      { includeInitialState: true },
    );

    return () => subscription.unsubscribe();
  }, [collections.tasks, ever]);

  // Note that the rows are made again only once a row followed moves (`useTaskListRows`), so what reads them holds across every other delivery.
  return useMemo(
    () => ({
      ...rows,
      everListed: (taskId: string) => ever.ids.has(taskId),
      everStepped: (workspaceId: string, step: string) => ever.steps.get(workspaceId)?.get(step),
    }),
    [rows, ever],
  );
}
