// member-pictures.ts -- the sign-in picture and name of each member of the workspace the phone works in, by their id, which every face the app draws a person with reads.

import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { readerFirst } from "@repo/features/member-order";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useChosenWorkspace } from "./chosen-workspace.js";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";
import { useLiveFollow } from "./host/live-follow.js";

/** A member's picture by their id; none for someone the app holds no picture of. */
export type PictureOf = (userId: string | undefined) => string | undefined;

/** A member's name and picture by their id; none for someone the app holds no member row of. */
export type MemberOf = (
  userId: string,
) => { readonly name: string; readonly picture: string | undefined } | undefined;

/** The workspace the phone works in, which its members are read for. */
function useChosenWorkspaceId(): string | undefined {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  return useChosenWorkspace(workspaces).chosen?.id;
}

/**
 * Holds the members of the workspace the phone works in followed while the
 * tabs stand, so every face reads their pictures from one follow rather
 * than a follow of its own per row; the follow moves as another workspace
 * is chosen.
 */
export function useMemberPicturesFollow(): void {
  const acts = useHostActs();
  useLiveFollow(useChosenWorkspaceId(), (id) =>
    acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }),
  );
}

/** The members of the workspace `workspaceId` names, or of the one the phone works in where none is named, as a follow of them reads them. */
function useMembers(workspaceId: string | undefined) {
  const { data: members } = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) =>
        workspaceId === undefined
          ? undefined
          : state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId]?.rows?.members,
      [workspaceId],
    ),
  });

  return members;
}

/** The members of a workspace as the host holds them, and whether their read failed; none while unread. */
export interface HeldMembers {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly failed: boolean;
  /** Reads the members again, as a failed read's Try again and a pull do. */
  readonly retry: () => void;
}

/**
 * The members of the workspace `workspaceId` names, as a search reads them:
 * the rows the host holds, and whether their read failed, so a search under
 * People says it reads them, or that it could not, rather than that it
 * found no one. Note that it holds no follow of its own, since the tabs
 * hold the chosen workspace's members followed (`useMemberPicturesFollow`).
 */
export function useHeldMembers(workspaceId: string | undefined): HeldMembers {
  const acts = useHostActs();

  const { data } = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) => {
        const held =
          workspaceId === undefined ? undefined : state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId];

        return { members: held?.rows?.members, failed: held?.failed === true };
      },
      [workspaceId],
    ),
  });

  const retry = useCallback(() => {
    if (workspaceId === undefined) return;
    acts[ACT_KIND.WORKSPACE_MEMBERS_RETRY]({ workspaceId }).catch((cause: unknown) =>
      console.error("Reading the members again did not go.", cause),
    );
  }, [acts, workspaceId]);

  return useMemo(
    () => ({ members: data?.members, failed: data?.failed === true, retry }),
    [data, retry],
  );
}

/** No members by id, before their list is read. */
const NO_MEMBER_INDEX: ReadonlyMap<string, WorkspaceMember> = new Map();

/** Each list of members read, by id, built once per list, so every caller of one list, as each chip in a transcript, shares one index. */
const memberIndexes = new WeakMap<
  readonly WorkspaceMember[],
  ReadonlyMap<string, WorkspaceMember>
>();

/** The members of `members` by their id, the one index every caller of that list shares. */
function memberIndexOf(members: readonly WorkspaceMember[]): ReadonlyMap<string, WorkspaceMember> {
  const held = memberIndexes.get(members);

  if (held !== undefined) return held;
  const index = new Map(members.map((member) => [member.userId, member]));
  memberIndexes.set(members, index);

  return index;
}

/**
 * Each member's name and picture by their id, of the workspace
 * `workspaceId` names, or of the one the phone works in where none is
 * named, as a follower's face is drawn; none for someone the list has yet
 * to hold, or who left it. A caller naming another workspace holds its own
 * follow of that workspace's members.
 */
export function useMemberFaces(workspaceId?: string): MemberOf {
  const chosenId = useChosenWorkspaceId();
  const members = useMembers(workspaceId ?? chosenId);

  return useMemo(() => {
    const byId = members === undefined ? NO_MEMBER_INDEX : memberIndexOf(members);

    return (userId) => {
      const member = byId.get(userId);

      return member === undefined ? undefined : { name: member.name, picture: member.pictureUrl };
    };
  }, [members]);
}

/** A member as a people menu lists them: their account id and their name. */
export type ListedMember = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  /** Whether the member is the reader, whom a menu names You under their name. */
  readonly you: boolean;
};

/** No members, as before their list is read. */
const NO_MEMBERS: readonly ListedMember[] = [];

/**
 * The members of the workspace `workspaceId` names, the reader first and
 * everyone else by name, as the panel's assignee menu lists them, held
 * followed while the caller stands, since a task opened by a link may stand
 * in another workspace than the one the phone works in; none while their
 * list is unread.
 */
export function useListedMembers(workspaceId: string | undefined): readonly ListedMember[] {
  const acts = useHostActs();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const members = useMembers(workspaceId);
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }));

  const readerId = account === undefined ? undefined : signedInAccountId(account);

  return useMemo(
    () =>
      members === undefined
        ? NO_MEMBERS
        : readerFirst(members, readerId).map(({ userId, name, email }) => ({
            userId,
            name,
            email,
            you: userId === readerId,
          })),
    [members, readerId],
  );
}

/**
 * Each person's sign-in picture by their id, as the panel's faces draw
 * them: the members of the workspace the phone works in, and the signed-in
 * account's own, which stands even before its members are read. Note that a
 * person with no picture, or one the list has yet to hold, gets none, and
 * their face draws their letters, as it does while a picture loads.
 */
export function useMemberPictures(): PictureOf {
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const members = useMembers(useChosenWorkspaceId());

  const readerId = account === undefined ? undefined : signedInAccountId(account);

  const readerPicture =
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.pictureUrl : undefined;

  return useMemo(() => {
    const pictures = new Map<string, string>();

    for (const member of members ?? []) {
      if (member.pictureUrl !== undefined) pictures.set(member.userId, member.pictureUrl);
    }

    if (readerId !== undefined && readerPicture !== undefined) {
      pictures.set(readerId, readerPicture);
    }

    return (userId) => (userId === undefined ? undefined : pictures.get(userId));
  }, [members, readerId, readerPicture]);
}
