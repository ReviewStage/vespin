/**
 * merge-queue-model.ts -- what the Merge queue page says of each queued pull request, read once for every client that draws the page: its words, how its merge group's checks stand, and what a reader hears after its title.
 *
 * The desktop's and the web's page (`@repo/panel`'s `merge-queue-page.tsx`)
 * and the iPhone and iPad app's screen draw each row from these, so the two
 * never count a merge group's checks differently. It imports no React and no
 * DOM.
 */

import { Duration } from "effect";
import { CHECK_SUMMARY, type CheckSummary } from "./agent-wire.js";
import type { MergeQueueChecks, MergeQueueEntry } from "./merge-queue-wire.js";
import {
  MERGE_QUEUE_STAGE,
  MERGE_QUEUE_STAGE_LABEL,
  type MergeQueueStage,
  mergeQueueStage,
} from "./pull-request-model.js";

/** What the page says: its title, and its words with nothing to list. */
export const MERGE_QUEUE_PAGE_WORDS = {
  TITLE: "Merge queue",
  EMPTY: "Nothing is queued.",
  UNREAD: "The merge queues could not be read.",
  READING: "Reading the merge queues…",
  /** What a queued pull request's state menu offers to open the page on it. */
  VIEW: "View merge queue",
} as const;

/** How often the queues are read again while the page stands, since GitHub tells the app nothing as a queue moves. */
export const MERGE_QUEUE_READ_EVERY = Duration.seconds(30);

/** How the merge group's checks stand at each stage, as a pull request's checks are summed up, where GitHub has not yet counted them. */
const STAGE_SUMMARY = {
  [MERGE_QUEUE_STAGE.WAITING]: CHECK_SUMMARY.NONE,
  [MERGE_QUEUE_STAGE.CHECKING]: CHECK_SUMMARY.PENDING,
  [MERGE_QUEUE_STAGE.MERGING]: CHECK_SUMMARY.PASSING,
  [MERGE_QUEUE_STAGE.FAILING]: CHECK_SUMMARY.FAILING,
} as const satisfies Record<MergeQueueStage, CheckSummary>;

/** How a row counts its merge group's checks: their summary's glyph, and the count beside it, none where GitHub has counted none. */
export interface MergeQueueChecksStanding {
  readonly summary: CheckSummary;
  readonly count: number | undefined;
}

/** A pull request's number as its row says it. */
export function mergeQueueNumberWords(number: number): string {
  return `#${number}`;
}

/**
 * How the merge group's checks stand, counted as a pull request's Checks tab
 * counts them: those that failed; else those still running; else all of
 * them; by its stage alone where GitHub has counted none yet.
 */
export function mergeQueueChecksStanding(entry: MergeQueueEntry): MergeQueueChecksStanding {
  const { checks } = entry;

  if (checks === null || checks === undefined) {
    return { summary: STAGE_SUMMARY[mergeQueueStage(entry.state)], count: undefined };
  }

  if (checks.failedCount > 0) return { summary: CHECK_SUMMARY.FAILING, count: checks.failedCount };

  if (checks.passed < checks.total) {
    return { summary: CHECK_SUMMARY.PENDING, count: checks.total - checks.passed };
  }

  return { summary: CHECK_SUMMARY.PASSING, count: checks.total };
}

/** How the queue's checks stand on a pull request in words: the first named failure and how many more failed, or how many failed where none is named, else how many passed; none before it reports any. */
export function mergeQueueChecksWords(
  checks: MergeQueueChecks | null | undefined,
): string | undefined {
  if (checks === null || checks === undefined) return undefined;

  const [first] = checks.failed;
  const more = checks.failedCount - 1;

  if (first !== undefined) return more > 0 ? `${first} failed +${more}` : `${first} failed`;

  if (checks.failedCount > 0) {
    return `${checks.failedCount} ${checks.failedCount === 1 ? "check" : "checks"} failed`;
  }

  return `${checks.passed} of ${checks.total} ${checks.total === 1 ? "check" : "checks"} passed`;
}

/** What a reader hears after a row's title that the eye reads in its cells: its number, its stage, how its checks stand, and who opened it, by the name `author` gives. */
export function mergeQueueHeard(entry: MergeQueueEntry, author: string): readonly string[] {
  const parts = [
    mergeQueueNumberWords(entry.pullRequest.number),
    MERGE_QUEUE_STAGE_LABEL[mergeQueueStage(entry.state)],
    mergeQueueChecksWords(entry.checks),
    author,
  ];

  return parts.filter((part) => part !== undefined);
}
