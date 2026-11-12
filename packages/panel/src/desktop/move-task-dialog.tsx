import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  MOVE_PART,
  type MovePart,
  mayMoveTask,
  moveAgentsParts,
  moveChosen,
  moveGainParts,
  moveLossParts,
  moveTargetLine,
  moveTargets,
  TASK_MOVE_WORDS,
  workspaceTakesTask,
} from "@repo/features/task-move-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { strandedTaskHome } from "@repo/features/tasks-model";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  ChoiceList,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  ErrorState,
  SCROLL_SIZE,
  ScrollArea,
  useConfirmDialog,
} from "@repo/ui";
import { CONFIRM_STAGE, confirmAsked } from "@repo/ui/confirm-state";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

/**
 * move-task-dialog.tsx -- Move to workspace, from a task's ⋯: the account's other workspaces to move the task to, and what the move does.
 *
 * The menu offers it on a task the reader started, while the account is in
 * another workspace, because the service lets only a task's owner move it.
 * Where the list does not say who started a task (a service before it), or
 * the window does not know who is signed in, it is offered all the same,
 * and the service's refusal says the rest.
 *
 * The dialog lists every other workspace with its tile, its name, and who
 * shares it. One whose GitHub cannot reach the task's repository is listed
 * disabled, saying why, because the service refuses that move as it would a
 * change of repository; a task with no repository can go anywhere. The
 * first that can take it is chosen. Under the list it says what the move
 * does for the one chosen: who in the task's workspace loses it, who in the
 * other gains it, and that its agents go with it. The dialog is the move's
 * confirmation, so its act is the move itself, at the foot of a `Dialog` that
 * picks a destination rather than a `ConfirmDialog`, which only asks yes or
 * no. The question goes with its task and its surface (`@repo/ui`'s
 * `useConfirmDialog`), a move landed puts it away, and a refused one keeps it up saying so under the
 * list, the toast the move would raise held back in its favor.
 */

/** A line of what the move does, each workspace it names kept masked in a screen recording. */
function MoveLine({ parts }: { parts: readonly MovePart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === MOVE_PART.WORDS ? (
          part.text
        ) : (
          <ReplayMask key={index}>{part.name}</ReplayMask>
        ),
      )}
    </>
  );
}

/** The workspaces as a radio group: a tile, a name, and a line each, the chosen one checked and the keyboard's one stop. */
function WorkspaceChoices({
  workspaces,
  personalId,
  repository,
  chosen,
  disabled,
  first,
  onChoose,
}: {
  workspaces: readonly Workspace[];
  /** The account's own first workspace, which a row calls personal while no one else is in it. */
  personalId: string | undefined;
  repository: string | null;
  chosen: Workspace | undefined;
  disabled: boolean;
  /** The chosen row, which takes focus as the dialog opens. */
  first: React.RefObject<HTMLButtonElement | null>;
  onChoose: (workspaceId: string) => void;
}): React.JSX.Element {
  const options = workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
    detail: moveTargetLine(workspace, repository, personalId),
    mark: (
      <ReplayMask>
        <WorkspaceTile workspace={workspace} size={TILE_SIZE.ROW} />
      </ReplayMask>
    ),
    disabled: !workspaceTakesTask(workspace, repository),
    replayMasked: true,
  }));

  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT}>
      <ChoiceList
        legend={TASK_MOVE_WORDS.LEGEND}
        options={options}
        value={chosen === undefined ? [] : [chosen.id]}
        disabled={disabled}
        focusRef={first}
        onChange={([workspaceId]) => {
          if (workspaceId !== undefined) onChoose(workspaceId);
        }}
      />
    </ScrollArea>
  );
}

