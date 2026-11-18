// workspace-people.ts -- what Settings' Workspace page and the member's and invitation's pages it pushes read of the workspace's people, and how a pushed page goes back once its subject is gone.

import { LIVE_READ } from "@repo/features/live-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

/** The role row's name on a member's or an invitation's page, as the panel's member table heads the column. */
export const ROLE_LABEL = "Role";

/** The members and invitations the host holds for one workspace, as a `select`; each none until read. */
export function heldPeople(workspaceId: string) {
  return (state: AppStateSnapshot) => ({
    members: state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId],
    invitations: state[LIVE_READ.WORKSPACE_INVITATIONS][workspaceId],
  });
}

/**
 * Goes back off a member's or an invitation's page once, whether its own
 * act went or the host stopped holding its subject first, since a removal
 * the host draws at once would otherwise pop the page and then the
 * Workspace page under it. Answers the going back, for an act that went.
 */
export function useBackWhenGone(gone: boolean): () => void {
  const router = useRouter();
  const left = useRef(false);

  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;

    if (router.canGoBack()) router.back();
  }, [router]);

  useEffect(() => {
    if (gone) leave();
  }, [gone, leave]);

  return leave;
}
