/**
 * use-standing-writes.tsx -- where a task stands, its status, priority, or assignee, as each surface setting it sends it itself.
 *
 * A change of where a task stands is drawn by main the moment it is asked
 * (`@repo/host`'s `task-list-collections.ts`), so the view already carries
 * it, and put back by main where the service refused. A change the service
 * kept is ⌘Z's to take back (`undo-stack.ts`). A fixture's tasks are read
 * from nowhere, so nothing keeps where they stand. Setting a task whose
 * agents are running at Done or Canceled asks first, in red, since it stops
 * them and the work they are in the middle of; confirmed, it is sent as a
 * settle that stops them, and the surface draws the question beside it.
 */

import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { agentStillWriting, agentsOfTask } from "@repo/features/task-agents-model";
import {
  isTaskSettled,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  type SettledStatus,
  type StatusChange,
  type StopAgentsWords,
  settleChanges,
  settledNote,
  settleFailedNote,
  settleStopWords,
} from "@repo/features/tasks-model";
import type { TasksView } from "@repo/features/tasks-view";
import { CONFIRM_LOSS, ConfirmDialog, STATUS_TONE, useConfirmDialog } from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { askKept, firstRefusal, KEPT, type Kept, notKept } from "../act.js";
import { confirmFailure } from "../failure-report.js";
import { useToast } from "../toast.js";
import { heldTask, pressRows, ROW_WRITE, type TaskRows } from "../undo-stack.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { useTaskRowDoors } from "./task-row-doors.js";

/** What ⌘Z's toast calls a change of a task's priority it takes back or puts back. */
const PRIORITY_CHANGED_NOTE = "Priority changed";

/** What ⌘Z's toast calls a change of who a task is assigned to, by whether it names anyone. */
const ASSIGNEE_CHANGED_NOTES = {
  ASSIGNED: "Task assigned",
  UNASSIGNED: "Task unassigned",
} as const;

/** What ⌘Z's toast calls a change of where one task stands, by what it changed. */
function standingNote(standing: TaskStanding): string {
  if (standing.status !== undefined) return settledNote(standing.status, 1, 0);
  if (standing.assigneeId === undefined) return PRIORITY_CHANGED_NOTE;
  return standing.assigneeId === null
    ? ASSIGNEE_CHANGED_NOTES.UNASSIGNED
    : ASSIGNEE_CHANGED_NOTES.ASSIGNED;
}

/** What a question asks before it is asked, which no reader sees. */
const NO_WORDS: StopAgentsWords = { title: "", body: "", verb: "" };

/** What the act's button says while the stop goes out. */
const STOPPING = "Stopping agents";

/** A settle held for its question while the tasks' agents run: the changes it sends once confirmed, and what it asks. */
interface HeldSettle {
  readonly changes: readonly StatusChange[];
  readonly status: SettledStatus;
  readonly words: StopAgentsWords;
}

/** The tasks as the list holds them, or the open document where the list does not hold one yet. */
function standingTasksOf(rows: TaskRows, taskIds: readonly string[]): readonly TaskSummary[] {
  const { activeTaskId } = rows.tasks;
  const held = activeTaskId === undefined ? undefined : heldTask(rows, activeTaskId);
  return taskIds.flatMap((taskId): readonly TaskSummary[] => {
    const task = rows.tasks.tasks.find((each) => each.id === taskId);
    if (task !== undefined) return [task];
    return held?.id === taskId ? [held] : [];
  });
}

/** Whether any of the task's agents is starting or running, read off the agents the list follows, else its count of them. */
function agentsWorking(rows: TaskRows, task: TaskSummary): boolean {
  const listed = rows.tasks.taskAgents;
  return listed === undefined
    ? (task.agents?.working ?? 0) > 0
    : agentsOfTask(listed, task.id).some((agent) => agentStillWriting(agent.status));
}

/** The standing writes a surface sends. */
export interface StandingWrites {
  /** Sets where a task stands, how much it matters, or who it is assigned to, drawn at once by the assignee's name where the caller knows it; answers whether the service kept it, with what refused it where it did not. */
  onSetTaskStanding: (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ) => Promise<Kept>;
  /**
   * Sets one task or several at a status, as Mark done, Cancel task, a
   * group's Mark tasks done, and the Tasks page's selection ask: each drawn
   * there at once, and one toast for them all once the service answered,
   * naming how many it refused, whose Undo puts back the status each stood
   * at. A task already there is left as it stands.
   */
  onSettleTasks: (taskIds: readonly string[], status: TaskStatus) => void;
  /** The question Done or Canceled asks while a task's agents run, which the surface draws beside what it sets. */
  dialog: React.JSX.Element;
}

/**
 * The standing writes, each ⌘Z's to take back once kept, their rows read
 * off `drawn`, the tasks the Tasks tab draws as they stand at the call
 * (`TasksControl`'s `drawnTasks`), and the open document as the host holds
 * it for the window.
 */
