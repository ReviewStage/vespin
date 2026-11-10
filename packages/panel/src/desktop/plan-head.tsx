import { ENTITY_KIND } from "@repo/features/entity-kind";
import { subTasksOf } from "@repo/features/task-list-model";
import type { Task } from "@repo/features/task-wire";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, GAP, Inline, Shortcut } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import type { ReactNode } from "react";
import { EntityGlyph } from "../entities/entity-glyph.js";
import type { DescriptionRoom } from "../tasks/description-body.js";
import type { TaskRelationDoor } from "../tasks/task-relation-menu.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuAction } from "./action-menu.js";
import { PlanRelations } from "./plan-relations.js";
import { useQuickAdd } from "./quick-add.js";

/**
 * plan-head.tsx -- the head of a task's description: what it offers under its title before it has the groups that would offer it, then its sub-tasks and relations, its agents, and its pages.
 *
 * Under the title stand the starts a task offers before it has the groups
 * that would offer them (`PlanStarts`): New agent, before it lists an
 * agent, and Add sub-tasks, before it has a sub-task.
 * A group of the description's head stands only while it holds a row
 * (`plan-agents.tsx`, `plan-relations.tsx`), and once it does its head
 * offers the add, a + at rest that works folded too. Before then the add
 * would have no head to stand on, so it stands here instead, as words, as
 * Linear offers “+ Add sub-issues” under an issue's description until the
 * issue has one: New agent first, a fresh task's likeliest next step, in
 * the outline look with the chord the strip's "+" answers, then Add
 * sub-tasks, quiet, which starts the Sub-tasks group's quick add and so
 * brings the group in around its draft. Each leaves once its group stands.
 * The head holds that quick add (`useQuickAdd` into the task, in its
 * repository), so Add sub-tasks and the group's own + open the one draft,
 * and its owner keys the head by the task, so another task's head starts
 * with no draft standing.
 */

const ADD_SUB_TASKS = "Add sub-tasks";

/** The starts a task offers before it has the groups that would; nothing where it offers neither. */
function PlanStarts({
  newAgent,
  onAddSubTasks,
}: {
  /** New agent (`newAgentStarts`), where the task lists no agent; none otherwise, or on a task that starts none. */
  newAgent: MenuAction | undefined;
  /** Starts the sub-tasks' quick add, where the task has no sub-task; none otherwise. */
  onAddSubTasks: (() => void) | undefined;
}): React.JSX.Element | null {
  if (newAgent === undefined && onAddSubTasks === undefined) return null;
  return (
    <ReplayUnmask>
      <div className="plan-starts mb-block-gap">
        <Inline gap={GAP.TIGHT}>
          {newAgent === undefined ? null : (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              icon={<EntityGlyph kind={ENTITY_KIND.AGENT} />}
              trailing={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TAB].chord} />}
              disabled={newAgent.disabled}
              onClick={newAgent.onSelect}
            >
              {newAgent.label}
            </Button>
          )}
          {onAddSubTasks === undefined ? null : (
            <Button
              variant={BUTTON_VARIANT.QUIET}
              size={BUTTON_SIZE.COMPACT}
              icon={<GLYPH.SUB_TASK />}
              onClick={onAddSubTasks}
            >
              {ADD_SUB_TASKS}
            </Button>
          )}
        </Inline>
      </div>
    </ReplayUnmask>
  );
}

/**
 * The head of the open task's description: its starts, its Sub-tasks and
 * Task relations groups, then `agents` and `pages`, the groups its owner
 * draws. `newAgent` stands under the title only where its owner hands it,
 * on a task that lists no agent, whose Agents group draws none.
 */
export function PlanHead({
  task,
  tasks,
  door,
  room,
  newAgent,
  agents,
  pages,
  onOpenTask,
}: {
  task: Task;
  tasks: TasksControl;
  door: TaskRelationDoor;
  /** Where the description's head stands, whose scroller its lists draw only the rows near the view of. */
  room: DescriptionRoom;
  /** New agent, where the task lists no agent (`newAgentStarts`); none otherwise. */
  newAgent: MenuAction | undefined;
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
  const subTasks = subTasksOf(tasks.tasks, task.id).length > 0 || quick.shown;
  return (
    <>
      <PlanStarts newAgent={newAgent} onAddSubTasks={subTasks ? undefined : quick.open} />
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
