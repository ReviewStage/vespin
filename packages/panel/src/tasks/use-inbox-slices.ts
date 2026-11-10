import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import type { AppInboxTask, AppInboxTaskHolding } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  appStateQuery,
  selectFailedRuns,
  selectInboxTasks,
  selectInboxWaiting,
} from "../use-app-state.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * use-inbox-slices.ts -- what main's inbox read last answered, as each surface that draws from it reads it.
 *
 * Each reads its own slice of the document's `inbox`, so a patch to one
 * draws only its readers, and each reads none before the first document
 * arrives.
 */

/** Nothing waiting on any task, before the first document arrives. */
const NOTHING_WAITING: readonly AppInboxTask[] = [];

/** No task holding items, before the first document arrives. */
const NO_TASKS_HOLDING: readonly AppInboxTaskHolding[] = [];

/** No failed runs, before the first document arrives. */
const NO_FAILED_RUNS: readonly AccountFailedRun[] = [];

/** The entries of the tasks in `workspaceId`, or every entry while no workspace is listed. */
function inWorkspace<Entry extends { readonly taskId: string }>(
  entries: readonly Entry[],
  tasks: TasksControl["tasks"],
  workspaceId: string | undefined,
): readonly Entry[] {
  if (workspaceId === undefined) return entries;
  const listed = new Set(
    tasks.filter((task) => task.workspaceId === workspaceId).map((task) => task.id),
  );
  return entries.filter((entry) => listed.has(entry.taskId));
}

/** What waits on the developer across the account's tasks, as main's read last answered: each task with an open inbox item, and its items. */
export function useInboxWaitingTasks(): readonly AppInboxTask[] {
  return useQuery({ ...appStateQuery, select: selectInboxWaiting }).data ?? NOTHING_WAITING;
}

/** Every task holding an inbox item, waiting or settled, the task whose item changed latest first: what the window's Inbox lists. */
export function useInboxTaskHoldings(): readonly AppInboxTaskHolding[] {
  return useQuery({ ...appStateQuery, select: selectInboxTasks }).data ?? NO_TASKS_HOLDING;
}

/** The listed workspace's share of what waits on the developer (`inbox`) and of the tasks holding items (`inboxTasks`), which alone the Inbox, its count, and Home list; everything while no workspace is listed. */
export function useListedInbox(control: Pick<TasksControl, "tasks" | "workspace">): {
  readonly inbox: readonly AppInboxTask[];
  readonly inboxTasks: readonly AppInboxTaskHolding[];
} {
  const waiting = useInboxWaitingTasks();
  const holdings = useInboxTaskHoldings();
  const workspaceId = control.workspace?.id;
  return useMemo(
    () => ({
      inbox: inWorkspace(waiting, control.tasks, workspaceId),
      inboxTasks: inWorkspace(holdings, control.tasks, workspaceId),
    }),
    [waiting, holdings, control.tasks, workspaceId],
  );
}

/** The newest run of each of the account's own automations that failed to start lately, every workspace's, which marks the sidebar's Automations of the run's workspace until that automation is opened. */
export function useFailedRuns(): readonly AccountFailedRun[] {
  return useQuery({ ...appStateQuery, select: selectFailedRuns }).data ?? NO_FAILED_RUNS;
}
