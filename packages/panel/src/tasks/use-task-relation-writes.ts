/**
 * use-task-relation-writes.ts -- a task's repository and relations as the window writes them, and the door to its workspace's GitHub.
 *
 * The surfaces that change a task's repository, its blocks, or its parent
 * read these writes themselves rather than through `TasksControl`. A
 * fixture run's tasks are read from nowhere, so none of its writes go out.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE, type FailureSurface } from "@repo/features/shown-failure";
import {
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  type TaskBlockRelation,
  type TaskBlockRequest,
  type TaskRelationChangeRequest,
} from "@repo/features/task-wire";
import { repositoryChangeFailureNote } from "@repo/features/tasks-model";
import {
  IDLE_TASKS_VIEW,
  type ParentCallFailure,
  type RelationCallFailure,
  TASK_BLOCK_FAILURE,
  TASK_CALL_FAILURE,
  TASK_PARENT_FAILURE,
  type TasksBlockAnswer,
  type TasksChangeRelationAnswer,
  type TasksSetParentAnswer,
  type TasksView,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { STATUS_TONE } from "@repo/ui";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { type Unreached, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { drawnTask, heldTask, pressWrite, type TaskRows, type UndoWrite } from "../undo-stack.js";
import {
  appStateIn,
  appStateQuery,
  selectFixtureStaged,
  selectListedTasks,
} from "../use-app-state.js";
import { useTaskRowDoors } from "./task-row-doors.js";

/** What the toast says when the service kept no change to a task's blocks, which stand as they were. */
const BLOCK_REFUSED_NOTE = "That relation could not be changed. Try again.";

/** What the toast says when a block would close a cycle, the other task already waiting on this one. */
const BLOCK_CYCLE_NOTE = "That task already waits on this one, so it can't block it too.";

/** What the toast says when a parent would put the task under itself, the other task already a sub-task of it. */
const PARENT_CYCLE_NOTE =
  "That task is already a sub-task of this one, so it can't be its parent too.";

/** What the toast says when a parent works in another repository, which a sub-task always shares. */
const PARENT_REPOSITORY_NOTE =
  "A sub-task works in its parent's repository, so the two must share one.";

/** What the toast says once a task's parent is removed, offering Undo. */
const PARENT_REMOVED_NOTE = "Parent removed";

/** What the toast says once a block is removed, offering Undo. */
const BLOCK_REMOVED_NOTE = "Relation removed";

/** A task's act that never answered, settled as unanswered with the error beneath. */
const taskUnreached = unreachedAs(TASK_CALL_FAILURE.UNANSWERED);

