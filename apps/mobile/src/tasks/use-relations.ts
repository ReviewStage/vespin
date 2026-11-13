/**
 * use-relations.ts -- a task's relations as the app's screens write them: a task related to another as one of the four kinds, a relation moved to another kind or taken away, and a task taken out from under its parent, each sent as the panel sends it.
 *
 * What a relation is called, and why a task cannot take one, is the panel's
 * own model (`@repo/features/task-relation-model`); this only sends the acts
 * on the host's port, which draws each as the service answers it, and says
 * a refusal in the panel's words for it.
 */

import { relationRefusedNote } from "@repo/features/task-relation-model";
import {
  TASK_BLOCK_CHANGE,
  TASK_RELATION_KIND,
  type TaskBlockRequest,
  type TaskRelationKind,
} from "@repo/features/task-wire";
import {
  TASK_CALL_FAILURE,
  type TasksBlockAnswer,
  type TasksChangeRelationAnswer,
  type TasksSetParentAnswer,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ } from "@repo/ui-native";
import { useMemo } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** A relation write's answer: the relation as it then stands, or why it is unchanged. */
type RelationAnswer = TasksBlockAnswer | TasksSetParentAnswer | TasksChangeRelationAnswer;

/** What a relation write's refusal says; nothing where the service kept it. */
function refusedNote(answer: RelationAnswer): string | undefined {
  return "failure" in answer ? relationRefusedNote(answer.failure) : undefined;
}

/** The task whose parent a relation of `kind` sets: the task itself for its parent, the other task for its sub-task, none for a block. */
function parentChild(kind: TaskRelationKind, taskId: string, otherId: string): readonly string[] {
  if (kind === TASK_RELATION_KIND.PARENT) return [taskId];

  return kind === TASK_RELATION_KIND.SUB_TASK ? [otherId] : [];
}

/** A task's relation writes. */
export interface TaskRelationWrites {
  /** Relates `otherId` to `taskId` as `kind`, as the panel's Task relation does once a task is picked. */
  readonly relate: (taskId: string, kind: TaskRelationKind, otherId: string) => void;
  /** Moves how `otherId` stands to `taskId` from one kind to another in one call, as the panel's Change relation does. */
  readonly change: (
    taskId: string,
    otherId: string,
    from: TaskRelationKind,
    to: TaskRelationKind,
  ) => void;
  /** Takes away how `otherId` stands to `taskId` as `kind`, as the panel's Remove relation does. */
  readonly remove: (taskId: string, kind: TaskRelationKind, otherId: string) => void;
  /** Takes a task out from under its parent, as the panel's Remove parent does. */
  readonly removeParent: (taskId: string) => void;
}

/**
 * A task's relation writes, as the panel's (`useTaskRelationWrites`) send
 * them: a block as the blocks' change (`TASKS_BLOCK`), a sub-task or a
 * parent as a parent set (`TASKS_SET_PARENT`), and a kind moved in one call
 * (`TASKS_CHANGE_RELATION`), so a refusal leaves it as it stood. Note that
 * a removal asks nothing first, as the panel's does, since it can be added
 * back from the same menu.
 */
export function useTaskRelationWrites(): TaskRelationWrites {
  const acts = useHostActs();
  const write = useWrite();

  return useMemo(() => {
    const saying = {
      refused: refusedNote,
      // Note that only a write that got no answer is offered again, since a loop or another repository is refused again.
      retry: (answer: RelationAnswer) =>
        "failure" in answer && answer.failure === TASK_CALL_FAILURE.UNANSWERED,
      went: BUZZ.SUCCESS,
    };

    const block = (taskId: string, request: TaskBlockRequest) => {
      void write(() => acts[ACT_KIND.TASKS_BLOCK]({ taskId, block: request }), saying);
    };

    const parent = (taskId: string, parentTaskId: string | null) => {
      // Note that the parent is one value per task, so a newer parent set makes an older one's Try again do nothing.
      void write(() => acts[ACT_KIND.TASKS_SET_PARENT]({ taskId, parentTaskId }), {
        ...saying,
        subject: { kind: WRITE_SUBJECT.TASK_PARENT, id: taskId },
      });
    };

    const sendRelation = (
      change: TaskBlockRequest["change"],
      taskId: string,
      kind: TaskRelationKind,
      otherId: string,
    ) => {
      const adding = change === TASK_BLOCK_CHANGE.ADD;

      switch (kind) {
        case TASK_RELATION_KIND.BLOCKED_BY:
        case TASK_RELATION_KIND.BLOCKS:
          block(taskId, { change, relation: kind, taskId: otherId });

          return;
        case TASK_RELATION_KIND.SUB_TASK:
          parent(otherId, adding ? taskId : null);

          return;
        case TASK_RELATION_KIND.PARENT:
          parent(taskId, adding ? otherId : null);

          return;
      }
    };

    return {
      relate: (taskId, kind, otherId) => sendRelation(TASK_BLOCK_CHANGE.ADD, taskId, kind, otherId),
      change: (taskId, otherId, from, to) => {
        if (from === to) return;
        // Note that a change into or out of a parent or a sub-task sets that child's parent, so it voids an older parent set's Try again, and a newer one voids its own.
        const children = [from, to].flatMap((kind) => parentChild(kind, taskId, otherId));
        void write(
          () =>
            acts[ACT_KIND.TASKS_CHANGE_RELATION]({
              taskId,
              relation: { taskId: otherId, from, to },
            }),
          {
            ...saying,
            subject: [...new Set(children)].map((id) => ({ kind: WRITE_SUBJECT.TASK_PARENT, id })),
          },
        );
      },
      remove: (taskId, kind, otherId) =>
        sendRelation(TASK_BLOCK_CHANGE.REMOVE, taskId, kind, otherId),
      removeParent: (taskId) => parent(taskId, null),
    };
  }, [acts, write]);
}
