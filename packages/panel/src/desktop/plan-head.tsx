import type { Task } from "@repo/features/task-wire";
import type { ReactNode } from "react";
import type { DescriptionRoom } from "../tasks/description-body.js";
import type { TaskRelationDoor } from "../tasks/task-relation-menu.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { PlanRelations } from "./plan-relations.js";
import { useQuickAdd } from "./quick-add.js";

/**
 * plan-head.tsx -- the head of a task's description: its sub-tasks and relations, its agents, and its pages.
 *
 * Each group of the head offers its own add on its head, a + at rest that
 * works folded too, and Sub-tasks and Agents stand even before they hold a
 * row (`plan-relations.tsx`, `plan-agents.tsx`), so a fresh task's head
 * has the shape it keeps rather than a band of starts that leaves once
 * the groups arrive. The head holds the sub-tasks' quick add (`useQuickAdd`
 * into the task, in its repository), which Sub-tasks' + opens, and its
 * owner keys the head by the task, so another task's head starts with no
 * draft standing.
 */

/**
 * The head of the open task's description: its Sub-tasks and Task
 * relations groups, then `agents` and `pages`, the groups its owner draws.
 */
export function PlanHead({
  task,
  tasks,
  door,
  room,
  agents,
  pages,
  onOpenTask,
}: {
  task: Task;
  tasks: TasksControl;
  door: TaskRelationDoor;
  /** Where the description's head stands, whose scroller its lists draw only the rows near the view of. */
  room: DescriptionRoom;
  /** The Agents group (`PlanAgents`). */
  agents: ReactNode;
  /** The Pages group (`PlanPages`). */
  pages: ReactNode;
  /** Opens a related row's task, as the description's head opens a task. */
  onOpenTask: (taskId: string) => void;
}): React.JSX.Element {
  const quick = useQuickAdd(tasks, {
    parentTaskId: task.id,
    ...(task.repository === null ? undefined : { repository: task.repository }),
  });
  return (
    <>
      <PlanRelations
        task={task}
        tasks={tasks}
        door={door}
        quick={quick}
        room={room}
        onOpenTask={onOpenTask}
      />
      {agents}
      {pages}
    </>
  );
}
