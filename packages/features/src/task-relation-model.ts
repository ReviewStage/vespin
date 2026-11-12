/**
 * task-relation-model.ts -- how one task is related to another, as every task relation menu says and judges it: each kind as what choosing it does, its search's words, why a task cannot take it, and what a refused relation write says.
 *
 * A relation is one of four kinds (`TASK_RELATION_KIND`): the task is
 * blocked by the one picked, blocks it, takes it as a sub-task, or takes it
 * as its parent. The panel's menu (`@repo/panel`'s `task-relation-menu.tsx`)
 * and the iOS app's picker read the same words and the same judgment here,
 * so a task the one dims with why, the other dims with the same why.
 */

import { sameRepository } from "./github-repositories-wire.js";
import {
  TASK_RELATION_KIND,
  type Task,
  type TaskRelationKind,
  type TaskSummary,
} from "./task-wire.js";
import {
  type ParentCallFailure,
  type RelationCallFailure,
  TASK_BLOCK_FAILURE,
  TASK_PARENT_FAILURE,
} from "./tasks-view.js";

/** What the menu is called wherever it opens, New task's + among them. */
export const TASK_RELATION_MENU = "Task relation";

/** What a related task's menu calls moving the relation to another kind, and taking it away. */
export const CHANGE_RELATION = "Change relation";
export const REMOVE_RELATION = "Remove relation";

/** What a task's menu calls taking it out from under its parent. */
export const REMOVE_PARENT = "Remove parent";

/** What a search of the tasks says where it finds none. */
export const NO_TASKS_MATCH = "No tasks match";

/** The kinds in the order the kind submenu and the task's menus stand them. */
export const TASK_RELATION_ORDER: readonly TaskRelationKind[] = [
  TASK_RELATION_KIND.SUB_TASK,
  TASK_RELATION_KIND.PARENT,
  TASK_RELATION_KIND.BLOCKED_BY,
  TASK_RELATION_KIND.BLOCKS,
];

/** Each kind as what choosing it does, which the kinds list and the search's head say. */
export const TASK_RELATION_VERBS = {
  [TASK_RELATION_KIND.SUB_TASK]: { choose: "Add sub-task…", head: "Add sub-task" },
  [TASK_RELATION_KIND.PARENT]: { choose: "Set parent…", head: "Set parent" },
  [TASK_RELATION_KIND.BLOCKED_BY]: {
    choose: "Mark as blocked by…",
    head: "Mark as blocked by",
  },
  [TASK_RELATION_KIND.BLOCKS]: { choose: "Mark as blocking…", head: "Mark as blocking" },
} as const satisfies Record<TaskRelationKind, { choose: string; head: string }>;

/** Each kind's search field, saying which way round the task picked stands, and its New task, the one it makes. */
export const TASK_RELATION_SEARCH = {
  [TASK_RELATION_KIND.SUB_TASK]: {
    find: "Find a task to add as a sub-task",
    create: "New sub-task",
  },
  [TASK_RELATION_KIND.PARENT]: { find: "Find the parent task", create: "New parent task" },
  [TASK_RELATION_KIND.BLOCKED_BY]: {
    find: "Find the task this waits on",
    create: "New blocking task",
  },
  [TASK_RELATION_KIND.BLOCKS]: {
    find: "Find the task that waits on this",
    create: "New blocked task",
  },
} as const satisfies Record<TaskRelationKind, { find: string; create: string }>;

/** Why a task cannot take a kind, printed at its row's end. */
const WHY = {
  [TASK_RELATION_KIND.BLOCKED_BY]: { already: "Already blocks this", loop: "Waits on this task" },
  [TASK_RELATION_KIND.BLOCKS]: { already: "Already waits on this", loop: "This task waits on it" },
  [TASK_RELATION_KIND.SUB_TASK]: { already: "Already a sub-task", loop: "A parent of this task" },
  [TASK_RELATION_KIND.PARENT]: { already: "Already the parent", loop: "A sub-task of this task" },
} as const satisfies Record<TaskRelationKind, { already: string; loop: string }>;