/** The dialog over the window while the move is asked, running, or refused, and through its fade as it goes. */
function MoveTaskCard({
  open,
  confirm,
  task,
  from,
  workspaces,
  personalId,
  chosen,
  onChoose,
}: {
  /** Whether the move is asked, running, or refused; falling, the card fades out. */
  open: boolean;
  confirm: DialogConfirm;
  task: TaskSummary;
  from: Workspace | undefined;
  workspaces: readonly Workspace[];
  personalId: string | undefined;
  chosen: Workspace | undefined;
  onChoose: (workspaceId: string) => void;
}): React.JSX.Element {
  const { stage, rejection } = confirm;
  const moving = stage === CONFIRM_STAGE.ACTING;
  const first = useRef<HTMLButtonElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);

  const dismiss = () => {
    if (moving) return;
    confirm.keep();
    confirm.clear();
  };

  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.CONFIRM}
      title={`Move “${task.name}” to another workspace`}
      busy={moving}
      initialFocus={chosen === undefined ? cancel : first}
      onDismiss={dismiss}
      actions={
        <DialogActions
          onCancel={dismiss}
          cancelRef={cancel}
          act={{
            verb: chosen === undefined ? "Move" : `Move to ${chosen.name}`,
            tone: DIALOG_TONE.PRIMARY,
            running: "Moving",
            busy: moving,
            disabled: chosen === undefined,
            onPress: () => confirm.run(),
          }}
        />
      }
    >
      <div className="move-dialog flex min-h-0 flex-col gap-block-gap">
        <ReplayUnmask>
          <WorkspaceChoices
            workspaces={workspaces}
            personalId={personalId}
            repository={task.repository}
            chosen={chosen}
            disabled={moving}
            first={first}
            onChoose={onChoose}
          />
          {chosen === undefined ? null : (
            <ul className="move-effects m-0 grid gap-tight-gap rounded-control bg-muted p-card-inset-snug pl-ui-24 text-body-foreground text-caption">
              <li>
                <MoveLine parts={moveLossParts(from, chosen)} />
              </li>
              <li>
                <MoveLine parts={moveGainParts(chosen)} />
              </li>
              <li>
                <MoveLine parts={moveAgentsParts(chosen)} />
              </li>
            </ul>
          )}
          {rejection !== undefined && !moving ? (
            <ErrorState failure={rejection.failure}>
              <ReplayMask>{rejection.words}</ReplayMask>
            </ErrorState>
          ) : null}
        </ReplayUnmask>
      </div>
    </Dialog>
  );
}

/**
 * The workspace a task's repository belongs to, where the reader may move
 * the task there: a task they own, its own workspace's GitHub
 * not reaching its repository and another of the account's reaching it
 * (`strandedTaskHome`). None for any other task. The task's banner
 * (`stranded-task-banner.tsx`) and its card read it.
 */
export function strandedHome(
  tasks: Pick<TasksControl, "me" | "workspaces">,
  task: TaskSummary,
): Workspace | undefined {
  if (!mayMoveTask(task, tasks.me)) return undefined;

  return strandedTaskHome(task, tasks.workspaces);
}

/** One task's Move to workspace as a door holds it. */
interface MoveTaskDoor {
  /** The menu item's press; absent where the menu does not offer the move. */
  ask: (() => void) | undefined;
  /** The dialog to draw beside the menu, which stands while the move is asked, running, or refused. */
  dialog: React.JSX.Element | null;
}

/** One task's Move to workspace, held for whichever door offers its menu. */
export function useMoveTaskDialog(
  tasks: Pick<TasksControl, "shown" | "me" | "workspaces" | "moveTask">,
  task: TaskSummary | undefined,
): MoveTaskDoor {
  const others = task === undefined ? [] : moveTargets(tasks.workspaces, task);
  const offered = task !== undefined && others.length > 0 && mayMoveTask(task, tasks.me);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const moving = useMutation(tasks.moveTask);
  const repository = task?.repository ?? null;

  const chosen = moveChosen(others, picked, repository);

  const moveAct = useConfirmAct(moving, {
    send: () =>
      task === undefined || chosen === undefined
        ? Promise.resolve()
        : moving.mutateAsync({ taskId: task.id, workspaceId: chosen.id, quiet: true }),
    answered: (moved): ActionResult =>
      moved
        ? { status: ACTION_RESULT_STATUS.ACCEPTED }
        : { status: ACTION_RESULT_STATUS.REJECTED, reason: TASK_MOVE_WORDS.REFUSED },
    refusedFirst: () =>
      task === undefined || chosen === undefined
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: TASK_MOVE_WORDS.CHOOSE }
        : undefined,
  });

  const confirm = useConfirmDialog(
    { subject: offered, surfaceOpen: tasks.shown },
    moveAct,
    confirmFailure(FAILURE_SURFACE.TASK_MOVE),
  );

  const open = confirm.standing && (confirmAsked(confirm.stage) || confirm.rejection !== undefined);

  return {
    ask: offered
      ? () => {
          setPicked(undefined);
          confirm.ask();
        }
      : undefined,
    dialog:
      task !== undefined ? (
        <MoveTaskCard
          open={open}
          confirm={confirm}
          task={task}
          from={tasks.workspaces.find((workspace) => workspace.id === task.workspaceId)}
          workspaces={others}
          personalId={tasks.workspaces[0]?.id}
          chosen={chosen}
          onChoose={setPicked}
        />
      ) : null,
  };
}
