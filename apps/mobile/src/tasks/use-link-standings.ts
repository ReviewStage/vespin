/**
 * use-link-standings.ts -- what GitHub holds of each pull request and issue a page's words link to, as their chips say it: each held followed on the host while the page stands, read through the words' workspace, as the panel's chip reads one (`use-link-standing.ts`).
 *
 * A chip's page is read through the workspace the words are of, and only
 * where that workspace's GitHub App is connected, so a page read through
 * another workspace's connection is never drawn in this one, and a chip in a
 * workspace without the App asks nothing. Until the host answers, or where it
 * never does, a chip says what its link says.
 */

import {
  githubPageAsked,
  type LinkStanding,
  linkStandingOf,
} from "@repo/features/link-standing-model";
import { LIVE_READ } from "@repo/features/live-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { markdownGithubPages } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollows } from "../host/live-follow.js";

/** No pages to follow. */
const NO_PAGES: readonly string[] = [];

/**
 * What GitHub holds of the pull requests and issues `words` link to, each
 * held followed while the caller stands, read through `workspace` where its
 * GitHub App is connected, as the chip in `Markdown` reads it by its page;
 * none for a page unread, unanswered, or GitHub holds no such page.
 */
export function useLinkStandings(
  words: readonly string[],
  repository: string | null,
  workspace: Workspace | undefined,
): (page: string) => LinkStanding | undefined {
  const acts = useHostActs();
  const workspaceId = workspace?.github?.active === true ? workspace.id : undefined;

  const pages = useMemo(() => {
    if (workspaceId === undefined) return NO_PAGES;
    // Note that only a page's own address is read here, so no moment or zone a date's chip counts from matters.
    const reading = { repository, now: 0, zone: "UTC" };

    return [...new Set(words.flatMap((each) => markdownGithubPages(each, reading)))];
  }, [words, repository, workspaceId]);

  useLiveFollows(
    pages,
    (address) =>
      acts[ACT_KIND.TASKS_LINK_STANDING_FOLLOW]({ workspaceId: workspaceId ?? "", address }),
    workspaceId,
  );

  const { data: held } = useQuery({
    ...appStateQuery,
    select: (state) =>
      workspaceId === undefined ? undefined : state[LIVE_READ.LINK_STANDINGS][workspaceId],
  });

  return useCallback(
    (page: string) => {
      const asked = githubPageAsked(page);
      const rows = held?.[page]?.rows;

      return asked === undefined || rows === undefined ? undefined : linkStandingOf(asked, rows);
    },
    [held],
  );
}
