/**
 * inbox-thread-standing.ts -- where a thread a screen opens by its id stands while the reads it waits on answer: drawn, still read, refused, or missing.
 *
 * A thread is drawn from the account's feed. One the feed, once read, does
 * not hold, such as a teammate's or one long settled that a link names, is
 * looked for where the service says it stands and drawn from its task's own
 * inbox. Only a read that finished says a thread is missing, so a screen
 * never claims one is gone while what would hold it is still loading.
 */

import type { InboxItemHome } from "@repo/features/inbox-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import { INBOX_FEED, type InboxFeed } from "./app-state-reads.js";

/** Where a thread stands where the service named no place for it: not readable by the account, or not answered. */
export const HOME_READ = {
  MISSING: "missing",
  FAILED: "failed",
} as const;

/** Where a thread stands, as the service said: its task and agent, or that the account may not read it, or that no answer came. */
export type HomeRead = InboxItemHome | (typeof HOME_READ)[keyof typeof HOME_READ];

/** Where the task list's read stands. */
type TasksRead = (typeof TASKS_READ)[keyof typeof TASKS_READ];

/** What the feed's reads say of the thread, before it is looked for anywhere else. */
export interface ThreadFeedReads {
  /** Where the account's feed stands, as the document says. */
  readonly feed: InboxFeed;
  /** Whether the screen's own read of the items, where the phone keeps them on disk, has answered; true where the document holds them. */
  readonly rowsRead: boolean;
  /** Whether the document's feed holds the thread, though the task list may not hold its task yet. */
  readonly held: boolean;
  readonly tasks: TasksRead;
  /** Whether the feed's holders, as the screen grouped them, hold the thread. */
  readonly inFeed: boolean;
}

/** What drawing the thread found, from the feed or, where it was looked for, its task's own inbox. */
export interface ThreadLookup {
  readonly drawn: boolean;
  /** Where the service said the thread stands; none while it is read or not asked. */
  readonly home: HomeRead | undefined;
  /** Where the read of the thread's task's own inbox stands. */
  readonly homeInbox: InboxFeed;
}

/** The feed as the thread's screen waits on it: still read until the items kept on disk answered too, but refused where the feed was, since kept items never load past a feed that never stood. */
function feedOf(reads: ThreadFeedReads): InboxFeed {
  return reads.rowsRead || reads.feed === INBOX_FEED.FAILED ? reads.feed : INBOX_FEED.READING;
}

/** `answered` once the task list is read, which a thread's holder is drawn from; still read, or refused, before. */
function afterTasks(tasks: TasksRead, answered: InboxFeed): InboxFeed {
  if (tasks === TASKS_READ.READY) return answered;

  return tasks === TASKS_READ.FAILED ? INBOX_FEED.FAILED : INBOX_FEED.READING;
}

/**
 * Whether the thread is looked for outside the feed: only once the feed
 * answered, the items kept on disk among it, without it. Note that a thread
 * the feed holds whose task is still read waits as it is, rather than being
 * looked for.
 */
export function threadLookedFor(reads: ThreadFeedReads): boolean {
  return !reads.inFeed && !reads.held && feedOf(reads) === INBOX_FEED.ANSWERED;
}

/**
 * Where the thread stands on its screen while it is not drawn: still read,
 * refused, or, once answered, missing. A thread of the feed whose task the
 * task list has not read yet stands as still reading, and refused where that
 * read failed. One looked for stands as still read until the service says
 * where it stands and its task's inbox answered, and missing where the
 * service says the account may not read it or it stands on no task, a
 * Manager's, which has no task's inbox to read it from.
 */
export function threadStanding(reads: ThreadFeedReads, lookup: ThreadLookup): InboxFeed {
  const answered = feedOf(reads);
  const { drawn, home, homeInbox } = lookup;

  if (drawn) return answered;

  if (!threadLookedFor(reads)) return reads.held ? afterTasks(reads.tasks, answered) : answered;

  if (home === undefined) return INBOX_FEED.READING;

  if (home === HOME_READ.MISSING) return answered;

  if (home === HOME_READ.FAILED) return INBOX_FEED.FAILED;

  if (home.taskId === null) return answered;

  // Note that a task's inbox read before the task list holds its task waits on that list, as a thread of the feed does.
  return homeInbox === INBOX_FEED.ANSWERED ? afterTasks(reads.tasks, answered) : homeInbox;
}