const OTHER_REPOSITORY = "Another repository";

/** What a refused relation write says when the service kept no change, which stands as it was. */
const BLOCK_REFUSED_NOTE = "That relation could not be changed. Try again.";

/** What a refused block says when it would close a cycle, the other task already waiting on this one. */
const BLOCK_CYCLE_NOTE = "That task already waits on this one, so it can't block it too.";

/** What a refused parent says when it would put the task under itself, the other task already a sub-task of it. */
const PARENT_CYCLE_NOTE =
  "That task is already a sub-task of this one, so it can't be its parent too.";

/** What a refused parent says when it works in another repository, which a sub-task always shares. */
const PARENT_REPOSITORY_NOTE =
  "A sub-task works in its parent's repository, so the two must share one.";

/**
 * The task a menu relates: a list's row of it, or the open task, whose
 * blocks the list does not carry, so a row's menu judges only the tree's
 * kinds and leaves a block already standing to the service's refusal.
 */
export type TaskRelationSubject = TaskSummary & Pick<Task, "blockedBy" | "blocks">;

/** The tasks standing above one whose parent is `parentId`, walking up by parents through the tasks the list holds and stopping at a loop. */
function ancestors(
  byId: ReadonlyMap<string, TaskSummary>,
  parentId: string | undefined,
): Set<string> {
  const above = new Set<string>();
  let at = parentId;

  while (at !== undefined && !above.has(at)) {
    above.add(at);
    at = byId.get(at)?.parentTaskId;
  }

  return above;
}

/**
 * Why `other` cannot take `kind` against `task`, judged over the tasks
 * `byId` holds: already related that way, a loop the service would refuse,
 * or, for a sub-task or a parent, another repository, since a tree works in
 * one; none where it can.
 */
export function relationWhyNot(
  task: TaskRelationSubject,
  other: TaskSummary,
  kind: TaskRelationKind,
  byId: ReadonlyMap<string, TaskSummary>,
): string | undefined {
  const blockedBy = task.blockedBy ?? [];
  const blocks = task.blocks ?? [];

  switch (kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
      if (blockedBy.includes(other.id)) return WHY[kind].already;

      return blocks.includes(other.id) ? WHY[kind].loop : undefined;
    case TASK_RELATION_KIND.BLOCKS:
      if (blocks.includes(other.id)) return WHY[kind].already;

      return blockedBy.includes(other.id) ? WHY[kind].loop : undefined;
    case TASK_RELATION_KIND.SUB_TASK:
      if (other.parentTaskId === task.id) return WHY[kind].already;

      if (ancestors(byId, task.parentTaskId).has(other.id)) return WHY[kind].loop;

      return sameRepository(task.repository, other.repository) ? undefined : OTHER_REPOSITORY;
    case TASK_RELATION_KIND.PARENT:
      if (task.parentTaskId === other.id) return WHY[kind].already;

      if (ancestors(byId, other.parentTaskId).has(task.id)) return WHY[kind].loop;

      return sameRepository(task.repository, other.repository) ? undefined : OTHER_REPOSITORY;
  }
}

/** What a relation write's refusal says: its own reason where the service named one, and a plain refusal otherwise. */
export function relationRefusedNote(failure: RelationCallFailure | ParentCallFailure): string {
  switch (failure) {
    case TASK_BLOCK_FAILURE.CYCLE:
      return BLOCK_CYCLE_NOTE;
    case TASK_PARENT_FAILURE.CYCLE:
      return PARENT_CYCLE_NOTE;
    case TASK_PARENT_FAILURE.REPOSITORY_DIFFERS:
      return PARENT_REPOSITORY_NOTE;
    default:
      return BLOCK_REFUSED_NOTE;
  }
}
