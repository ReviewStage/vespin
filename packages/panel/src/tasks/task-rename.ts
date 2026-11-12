/**
 * task-rename.ts -- a task's rename as each surface renaming one holds it, ⌘Z's to take back once the service kept it.
 */

import type { TasksView } from "@repo/features/tasks-view";
import { mutationOptions, useQuery } from "@tanstack/react-query";
import { sendAct } from "../act.js";
import type { RenameTerms } from "../rename-write.js";
import { pressRows, ROW_WRITE, type RowDoors, type TaskRows } from "../undo-stack.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { useTaskRowDoors } from "./task-row-doors.js";

/** What ⌘Z's toast calls a task's rename it takes back or puts back. */
const TASK_RENAMED_NOTE = "Task renamed";

/** A task's rename as a mutation asks it: the task, and the name already trimmed and changed. */
interface TaskRenameAsk {
  readonly taskId: string;
  readonly name: string;
}

/** How a task's rename is asked and read back, its refusal the answer that it was not renamed. */
export const TASK_RENAME_TERMS: RenameTerms<boolean, TaskRenameAsk> = {
  ask: (taskId, name) => ({ taskId, name }),
  asked: ({ taskId, name }) => ({ subjectId: taskId, name }),
  refused: (renamed) => !renamed,
};

/**
 * A task's rename as each surface renaming one holds it, a mutation of its
 * own over these options: sent through `send`, drawn under the new name at
 * once, and under its old name again by the host where the service refuses,
 * answering whether it was renamed. A rename the service kept is ⌘Z's to
 * take back, through `doors`; none where nothing is drawn to take back.
 */
function taskRenameMutation(
  send: (asked: TaskRenameAsk) => Promise<boolean>,
  doors: RowDoors<TaskRows, typeof ROW_WRITE.TASK_RENAME.kind> | undefined,
) {
  return mutationOptions({
    mutationKey: [ROW_WRITE.TASK_RENAME.kind],
    mutationFn: send,
    onMutate: (asked) =>
      doors === undefined
        ? undefined
        : pressRows(ROW_WRITE.TASK_RENAME, doors, [
            { id: asked.taskId, after: { name: asked.name } },
          ]),
    onSuccess: (renamed, _asked, pressed) => {
      if (renamed) pressed?.keep(TASK_RENAMED_NOTE);
    },
  });
}

/**
 * A task's rename as a surface holds it (`taskRenameMutation`), its rows
 * read off `drawn`, the tasks the Tasks tab draws as they stand at the call
 * (`TasksControl`'s `drawnTasks`). A fixture's tasks are renamed nowhere, as
 * they are read from nowhere.
 */
export function useTaskRename(drawn: () => TasksView) {
  const fixture = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const doors = useTaskRowDoors(ROW_WRITE.TASK_RENAME.kind, drawn);

  return fixture
    ? taskRenameMutation(() => Promise.resolve(false), undefined)
    : taskRenameMutation((asked) => sendAct(ROW_WRITE.TASK_RENAME.kind, asked), doors);
}
