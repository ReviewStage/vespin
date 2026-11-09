import { listedIn } from "@repo/features/inbox-list-model";
import type {
  AppInboxTask,
  AppInboxTaskHolding,
  AppInboxTasklessItem,
  AppInboxWaitingItem,
} from "@repo/host/app-state";
import { useMinute } from "@repo/ui";
import { useMemo } from "react";
import { waitsOnReader } from "../tasks/inbox-model.js";
import {
  useInboxTaskHoldings,
  useInboxTaskless,
  useInboxWaitingTasks,
} from "../tasks/use-inbox-slices.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox, the one
 * reading the places that count them draw from: the sidebar's rows
 * (`desktop-sidebar.tsx`), a phone's places bar (`mobile-bar.tsx`),
 * each task's badge on the Tasks page's List and Board, and the needs-you
 * dot a sidebar row of a task or an agent with no task wears. The Inbox's row
 * counts the open threads that wait on the developer, a question or an
 * update not yet opened, as the Inbox's own marks do (`inbox-model.ts`'s
 * `needsYou`), and a task's badge counts the same threads of that task, as
 * main counts them.
 */

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/** Whether an item waits now: it holds no reminder the developer set for after `now`. */
function dueBy(item: Pick<AppInboxWaitingItem, "remindAt">, now: number): boolean {
  return item.remindAt === undefined || item.remindAt <= now;
}

/**
 * How many threads wait on the developer on each task main lists, every
 * workspace's: main's count of each task's (`toDo`), a question not
 * answered or an update not yet opened, which the host lowers the moment
 * the reader answers or opens one (`@repo/host`'s `account-inbox-follow.ts`),
 * less its waiting items whose reminder the developer set for after `now`,
 * which the count still holds since main's read cannot read the clock. A
 * teammate's thread and a settled one never count, read or not. Where main
 * carries no count of a task's to do, from a service before it, its open
 * items are counted, as before. A task where none waits is left out.
 */
function toDoByTask(
  holdings: readonly AppInboxTaskHolding[],
  waiting: readonly AppInboxTask[],
  now: number,
): ReadonlyMap<string, number> {
  const counted = new Map<string, number>();
  for (const { taskId, toDo } of holdings) {
    if (toDo !== undefined) counted.set(taskId, toDo);
  }
  for (const { taskId, items } of waiting) {
    const reminded = items.filter((item) => item.remindAt !== undefined && item.remindAt > now);
    counted.set(taskId, (counted.get(taskId) ?? items.length) - reminded.length);
  }
  return new Map([...counted].filter(([, count]) => count > 0));
}

/**
 * Every thread waiting on the developer in the listed workspace's Inbox:
 * each standing task's open items main lists as theirs, and every open item
 * from an agent with no task of that workspace (`listedIn`) that waits on
 * them (`waitsOnReader`), a question or a notice alike, as Needs you lists
 * them, less those whose reminder the developer set for after `now`, which Needs you
 * leaves out until they come back. Note that a notice counts until it is opened or marked read, because either
 * settles it as Got it does (`settledOnRead`); a teammate's thread and a settled one never
 * count, and one the reader settles leaves main's read the moment it is
 * asked (`@repo/host`'s `account-inbox-follow.ts`).
 */
function waitingThreads(
  tasks: TasksControl,
  inboxWaiting: readonly AppInboxTask[],
  inboxTaskless: readonly AppInboxTasklessItem[],
  now: number,
): readonly AppInboxWaitingItem[] {
  // Note that only the standing tasks are counted, as To do lists them, so a task not listed yet counts nowhere.
  const standing = new Set(tasks.listed.tasks.map((task) => task.id));
  const ofTasks = inboxWaiting
    .filter((task) => standing.has(task.taskId))
    .flatMap((task) => task.items);
  const taskless = inboxTaskless.filter(
    (each) => waitsOnReader(each, tasks.me) && listedIn(each, tasks.workspace?.id),
  );
  return [...ofTasks, ...taskless].filter((item) => dueBy(item, now));
}

/** The tasks, and the agents with no task, a thread of which waits on the developer at `now`: the threads the Inbox's row counts (`waitingThreads`). */
export interface NeedsYou {
  readonly tasks: ReadonlySet<string>;
  readonly agents: ReadonlySet<string>;
}

/** Which tasks and agents with no task hold a thread waiting on `readerId` at `now` (`NeedsYou`). */
export function needsYouOf(
  waiting: readonly AppInboxTask[],
  taskless: readonly AppInboxTasklessItem[],
  readerId: string | undefined,
  now: number,
): NeedsYou {
  return {
    tasks: new Set(
      waiting
        .filter((task) => task.items.some((item) => dueBy(item, now)))
        .map((task) => task.taskId),
    ),
    agents: new Set(
      taskless
        .filter((item) => waitsOnReader(item, readerId) && dueBy(item, now))
        .map((item) => item.agentId),
    ),
  };
}

/** How many threads wait on the developer on each task, by task, as main counts them, less those reminded for later; a task where none waits is left out, and every one while signed out. */
export function useTasksWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const now = useMinute();
  const holdings = useInboxTaskHoldings();
  const waiting = useInboxWaitingTasks();
  const byTask = useMemo(() => toDoByTask(holdings, waiting, now), [holdings, waiting, now]);
  return tasks.signedIn ? byTask : NO_COUNTS;
}

/**
 * How many threads wait on the developer in the Inbox, a question or an
 * update not yet opened, the number that reaches zero once each question is answered and
 * each update opened (`waitingThreads`); a teammate's is listed in the
 * Inbox, and waits on the teammate. None while signed out.
 */
export function useInboxWaiting(tasks: TasksControl): number {
  const now = useMinute();
  const waiting = useInboxWaitingTasks();
  const taskless = useInboxTaskless();
  return tasks.signedIn ? waitingThreads(tasks, waiting, taskless, now).length : 0;
}

/** Whether a thread of the task waits on the developer now (`needsYouOf`); never while signed out. */
export function useTaskNeedsYou(tasks: Pick<TasksControl, "signedIn">, taskId: string): boolean {
  const now = useMinute();
  const waiting = useInboxWaitingTasks();
  return tasks.signedIn && needsYouOf(waiting, [], undefined, now).tasks.has(taskId);
}

/** Whether a thread of the agent with no task waits on `readerId` now (`needsYouOf`); never while signed out, when a reader not known yet would match every thread. */
export function useAgentNeedsYou(
  signedIn: boolean,
  agentId: string,
  readerId: string | undefined,
): boolean {
  const now = useMinute();
  const taskless = useInboxTaskless();
  return signedIn && needsYouOf([], taskless, readerId, now).agents.has(agentId);
}
