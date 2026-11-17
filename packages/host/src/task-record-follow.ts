import {
  TASK_RECORD_READ,
  type TaskRecordLiveAnswer,
  type TaskRecordLiveRows,
} from "@repo/features/task-record-live";
import { Effect } from "effect";
import { followTakingRows, type LiveBroken, type LiveFailure, type TxWait } from "./live-follow.js";

/**
 * task-record-follow.ts -- where an open task's description stands, followed by the host over the service's held poll, so the description is read again only once its mark moved.
 *
 * The service answers one statement a part (`task-record-live.ts`), each a
 * mark that moves as its rows do and carries none of their words. The host
 * follows them (`live-follow.ts`) for as long as a window holds the task's
 * description (`held-task-reads.ts`), and answers each delivery that moved the
 * description with when it was last saved, which the caller reads again from the
 * service, and a write of the description waits on the record for its transaction. The pages, calls, and code
 * parts the service still answers for a released desktop are compared by no
 * one: a window holds a task's pages on their own read (`LIVE_READ.PAGES`),
 * the app takes no calls, and no window draws the code agents showed. Only
 * the description's last save leaves.
 */

/** What a delivery that moved the description says: when the description was last saved, none for a task the account no longer reaches. */
export interface TaskRecordMove {
  readonly descriptionSavedAt: number | undefined;
}

/** A read the service did not answer, `gone` where the task is no longer the account's. */

export interface TaskRecordFollowDependencies {
  /** The record's rows inline, held past `after`; a failure where the service answered none. */
  readonly poll: (after: string | undefined) => Effect.Effect<TaskRecordLiveAnswer | LiveFailure>;
  /** Handed how to wait for a write's transaction on the record once it hands one, and none once it is let go (`live-follow.ts`). */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The description's rows as one comparable value. */
function descriptionMarkOf(rows: TaskRecordLiveRows): string {
  return JSON.stringify(
    rows.description.toSorted((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)),
  );
}

/**
 * The record followed until it is gone, each answer's rows taken the moment
 * its poll answers (`followTakingRows`), and each answer that moved the
 * description handed to `moved` with its last save as it delivered it, from
 * the first answer, which always moves it, before the follow carries the
 * answer's transactions on to a write waiting for them. So a write of the
 * description confirmed on the record finds the move that shows it already
 * handed on. It fails where the read is gone or a first row does not
 * decode, which the caller answers by reading it again.
 */
export function followTaskRecord(
  dependencies: TaskRecordFollowDependencies,
  first: TaskRecordLiveAnswer,
  moved: (move: TaskRecordMove) => Effect.Effect<void>,
): Effect.Effect<void, LiveBroken> {
  /** The description's rows as the last answer delivered them; none before the first. */
  let before: string | undefined;

  return followTakingRows(dependencies, first, TASK_RECORD_READ.rows, (rows) =>
    Effect.suspend(() => {
      const mark = descriptionMarkOf(rows);

      if (mark === before) return Effect.void;
      before = mark;

      return moved({ descriptionSavedAt: rows.description[0]?.savedAt });
    }),
  );
}
