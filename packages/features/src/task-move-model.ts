/**
 * task-move-model.ts -- Move to workspace as every client offers it: who may move a task, the workspaces it may go to and why one cannot take it, the one chosen, and what the move does, in the panel's words.
 *
 * The service lets only a task's owner move it, and refuses a workspace
 * whose GitHub cannot reach the task's repository, as it would a change of
 * repository; a task with no repository can go anywhere. What the move does
 * is said of the workspace chosen: who in the task's workspace loses it, and
 * who in the other gains it. Each line is read as parts, the words and the
 * workspaces they name, so a client that masks a workspace's name in a
 * screen recording, as the panel does, masks it alone, and one that does not
 * reads the line whole (`movePartsText`).
 */

import type { TaskSummary } from "./task-wire.js";
import { workspaceReaches } from "./tasks-model.js";
import { countWords, TERM } from "./words.js";
import { workspaceSharedWords } from "./workspace-tile.js";
import type { Workspace } from "./workspace-wire.js";

/** What Move to workspace says, in the panel's words. */
export const TASK_MOVE_WORDS = {
  TITLE: "Move to workspace",
  ACT: "Move",
  LEGEND: "Workspace",
  /** What it says when the service refused the move, which leaves the task where it was. */
  REFUSED: "The task could not be moved. Try again.",
  /** What it says where no workspace can take the task. */
  CHOOSE: "Choose a workspace.",
  /** What the act says while the move is out. */
  RUNNING: "Moving",
} as const;

/** What the move asks over its list, naming the task. */
export function moveTitle(taskName: string): string {
  return `Move “${taskName}” to another workspace`;
}

/** What the act says: the move to the workspace chosen, or Move where none can take the task. */
export function moveVerb(chosen: Pick<Workspace, "name"> | undefined): string {
  return chosen === undefined ? TASK_MOVE_WORDS.ACT : `Move to ${chosen.name}`;
}

/** The kinds of a line's parts: its words, and a workspace it names. */
export const MOVE_PART = {
  WORDS: "words",
  WORKSPACE: "workspace",
} as const;

/** One part of a line of what the move does. */
export type MovePart =
  | { readonly kind: typeof MOVE_PART.WORDS; readonly text: string }
  | { readonly kind: typeof MOVE_PART.WORKSPACE; readonly name: string };

/** Words of a line. */
function words(text: string): MovePart {
  return { kind: MOVE_PART.WORDS, text };
}

/** A workspace a line names. */
function named(workspace: Workspace): MovePart {
  return { kind: MOVE_PART.WORKSPACE, name: workspace.name };
}

/** The workspaces a task may be moved to: every one the account is in but its own. */
export function moveTargets(
  workspaces: readonly Workspace[],
  task: Pick<TaskSummary, "workspaceId">,
): readonly Workspace[] {
  return workspaces.filter((workspace) => workspace.id !== task.workspaceId);
}

/** Whether the reader may be the one to move the task: its owner, where the client cannot tell it is not; a task whose owner's account is gone is no one's to move. */
export function mayMoveTask(task: Pick<TaskSummary, "ownerId">, me: string | undefined): boolean {
  return task.ownerId !== undefined && (me === undefined || task.ownerId === me);
}

/** Whether the workspace's GitHub reaches the task's repository (`workspaceReaches`); a task with no repository goes anywhere. */
export function workspaceTakesTask(
  workspace: Pick<Workspace, "github">,
  repository: string | null,
): boolean {
  return repository === null || workspaceReaches(workspace, repository);
}

/** The workspace chosen: the one picked where it can take the task, else the first that can. */
export function moveChosen(
  targets: readonly Workspace[],
  picked: string | undefined,
  repository: string | null,
): Workspace | undefined {
  return (
    targets.find(
      (workspace) => workspace.id === picked && workspaceTakesTask(workspace, repository),
    ) ?? targets.find((workspace) => workspaceTakesTask(workspace, repository))
  );
}

/** A workspace's line in the list: who shares it, or why it cannot take the task. */
export function moveTargetLine(
  workspace: Workspace,
  repository: string | null,
  personalId: string | undefined,
): string | undefined {
  if (repository === null || workspaceReaches(workspace, repository)) {
    return workspaceSharedWords(workspace.memberCount, workspace.id === personalId);
  }

  const github =
    workspace.github === null ? "No GitHub connected" : `${workspace.github.login} on GitHub`;

  return `${github} · cannot reach ${repository}`;
}

/**
 * Who in the task's workspace loses it: nobody where the reader is alone,
 * else its members who are not in the workspace chosen too. Note that they
 * are not counted, because a client knows how many each workspace holds but
 * not who is in both, and one in both keeps the task.
 */
export function moveLossParts(from: Workspace | undefined, to: Workspace): readonly MovePart[] {
  const losing = words(" lose access to it, its calls, and its agents.");

  if (from === undefined) {
    return [words("Members of its workspace who are not in "), named(to), losing];
  }

  if (from.memberCount !== undefined && from.memberCount <= 1) {
    return [words("Nobody loses access: only you are in "), named(from), words(".")];
  }

  return [words("Members of "), named(from), words(" who are not in "), named(to), losing];
}

/** Who in the workspace chosen gains it: its members counted, or named as its members where they are not. */
export function moveGainParts(to: Workspace): readonly MovePart[] {
  const { memberCount } = to;

  if (memberCount === undefined) {
    return [words("Members of "), named(to), words(" can read and edit it.")];
  }

  if (memberCount <= 1) return [words("Only you can read and edit it in "), named(to), words(".")];

  return [
    words(`${countWords(memberCount, TERM.MEMBER)} in `),
    named(to),
    words(" can read and edit it."),
  ];
}

/** That the task's agents go with it. */
export function moveAgentsParts(to: Workspace): readonly MovePart[] {
  return [words("Its agents keep running, now in "), named(to), words(".")];
}

/** A line read whole, each workspace by its name. */
export function movePartsText(parts: readonly MovePart[]): string {
  return parts.map((part) => (part.kind === MOVE_PART.WORDS ? part.text : part.name)).join("");
}
