// member-pictures.ts -- the sign-in picture and name of each member of the workspace the phone works in, by their id, which every face the app draws a person with reads.

import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
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
    const byId = new Map((members ?? []).map((member) => [member.userId, member]));

    return (userId) => {
      const member = byId.get(userId);

      return member === undefined ? undefined : { name: member.name, picture: member.pictureUrl };
    };
  }, [members]);
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
