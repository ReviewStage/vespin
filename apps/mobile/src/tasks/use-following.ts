/**
 * use-following.ts -- who follows a task as the app's screens read and change it: its followers, the reader first, each by their face and name, and the reader's Follow, Unfollow, and machines switch.
 *
 * The followers are the task's own on the listed task (`TaskSummary`'s
 * `followers`), which the service sends only while the task's workspace
 * has Following on, so none means no Following to draw; their order and the
 * chip's words are the panel's own model (`@repo/features/task-followers-model`).
 * Each write is the panel's act on the host's port, which draws it on the
 * listed task at once and puts it back where the service refused it.
 */

import {
  type FollowersView,
  followerRefusedNote,
  followersView,
} from "@repo/features/task-followers-model";
import { FOLLOWER_CALL_FAILURE, type TasksFollowersAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { selectInboxReader, selectTasks } from "@repo/host/app-state-reads";
import { BUZZ } from "@repo/ui-native";
import type { TaskFollowerWire } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useMemberFaces } from "../member-pictures.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** One person following a task, as its sheet and chip draw them. */
export interface FollowerFace extends TaskFollowerWire {
  readonly name: string;
  readonly picture: string | undefined;
  /** Whether they are the reader. */
  readonly you: boolean;
}

/** Who follows a task, and the reader's own acts on it. */
export interface TaskFollowing {
  /** The followers, the reader first, then the earliest to follow first. */
  readonly followers: readonly FollowerFace[];
  /** The reader's own follow; none where they don't follow it. */
  readonly reader: FollowersView["reader"];
  /** What the chip says: Following, or Follow. */
  readonly chipWords: string;
  readonly follow: () => void;
  readonly unfollow: () => void;
  readonly setMachines: (on: boolean) => void;
}

/** What names a follower the app holds no member row of, such as one who left the workspace. */
const UNKNOWN_MEMBER = "Former member";

/** What a follower write's refusal says; nothing where the service took it. */
function refusedNote(answer: TasksFollowersAnswer): string | undefined {
  return "failure" in answer ? followerRefusedNote(answer.failure) : undefined;
}

/** Whether another attempt of a refused follower write could go: only one that got no answer. */
function mayRetry(answer: TasksFollowersAnswer): boolean {
  return "failure" in answer && answer.failure === FOLLOWER_CALL_FAILURE.UNANSWERED;
}

/**
 * Who follows the listed task `taskId`, and the reader's Follow, Unfollow,
 * and machines switch on it; none where the list holds no followers for it,
 * as it holds none while its workspace has Following off.
 */
export function useTaskFollowing(taskId: string): TaskFollowing | undefined {
  const acts = useHostActs();
  const write = useWrite();
  const facesOf = useMemberFaces();
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const listed = view?.tasks.find((task) => task.id === taskId)?.followers;

  return useMemo(() => {
    if (listed === undefined) return undefined;
    const drawn = followersView(listed, readerId);

    const followers = drawn.followers.map((follower): FollowerFace => {
      const face = facesOf(follower.userId);

      return {
        ...follower,
        name: face?.name ?? UNKNOWN_MEMBER,
        picture: face?.picture,
        you: follower.userId === readerId,
      };
    });

    // Note that a follow and its switch tap as a toggle does, lighter than a status's buzz, and all three share the task's one subject, so a newer one makes an older one's Try again do nothing.
    const saying = {
      refused: refusedNote,
      retry: mayRetry,
      subject: { kind: WRITE_SUBJECT.TASK_FOLLOWING, id: taskId },
      went: BUZZ.SELECTION,
    } as const;

    return {
      followers,
      reader: drawn.reader,
      chipWords: drawn.chipWords,
      follow: () => void write(() => acts[ACT_KIND.TASKS_FOLLOW]({ taskId }), saying),
      unfollow: () => void write(() => acts[ACT_KIND.TASKS_UNFOLLOW]({ taskId }), saying),
      setMachines: (machines) =>
        void write(() => acts[ACT_KIND.TASKS_SET_FOLLOWER_MACHINES]({ taskId, machines }), saying),
    };
  }, [listed, readerId, facesOf, acts, write, taskId]);
}