export function useStandingWrites(drawn: () => TasksView): StandingWrites {
  const toast = useToast();
  const fixture = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const standingDoors = useTaskRowDoors(ROW_WRITE.TASK_STANDING.kind, drawn);
  const sendStandingRow = standingDoors.send;

  // A change of where a task stands, its status, priority, or assignee, is
  // sent, which main draws at once and puts back where the service refused
  // it. Answers whether the service kept it, with what refused it where it did not.
  const sendStanding = (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
    stopAgents?: true,
  ): Promise<Kept> => {
    // Note that the name the reader knows a member by goes with them, so main draws them by it until the list carries them.
    const named = standing.assigneeId && assigneeName !== undefined ? { assigneeName } : undefined;
    const stopping = stopAgents === undefined ? undefined : { stopAgents };
    return askKept(sendStandingRow({ taskId, ...standing, ...named, ...stopping }));
  };
  // Each status change is sent as one standing, stopping the tasks' agents
  // where the reader confirmed it. Answers which tasks the service kept, how
  // many it refused, and what refused the first of them.
  const sendStatuses = (changes: readonly StatusChange[], stopAgents?: true) => {
    const answers = changes.map(({ taskId, status }) =>
      sendStanding(taskId, { status }, undefined, stopAgents),
    );
    return Promise.all(answers).then((changed) => {
      const landed = changes
        .filter((_, index) => changed[index]?.kept === true)
        .map(({ taskId }) => taskId);
      return { landed, refused: changes.length - landed.length, cause: firstRefusal(changed) };
    });
  };

  // Tasks set at a status by one press answer with one toast rather than
  // one each, and are one entry for ⌘Z, whose Undo the toast runs: it puts
  // back the status of every task the service kept that still stands where
  // the press left it (`undo-stack.ts`). The open task stays open, since a
  // task done or canceled is still read and worked on.
  const settled = (asked: readonly StatusChange[], status: TaskStatus, stopAgents?: true) => {
    const pressed = pressRows(
      ROW_WRITE.TASK_STANDING,
      standingDoors,
      asked.map((change) => ({ id: change.taskId, after: { status: change.status } })),
    );
    sendStatuses(asked, stopAgents).then(({ landed, refused, cause }) => {
      if (landed.length === 0) {
        toast({
          replayUnmasked: true,
          words: settleFailedNote(status, refused),
          tone: STATUS_TONE.DANGER,
          failure: { surface: FAILURE_SURFACE.TASK_SETTLE, cause },
        });
        return;
      }
      const words = settledNote(status, landed.length, refused);
      const said = pressed.keep(words, (taskId) => landed.includes(taskId));
      if (said !== undefined) toast(said);
    });
  };

  // A settle confirmed is sent as one that stops the tasks' agents; the question stands while the surface does.
  const [held, setHeld] = useState<HeldSettle>();
  const confirm = useConfirmDialog(
    { subject: held !== undefined, surfaceOpen: true },
    neverBusyAct(() => {
      if (held !== undefined) settled(held.changes, held.status, true);
    }),
    confirmFailure(FAILURE_SURFACE.TASK_SETTLE),
  );
  // Done or Canceled asks first where an agent of a task it changes is running.
  // Answers whether it asked, which leaves the change to the answer.
  const askedFirst = (tasks: readonly TaskSummary[], asked: readonly StatusChange[]) => {
    const status = asked[0]?.status;
    if (!isTaskSettled(status)) return false;
    const rows = standingDoors.rows();
    const changed = tasks.filter((task) => asked.some((change) => change.taskId === task.id));
    if (!changed.some((task) => agentsWorking(rows, task))) return false;
    setHeld({ changes: asked, status, words: settleStopWords(status) });
    confirm.ask();
    return true;
  };

  const settleTasks = (taskIds: readonly string[], status: TaskStatus) => {
    if (fixture) return;
    const tasks = standingTasksOf(standingDoors.rows(), taskIds);
    const asked = settleChanges(tasks, status);
    if (asked.length === 0 || askedFirst(tasks, asked)) return;
    settled(asked, status);
  };

  // A fixture's tasks are read from nowhere, so nothing keeps where they
  // stand. A change the service kept is ⌘Z's to take back.
  const setTaskStanding = (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ): Promise<Kept> => {
    if (fixture) return Promise.resolve(notKept(FAILURE_CONDITION.NOT_KEPT));
    // Note that a change that asks first answers as kept, because nothing went out the service could refuse; once confirmed it toasts as a settle.
    if (standing.status !== undefined) {
      const tasks = standingTasksOf(standingDoors.rows(), [taskId]);
      if (askedFirst(tasks, settleChanges(tasks, standing.status))) return Promise.resolve(KEPT);
    }
    const { assigneeId, ...rest } = standing;
    const assignee =
      assigneeId === undefined
        ? undefined
        : {
            assignee: assigneeId === null ? null : { userId: assigneeId, name: assigneeName ?? "" },
          };
    const pressed = pressRows(ROW_WRITE.TASK_STANDING, standingDoors, [
      { id: taskId, after: { ...rest, ...assignee } },
    ]);
    return sendStanding(taskId, standing, assigneeName).then((kept) => {
      if (kept.kept) pressed.keep(standingNote(standing));
      return kept;
    });
  };

  return {
    onSetTaskStanding: setTaskStanding,
    onSettleTasks: settleTasks,
    dialog: (
      <ConfirmDialog
        open
        confirm={confirm}
        question={{
          ...(held?.words ?? NO_WORDS),
          running: STOPPING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
        }}
      />
    ),
  };
}
