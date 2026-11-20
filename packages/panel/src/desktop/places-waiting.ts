import {
  INBOX_SHOW,
  INBOX_SHOW_COUNT,
  type InboxShow,
  inboxAtNow,
  inboxCounts,
} from "@repo/features/inbox-list-model";
import type { AppInboxTask, AppInboxTaskHolding } from "@repo/host/app-state";
import { type BarCount, type BarCountTone, STATUS_TONE, useMinute } from "@repo/ui";
import { useMemo } from "react";
import { useInboxTaskHoldings, useInboxWaitingTasks } from "../tasks/use-inbox-slices.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useListedInboxGroups } from "../tasks/use-waiting-items.js";
import { useInboxViewChoices } from "./folded-groups.js";

/**
 * places-waiting.ts -- what the places that count the Inbox draw from: the
 * sidebar's Inbox row (`desktop-sidebar.tsx`) and a phone's places bar
 * (`mobile-bar.tsx`), which count what the Inbox's chosen view lists, and
 * each task's badge on the Tasks page's List and Board, which counts the
 * open threads of that task that wait on the developer, a question or an
 * update not yet opened, as main counts them.
 */

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

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

/** How many threads wait on the developer on each task, by task, as main counts them, less those reminded for later; a task where none waits is left out, and every one while signed out. */
export function useTasksWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const now = useMinute();
  const holdings = useInboxTaskHoldings();
  const waiting = useInboxWaitingTasks();
  const byTask = useMemo(() => toDoByTask(holdings, waiting, now), [holdings, waiting, now]);

  return tasks.signedIn ? byTask : NO_COUNTS;
}

/** Where a scope's count is drawn in the tone of what needs the reader: what waits on them and what they are not done with; everything, or what they put off, is a tally. */
const SHOW_TONE = {
  [INBOX_SHOW.NEEDS_ME]: STATUS_TONE.ATTENTION,
  [INBOX_SHOW.OPEN]: STATUS_TONE.ATTENTION,
  [INBOX_SHOW.ALL]: STATUS_TONE.NEUTRAL,
  [INBOX_SHOW.REMINDERS]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<InboxShow, BarCountTone>;

/**
 * The Inbox's count as its row and a phone's bar draw it, each in its tone: how many items
 * the scope the Inbox shows lists, addressed to whom its Addressed to names
 * (`inboxCounts`), so Questions counts what waits on the developer and Open
 * what they are not done with, read with that scope's words and tone; it
 * follows the view as the Inbox's menu changes it. None while signed out.
 */
export function useInboxViewCount(tasks: TasksControl): BarCount {
  const now = useMinute();
  const { show, whose } = useInboxViewChoices();
  const { groups } = useListedInboxGroups(tasks);
  const me = tasks.me;

  // Note that a reminder is weighed on the window's clock, as the Inbox weighs it, so an item comes back within the minute its reminder comes due.
  const counts = useMemo(
    () => inboxCounts(inboxAtNow(groups, now), me, whose),
    [groups, now, me, whose],
  );

  const value = tasks.signedIn ? counts[show] : 0;

  // Note that the count stands while it says the same, because the Inbox's row holds while what it is handed does.
  return useMemo(() => {
    const noun = INBOX_SHOW_COUNT[show];

    return { value, noun: value === 1 ? noun.one : noun.many, tone: SHOW_TONE[show] };
  }, [value, show]);
}
