/**
 * use-follower-offer.ts -- the members a task's Add a follower offers, and the add, sent as the panel's offer to add a person mentioned sends it.
 *
 * The members are those of the task's own workspace, which the sheet holds
 * followed while it stands, since a task a link opens may stand in another
 * workspace than the one the phone works in. The reader is left out, since
 * Follow is theirs, and one who already follows stands dimmed. The add is the
 * panel's act on the host's port (`TASKS_ADD_FOLLOWER`), which draws it on
 * the listed task at once, and a refusal says the panel's words for it.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { FOLLOWING_WORDS, followerRefusedNote } from "@repo/features/task-followers-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { FOLLOWER_CALL_FAILURE, type TasksFollowersAnswer } from "@repo/features/tasks-view";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot, AppWorkspaceMembersRead } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import { BUZZ, type PersonPickOption } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useMemberPictures } from "../member-pictures.js";
import { useWrite } from "../use-write.js";

/** The members a task's Add a follower offers, and the add. */
export interface FollowerOffer {
  /** Each member but the reader, one who already follows dimmed and saying so; none until the members are read. */
  readonly people: readonly PersonPickOption[] | undefined;
  /** Whether the members could not be read. */
  readonly failed: boolean;
  /** Reads the members again, after a read that failed. */
  readonly retry: () => void;
  /** Adds `userId` as a follower of the task, their machines off, as the panel's Add does; answers whether it went. */
  readonly add: (userId: string) => Promise<boolean>;
}

/** What an add's refusal says; nothing where the service took it. */
function refusedNote(answer: TasksFollowersAnswer): string | undefined {
  return "failure" in answer ? followerRefusedNote(answer.failure) : undefined;
}

/** Whether another attempt of a refused add could go: only one that got no answer. */
function mayRetry(answer: TasksFollowersAnswer): boolean {
  return "failure" in answer && answer.failure === FOLLOWER_CALL_FAILURE.UNANSWERED;
}

/** The read of one workspace's members as the host holds it, as a `select`; none where nobody holds it. */
function selectMembersRead(
  workspaceId: string | undefined,
): (state: AppStateSnapshot) => AppWorkspaceMembersRead | undefined {
  return (state) =>
    workspaceId === undefined ? undefined : state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId];
}

/** A member as Add a follower offers them: their address, or Following where they already follow. */
function offeredPerson(
  member: WorkspaceMember,
  following: ReadonlySet<string>,
  picture: string | undefined,
): PersonPickOption {
  const follows = following.has(member.userId);

  return {
    id: member.userId,
    name: member.name,
    picture,
    line: follows ? FOLLOWING_WORDS.FOLLOWER : member.email,
    disabled: follows,
  };
}

/**
 * The members of a task's workspace that Add a follower offers, the reader
 * left out and one who already follows dimmed, and the add. Note that the add
 * names no write subject, since adding a person twice keeps their one row and
 * nothing on the phone takes another person's follow away, so a stale Try
 * again can never undo a newer write.
 */
export function useFollowerOffer(
  task: Pick<TaskSummary, "id" | "workspaceId" | "followers"> | undefined,
): FollowerOffer {
  const acts = useHostActs();
  const write = useWrite();
  const pictureOf = useMemberPictures();

  const { data: readerId } = useQuery({
    ...appStateQuery,
    select: (state: AppStateSnapshot) => signedInAccountId(selectAccount(state)),
  });

  // Note that the sheet holds its own follow of the members, since the tabs hold only the chosen workspace's.
  useLiveFollow(task?.workspaceId, (workspaceId) =>
    acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId }),
  );

  const { data: read } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectMembersRead(task?.workspaceId), [task?.workspaceId]),
  });

  const members = read?.rows?.members;
  const following = new Set((task?.followers ?? []).map((each) => each.userId));

  return {
    people: members
      ?.filter((member) => member.userId !== readerId)
      .map((member) =>
        offeredPerson(member, following, member.pictureUrl ?? pictureOf(member.userId)),
      ),
    failed: members === undefined && read?.failed === true,
    retry: () => {
      if (task === undefined) return;

      void acts[ACT_KIND.WORKSPACE_MEMBERS_RETRY]({ workspaceId: task.workspaceId }).catch(
        (cause: unknown) => console.error("Reading the members again did not go.", cause),
      );
    },
    add: (userId) =>
      task === undefined
        ? Promise.resolve(false)
        : write(() => acts[ACT_KIND.TASKS_ADD_FOLLOWER]({ taskId: task.id, userId }), {
            refused: refusedNote,
            retry: mayRetry,
            went: BUZZ.SUCCESS,
          }),
  };
}
