/**
 * use-history.ts -- one task description's version history as the phone reads it: the revisions the host follows while the history stands, an older page read on a press, one version read whole, and its restore.
 *
 * The host follows the history's newest page while a screen holds it
 * (`TASKS_HISTORY_FOLLOW`), as the panel's version history holds it, and lays
 * each older page read (`TASKS_REVISIONS`) after it, so a save lands at the
 * head of the list as it lands. A version is read once by its number
 * (`TASKS_REVISION`), and a restore (`TASKS_RESTORE`) arrives in the document
 * as any other save does, at the head of the history.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import type { DescriptionRevisionsAnswer } from "@repo/features/task-wire";
import type { TasksRevisionAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { selectTaskHistory } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";

/** Where a read of the history, or of an older page of it, stands. */
export const HISTORY_READ = {
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

export type HistoryRead = (typeof HISTORY_READ)[keyof typeof HISTORY_READ];

/** One task's history as its list draws it. */
export interface TaskHistory {
  readonly read: HistoryRead;
  /** The revisions read, newest first, and where the next older page is read before; none until read. */
  readonly page: DescriptionRevisionsAnswer | undefined;
  /** Reads the history again after its read failed. */
  readonly retry: () => void;
  /** Where the older page's read stands, none before one is asked. */
  readonly older: HistoryRead | undefined;
  /** Reads the page older than the oldest read. */
  readOlder: () => void;
  /** Who is reading, by whom a revision of their own is named You. */
  readonly readerId: string | undefined;
}

/** Says on the console a read asked again that did not go; the list still says the read failed. */
function retryLost(cause: unknown): void {
  console.error("Reading the version history again did not go.", cause);
}

/** One task's version history, followed while the screen that calls it stands. */
export function useTaskHistory(taskId: string): TaskHistory {
  const acts = useHostActs();
  const [older, setOlder] = useState<HistoryRead | undefined>(undefined);
  useLiveFollow(taskId, (id) => acts[ACT_KIND.TASKS_HISTORY_FOLLOW]({ taskId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectTaskHistory(taskId), [taskId]),
  });

  const { data: readerId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const page = held?.rows;

  const read =
    page !== undefined
      ? HISTORY_READ.READY
      : held?.failed === true
        ? HISTORY_READ.FAILED
        : HISTORY_READ.READING;

  // Note that the page lands in the history the host holds, so only whether it landed is kept here.
  const readOlder = () => {
    const before = page?.earlier;

    if (before === undefined || older === HISTORY_READ.READING) return;
    setOlder(HISTORY_READ.READING);
    acts[ACT_KIND.TASKS_REVISIONS]({ taskId, before }).then(
      (answer) => setOlder("failure" in answer ? HISTORY_READ.FAILED : HISTORY_READ.READY),
      () => setOlder(HISTORY_READ.FAILED),
    );
  };

  return {
    read,
    page,
    retry: () => void acts[ACT_KIND.TASKS_HISTORY_RETRY]({ taskId }).catch(retryLost),
    older,
    readOlder,
    readerId,
  };
}

/** One version of a task's description, read by its number: reading, failed, or its content. */
export function useTaskVersion(taskId: string, seq: number) {
  const acts = useHostActs();

  return useQuery({
    queryKey: ["task-version", taskId, seq],
    queryFn: (): Promise<TasksRevisionAnswer> => acts[ACT_KIND.TASKS_REVISION]({ taskId, seq }),
    retry: false,
  });
}
