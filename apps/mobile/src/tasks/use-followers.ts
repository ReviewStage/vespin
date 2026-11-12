/**
 * use-followers.ts -- a task's followers as the app's task page draws them, and the reader's follow, unfollow, and machines switch, each sent as the panel's Following chip sends it.
 *
 * The followers stand only while the task's workspace has Following on and
 * the task carries them, as the panel's chip does. Who they are, in what
 * order, and what each write's refusal says are the panel's own model
 * (`@repo/features/task-followers-model`); a person's name and face are read
 * against the members of the workspace the phone works in, which the tabs
 * hold followed (`useMemberPicturesFollow`). A write is drawn on the task at
 * once by the host (`compose-tasks.ts`), and a refusal said in the app's one
 * failure notice (`useWrite`).
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  FOLLOWING_WORDS,
  followerName,
  followerRefusedNote,
  followersView,
} from "@repo/features/task-followers-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { FOLLOWER_CALL_FAILURE, type TasksFollowersAnswer } from "@repo/features/tasks-view";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectWorkspaceExperiment } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import { BUZZ, type Face } from "@repo/ui-native";
import type { TaskFollowerWire } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useMemberPictures } from "../member-pictures.js";
import { useWrite } from "../use-write.js";

/** One follower as the page's row draws them. */
export interface FollowerLine {
  readonly follower: TaskFollowerWire;
  /** What the row says: You for the reader, the person's name for anyone else. */
  readonly label: string;
  readonly face: Face;
  /** Whether it is the reader's own row. */
  readonly you: boolean;
}

/** A task's followers and the reader's writes on them, while its workspace has Following on. */
export interface TaskFollowers {
  /** The reader first, where they follow, then the rest in the order they followed. */
  readonly lines: readonly FollowerLine[];
  /** The reader's own follow; none where they do not follow the task. */
  readonly reader: TaskFollowerWire | undefined;
  readonly follow: () => void;
  readonly unfollow: () => void;
  readonly setMachines: (machines: boolean) => void;
}

/** What a follower write's refusal says; nothing where the service took it. */
function refusedNote(answer: TasksFollowersAnswer): string | undefined {
  return "failure" in answer ? followerRefusedNote(answer.failure) : undefined;
}

/** The members of one workspace as the host holds them, as a `select`; none until read. */
function selectMembers(
  workspaceId: string,
): (state: AppStateSnapshot) => readonly WorkspaceMember[] | undefined {
  return (state) => state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId]?.rows?.members;
}

/**
 * The reader's follower writes on one task, as the panel's chip sends them:
 * Follow, Unfollow, and their machines switch. Only a write that got no
 * answer is offered again, since an assignee's unfollow or a task out of
 * reach is refused again.
 */
function useFollowerWrites(taskId: string) {
  const acts = useHostActs();
  const write = useWrite();

  return useMemo(() => {
    const saying = {
      refused: refusedNote,
      retry: (answer: TasksFollowersAnswer) =>
        "failure" in answer && answer.failure === FOLLOWER_CALL_FAILURE.UNANSWERED,
      went: BUZZ.SUCCESS,
    };

    return {
      follow: () => void write(() => acts[ACT_KIND.TASKS_FOLLOW]({ taskId }), saying),
      unfollow: () => void write(() => acts[ACT_KIND.TASKS_UNFOLLOW]({ taskId }), saying),
      setMachines: (machines: boolean) =>
        void write(() => acts[ACT_KIND.TASKS_SET_FOLLOWER_MACHINES]({ taskId, machines }), saying),
    };
  }, [acts, write, taskId]);
}

/**
 * A task's followers as its page lists them, with the reader's writes on
 * them; none while its workspace has Following off or the task carries no
 * followers.
 */
export function useTaskFollowers(
  task: Pick<TaskSummary, "id" | "workspaceId" | "assignee" | "followers">,
): TaskFollowers | undefined {
  const pictureOf = useMemberPictures();
  const writes = useFollowerWrites(task.id);

  const { data: following = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(task.workspaceId, EXPERIMENT.FOLLOWING),
  });

  const { data: readerId } = useQuery({
    ...appStateQuery,
    select: (state: AppStateSnapshot) => signedInAccountId(selectAccount(state)),
  });

  const { data: members } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectMembers(task.workspaceId), [task.workspaceId]),
  });

  // Note that a task carries no followers while its workspace has Following off, so there is nothing to draw for one.
  if (!following || task.followers === undefined) return undefined;
  const view = followersView(task.followers, readerId);

  return {
    lines: view.followers.map((follower) => {
      const name = followerName(follower.userId, members, task.assignee);
      const you = follower === view.reader;

      return {
        follower,
        label: you ? FOLLOWING_WORDS.YOU : name,
        face: { name, picture: pictureOf(follower.userId) },
        you,
      };
    }),
    reader: view.reader,
    ...writes,
  };
}
