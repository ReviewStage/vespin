import { and, eq, isNull, isUndefined, not, useLiveQuery } from "@tanstack/react-db";
import { type ReactNode, useCallback } from "react";
import { AutomationDirectory } from "../automation-directory.js";
import { useAutomationsDoor } from "../places/routed-doors.js";
import { useTaskListCollections, useTaskListRows } from "../task-list-collections.js";
import { AUTOMATIONS_PAGE } from "../tasks/automations-place.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * listed-automations.tsx -- the listed workspace's automations, read around the whole window, so an agent's card on Home's rows or in ⌘K names the automation that started it as the task's own does.
 *
 * They are read only while an agent the window lists names an automation: one on a listed task, or one
 * of the open task's agents. The open task and the Inbox stand directories of their
 * own, which share this read where they are of the listed workspace
 * (`automation-directory.tsx`).
 */

/**
 * Whether an agent the window lists names the automation that started it: a
 * listed task's, followed live, or the open task's, as Home's rows name it.
 * Note that the live query holds only the unarchived agents an automation
 * started, each as its id and task, so a step of an agent's turn tells it
 * nothing, and that their tasks are read by id (`useTaskListRows`), which
 * follows each, so a task the list carries after its agent is heard as it
 * lands, while no other task's move is.
 */
function useNamesAutomation(tasks: TasksControl): boolean {
  const collections = useTaskListCollections();
  const rows = useTaskListRows();

  const { data: started } = useLiveQuery((q) =>
    tasks.agentsCarried
      ? q
          .from({ agent: collections.agents })
          .where(({ agent }) =>
            and(
              not(isUndefined(agent.automationId)),
              isUndefined(agent.archivedAt),
              not(isNull(agent.taskId)),
            ),
          )
          .select(({ agent }) => ({ id: agent.id, taskId: agent.taskId }))
      : undefined,
  );

  const listed = (started ?? []).some(
    ({ taskId }) => taskId !== null && rows.task(taskId) !== undefined,
  );

  // Note that the open task's agents a run started are read by their task alone, archived ones among them, so a step of any agent's turn moves no answer.
  const openTaskId = tasks.activeTaskId;

  const { data: openRuns } = useLiveQuery((q) =>
    openTaskId === undefined
      ? undefined
      : q
          .from({ agent: collections.agents })
          .where(({ agent }) =>
            and(eq(agent.taskId, openTaskId), not(isUndefined(agent.automationId))),
          )
          .select(({ agent }) => ({ id: agent.id })),
  );

  return listed || (openRuns ?? []).length > 0;
}

/** The listed workspace's automations for everything inside. */
export function ListedAutomations({
  tasks,
  children,
}: {
  tasks: TasksControl;
  children: ReactNode;
}): React.JSX.Element {
  const { open: onOpen } = useAutomationsDoor(tasks);
  const wanted = useNamesAutomation(tasks);

  const openAutomation = useCallback(
    (automationId: string) => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpen],
  );

  return (
    <AutomationDirectory workspace={tasks.workspace} wanted={wanted} onOpen={openAutomation}>
      {children}
    </AutomationDirectory>
  );
}
