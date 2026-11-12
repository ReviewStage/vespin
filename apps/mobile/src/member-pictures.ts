// member-pictures.ts -- the sign-in picture of each member of the workspace the phone works in, by their id, which every face the app draws a person with reads.

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

/**
 * Each person's sign-in picture by their id, as the panel's faces draw
 * them: the members of the workspace the phone works in, and the signed-in
 * account's own, which stands even before its members are read. Note that a
 * person with no picture, or one the list has yet to hold, gets none, and
 * their face draws their letters, as it does while a picture loads.
 */
export function useMemberPictures(): PictureOf {
  const workspaceId = useChosenWorkspaceId();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });

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