/** What a relation's refusal says: its own reason where the service named one, and a plain refusal otherwise. */
function relationRefusedNote(failure: RelationCallFailure | ParentCallFailure): string {
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

/** A relation write's answer as the window hears it: the service's, or one that never arrived. */
type RelationAnswer =
  | TasksBlockAnswer
  | TasksSetParentAnswer
  | TasksChangeRelationAnswer
  | Unreached<typeof TASK_CALL_FAILURE.UNANSWERED>;

/** A relation write's act, settled as unanswered where it never answered, so it never rejects. */
function relationAsked<Answer extends RelationAnswer>(
  asked: Promise<Answer>,
): Promise<Answer | Unreached<typeof TASK_CALL_FAILURE.UNANSWERED>> {
  return asked.catch(taskUnreached);
}

/** What a relation write's refusal says; nothing where the service kept it. */
function relationRefused(answer: RelationAnswer): string | undefined {
  return "failure" in answer ? relationRefusedNote(answer.failure) : undefined;
}

/** A block a press took away: the task it was taken from, the other task, and the side the other stood on. */
interface BlockRemoved {
  readonly taskId: string;
  readonly relation: TaskBlockRelation;
  readonly otherId: string;
}

/** A parent a press cleared: the task, and the parent it had. */
interface ParentRemoved {
  readonly taskId: string;
  readonly parentTaskId: string;
}

/** Whether the task's plan, as the host holds it, lists the block; none where it holds no plan of it, as the list carries no blocks. */
function blockStands(rows: TaskRows, { taskId, relation, otherId }: BlockRemoved) {
  const task = heldTask(rows, taskId);
  if (task === undefined) return undefined;
  const side = relation === TASK_BLOCK_RELATION.BLOCKED_BY ? task.blockedBy : task.blocks;
  return side?.includes(otherId) ?? false;
}

/**
 * The relation writes ⌘Z takes back, which ask nothing first since each can
 * be added back: a block taken away, added again only while the task still
 * stands without it, and a parent cleared, set again only while the task
 * still stands at the top. A refusal says why in the relation's own words.
 */
const RELATION_WRITE = {
  BLOCK_REMOVAL: {
    words: BLOCK_REMOVED_NOTE,
    unmasked: () => true,
    kind: ACT_KIND.TASKS_BLOCK,
    read: (_rows, removed) => removed,
    act: (send, { taskId, relation, otherId }) =>
      relationAsked(
        send({ taskId, block: { change: TASK_BLOCK_CHANGE.REMOVE, relation, taskId: otherId } }),
      ),
    undo: (send, { taskId, relation, otherId }) =>
      relationAsked(
        send({ taskId, block: { change: TASK_BLOCK_CHANGE.ADD, relation, taskId: otherId } }),
      ),
    holds: (rows, removed) => blockStands(rows, removed) === false,
    undone: (rows, removed) => blockStands(rows, removed) === true,
    refused: relationRefused,
    surface: FAILURE_SURFACE.TASK_BLOCK,
    about: ({ taskId }) => ({ taskId }),
  } satisfies UndoWrite<
    TaskRows,
    BlockRemoved,
    BlockRemoved,
    typeof ACT_KIND.TASKS_BLOCK,
    RelationAnswer
  >,
  PARENT_REMOVAL: {
    words: PARENT_REMOVED_NOTE,
    unmasked: () => true,
    kind: ACT_KIND.TASKS_SET_PARENT,
    read: (rows, { taskId }) => {
      const parentTaskId =
        drawnTask(rows, taskId)?.parentTaskId ?? heldTask(rows, taskId)?.parentTaskId;
      return parentTaskId === undefined ? undefined : { taskId, parentTaskId };
    },
    act: (send, { taskId }) => relationAsked(send({ taskId, parentTaskId: null })),
    undo: (send, { taskId, parentTaskId }) => relationAsked(send({ taskId, parentTaskId })),
    holds: (rows, { taskId }) => {
      const task = drawnTask(rows, taskId);
      return task !== undefined && task.parentTaskId === undefined;
    },
    undone: (rows, { taskId, parentTaskId }) =>
      drawnTask(rows, taskId)?.parentTaskId === parentTaskId,
    refused: relationRefused,
    surface: FAILURE_SURFACE.TASK_PARENT,
    about: ({ taskId }) => ({ taskId }),
  } satisfies UndoWrite<
    TaskRows,
    { readonly taskId: string },
    ParentRemoved,
    typeof ACT_KIND.TASKS_SET_PARENT,
    RelationAnswer
  >,
} as const;

/**
 * The tasks the window lists as they stand now, a fixture run's among them.
 * Note that a name being typed is not drawn over them, as the Tasks tab's
 * own view draws it, because a relation's rows read its parent and blocks
 * alone.
 */
function listedIn(queryClient: QueryClient): TasksView {
  const state = appStateIn(queryClient);
  return state === undefined ? IDLE_TASKS_VIEW : selectListedTasks(state);
}

/** A task's repository and relation writes, each said in a toast where the service refused it. */
export interface TaskRelationWrites {
  /** Gives a task its repository, or takes it away with null; answers why the service refused, or nothing once it is kept. */
  readonly onSetRepository: (
    taskId: string,
    repository: string | null,
  ) => Promise<string | undefined>;
  /** Adds one block of a task or takes it away, which the open document draws as the service answers it; a refusal says why in a toast. */
  readonly onSetTaskBlock: (taskId: string, block: TaskBlockRequest) => void;
  /** Sets a task's parent, or clears it with null, which the sidebar and the open document draw as the service answers it; a refusal says why in a toast. */
  readonly onSetTaskParent: (taskId: string, parentTaskId: string | null) => void;
  /** Takes a task out from under its parent, said in a toast whose Undo sets the parent back; nothing for a task with none. */
  readonly onRemoveTaskParent: (taskId: string) => void;
  /** Takes one block of a task away, said in a toast whose Undo adds it back; a refusal says why in a toast. */
  readonly onRemoveTaskBlock: (
    taskId: string,
    relation: TaskBlockRelation,
    otherId: string,
  ) => void;
  /** Moves one relation of a task to another kind in one call, drawn as the service answers it; a refusal says why in a toast. */
  readonly onChangeTaskRelation: (taskId: string, relation: TaskRelationChangeRequest) => void;
}

/**
 * A task's repository and relation writes. The sidebar and the open
 * document take the task the service answers, so a refusal is all there is
 * to say, in a toast in the relation's own words, since the menu that asked
 * has closed. Remove relation and Remove parent ask nothing, since either
 * can be added back: once the service keeps it, ⌘Z and its toast's Undo add
 * it again, while the task still stands as the removal left it.
 */
export function useTaskRelationWrites(): TaskRelationWrites {
  const queryClient = useQueryClient();
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const { mutateAsync: sendTaskRepository } = useMutation(
    actMutation(ACT_KIND.TASKS_SET_REPOSITORY),
  );
  // ⌘Z reads a removal's rows off the tasks listed as it runs (`task-row-doors.ts`).
  const listedNow = useCallback(() => listedIn(queryClient), [queryClient]);
  const blockDoors = useTaskRowDoors(ACT_KIND.TASKS_BLOCK, listedNow);
  const parentDoors = useTaskRowDoors(ACT_KIND.TASKS_SET_PARENT, listedNow);
  const { mutateAsync: sendRelation } = useMutation(actMutation(ACT_KIND.TASKS_CHANGE_RELATION));
  const toast = useToast();
  const { send: sendBlock } = blockDoors;
  const { send: sendParent } = parentDoors;
  // The relation writes' one recipe.
  const askRelation = (
    surface: FailureSurface,
    taskId: string,
    asked: () => Promise<RelationAnswer>,
  ) => {
    if (staged) return;
    void relationAsked(asked()).then((answer) => {
      const words = relationRefused(answer);
      if (words === undefined) return;
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface, cause: answer, about: { taskId } },
      });
    });
  };
  return {
    onSetRepository: (taskId, repository) => {
      if (staged) return Promise.resolve(undefined);
      return sendTaskRepository({ taskId, repository }).then(
        (answer) => ("failure" in answer ? repositoryChangeFailureNote(answer.failure) : undefined),
        (refused: Error) => refused.message,
      );
    },
    onSetTaskBlock: (taskId, block) =>
      askRelation(FAILURE_SURFACE.TASK_BLOCK, taskId, () => sendBlock({ taskId, block })),
    onSetTaskParent: (taskId, parentTaskId) =>
      askRelation(FAILURE_SURFACE.TASK_PARENT, taskId, () => sendParent({ taskId, parentTaskId })),
    // A relation's kind moves in one call, so a refusal leaves it as it stood.
    onChangeTaskRelation: (taskId, relation) =>
      askRelation(FAILURE_SURFACE.TASK_RELATION, taskId, () => sendRelation({ taskId, relation })),
    onRemoveTaskBlock: (taskId, relation, otherId) => {
      if (staged) return;
      void pressWrite(RELATION_WRITE.BLOCK_REMOVAL, blockDoors, { taskId, relation, otherId });
    },
    onRemoveTaskParent: (taskId) => {
      if (staged) return;
      void pressWrite(RELATION_WRITE.PARENT_REMOVAL, parentDoors, { taskId });
    },
  };
}

/**
 * Opens Settings › Workspace at its GitHub, for the workspace the task
 * belongs to: the list's, else the open document's where the list read did
 * not land.
 */
export function useOpenWorkspaceGitHub(
  onOpenSettings: (link: SettingsLink) => void,
): (taskId: string) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (taskId: string) => {
      const listed = listedIn(queryClient);
      const held = appStateIn(queryClient)?.[LIVE_READ.DESCRIPTION_DOCUMENT];
      const workspaceId =
        listed.tasks.find((task) => task.id === taskId)?.workspaceId ??
        (listed.activeTaskId === taskId
          ? heldTask({ tasks: listed, held }, taskId)?.workspaceId
          : undefined);
      onOpenSettings({
        page: SETTINGS_VIEW.WORKSPACE,
        section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
        ...(workspaceId === undefined ? undefined : { workspaceId }),
      });
    },
    [queryClient, onOpenSettings],
  );
}
