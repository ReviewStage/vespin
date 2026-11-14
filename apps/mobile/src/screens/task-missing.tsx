// task-missing.tsx -- what a screen over one task draws while the task it names is not held: reading while the task list or the task's own read is on its way, the list's read failed with Try again, and not found only once both have answered without it.

import { TASKS_READ } from "@repo/features/tasks-view";
import { readFailedWords, readingWords, TERM } from "@repo/features/words";
import { BUTTON_LOOK, EmptyState, GLYPH } from "@repo/ui-native";
import { useInboxActs } from "../inbox/use-inbox.js";
import { useFoundTask } from "../tasks/use-found-task.js";
import { useTasksReadStatus } from "../tasks/use-tasks.js";

/** What the screen says while the task is first read. */
const READING_TASK = readingWords("the task");

/** What the screen says where the task list could not be read, beside Try again, as the panel's Tasks page does. */
const TASKS_UNREAD = readFailedWords(`your ${TERM.TASK.many}`);

/** What a failed read offers. */
const TRY_AGAIN = "Try again";

/**
 * The state a screen over the task `taskId` names draws where it holds no
 * such task: reading while the list or the task's own read (a task the list
 * does not hold, such as another workspace's) has not answered; the list's
 * read failed, with Try again, where it holds nothing to look in; and
 * `notFound` once both have answered without it. Note that a read never
 * spins with no way out, since a failed list read says so.
 */
export function TaskMissing({
  taskId,
  notFound,
}: {
  readonly taskId: string;
  /** What the screen says once the task is known not to stand, such as Task not found. */
  readonly notFound: string;
}) {
  const read = useTasksReadStatus();
  const found = useFoundTask(taskId, undefined);
  const { refreshTasks } = useInboxActs();

  if (read === TASKS_READ.FAILED && found.seeking) {
    return (
      <EmptyState
        title={TASKS_UNREAD}
        symbol={GLYPH.TASK}
        action={{
          label: TRY_AGAIN,
          onPress: () => {
            void refreshTasks();
          },
          look: BUTTON_LOOK.BORDERED,
        }}
      />
    );
  }

  if (read === TASKS_READ.FAILED || (read === TASKS_READ.READY && !found.seeking)) {
    return <EmptyState title={notFound} symbol={GLYPH.NOT_FOUND} />;
  }

  return <EmptyState title={READING_TASK} symbol={GLYPH.TASK} loading />;
}
