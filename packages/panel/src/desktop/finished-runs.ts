import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { pullRequestsOfTask } from "@repo/features/task-agents-model";
import type { TaskPullRequests, TaskSummary } from "@repo/features/task-wire";
import type { AppInboxTask } from "@repo/host/app-state";

/**
 * finished-runs.ts -- which of an automation's runs stand under the sidebar's Tasks: every one but a run that finished and asks nothing more of the reader, by the task the run made.
 *
 * An automation fires again and again, so the runs it finished would bury
 * the tasks under them. A task a run made for itself (`madeByRun`) leaves
 * once its run is over and nothing holds it, a run that failed or was
 * stopped among them: a good run's task is moved to Done, which the list never shows, so one still standing once no agent of it
 * works is a run that went wrong or holds something. It stands while an agent
 * of it works, while it is unread, while an Inbox item of it waits on the
 * reader, while a pull request of it is open or a draft, and while it is the
 * task shown. Its status is left as it stands, and it stays on its
 * automation's page and in ⌘K. Every other task, a same-agent automation's
 * standing task among them, stands as it did.
 */

/** The pull request states that leave work on the run: open, or a draft. */
const OPEN_PULL_REQUEST: ReadonlySet<string> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** What else holds a finished run's task in the list: the tasks unread, the reader's waiting Inbox items by task, the task shown, and every task's pull requests (`pullRequestsOfTask`). */
export interface RunTasksHeld {
  readonly unread: (task: TaskSummary) => boolean;
  readonly inbox: readonly Pick<AppInboxTask, "taskId">[];
  readonly shown: (taskId: string) => boolean;
  readonly pullRequests: readonly TaskPullRequests[] | undefined;
}

/** The tasks of the list that stand under Tasks, in the list's order: all but the tasks a run made whose run finished and holds nothing of the reader's. */
export function withoutFinishedRunTasks(
  tasks: readonly TaskSummary[],
  held: RunTasksHeld,
): readonly TaskSummary[] {
  const waiting = new Set(held.inbox.map((item) => item.taskId));

  return tasks.filter(
    (task) =>
      task.madeByRun !== true ||
      (task.agents?.working ?? 0) > 0 ||
      held.shown(task.id) ||
      held.unread(task) ||
      waiting.has(task.id) ||
      pullRequestsOfTask(held.pullRequests, task.id).some((pullRequest) =>
        OPEN_PULL_REQUEST.has(pullRequest.state),
      ),
  );
}
