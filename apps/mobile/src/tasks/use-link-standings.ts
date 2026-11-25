/**
 * use-link-standings.ts -- what GitHub holds of each pull request and issue a page's words link to, as their chips say it: each held followed on the host while the page stands, read through the words' workspace, as the panel's chip reads one (`use-link-standing.ts`).
 *
 * A chip's page is read through the workspace the words are of, and only
 * where that workspace's GitHub App is connected, so a page read through
 * another workspace's connection is never drawn in this one, and a chip in a
 * workspace without the App asks nothing. Until the host answers, or where it
 * never does, a chip says what its link says. A pull request one of the
 * member's agents opened carries how its checks went too, from the task
 * list's read of it, since GitHub's answer for a link carries none.
 */

import type { CheckSummary } from "@repo/features/agent-wire";
import {
  githubPageAsked,
  type LinkStanding,
  linkStandingOf,
} from "@repo/features/link-standing-model";
import { LIVE_READ } from "@repo/features/live-wire";
import { keptMarkdownTree, markdownTree } from "@repo/features/markdown-tree";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { markdownGithubPages } from "@repo/ui-native";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections } from "../host/host-provider.js";
import { useLiveFollows } from "../host/live-follow.js";

/** No pages to follow. */
const NO_PAGES: readonly string[] = [];

/** How each pull request the member's agents opened stands on its checks, by its page on GitHub, from the task list's read of it. */
function useChecksByPage(): ReadonlyMap<string, CheckSummary> {
  const collections = useTaskListCollections();
  const rows = useLiveQuery((q) => q.from({ pullRequest: collections.agentPullRequests })).data;

  return useMemo(
    () => new Map((rows ?? []).map(({ pullRequest }) => [pullRequest.url, pullRequest.checks])),
    [rows],
  );
}

/**
 * What GitHub holds of the pull requests and issues `words` link to, each
 * held followed while the caller stands, read through `workspace` where its
 * GitHub App is connected, as the chip in `Markdown` reads it by its page;
 * none for a page unread, unanswered, or GitHub holds no such page. Where
 * `whole` says each of `words` is a whole document a page also draws, such
 * as a task's description, its kept parse is read rather than a second one.
 */
export function useLinkStandings(
  words: readonly string[],
  repository: string | null,
  workspace: Workspace | undefined,
  whole = false,
): (page: string) => LinkStanding | undefined {
  const acts = useHostActs();
  const workspaceId = workspace?.github?.active === true ? workspace.id : undefined;

  const pages = useMemo(() => {
    if (workspaceId === undefined) return NO_PAGES;
    // Note that only a page's own address is read here, so no moment or zone a date's chip counts from matters.
    const reading = { repository, now: 0, zone: "UTC" };

    const parse = whole ? keptMarkdownTree : markdownTree;

    return [...new Set(words.flatMap((each) => markdownGithubPages(each, reading, parse)))];
  }, [words, repository, workspaceId, whole]);

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

  const checksByPage = useChecksByPage();

  return useCallback(
    (page: string) => {
      const asked = githubPageAsked(page);
      const rows = held?.[page]?.rows;

      const standing =
        asked === undefined || rows === undefined ? undefined : linkStandingOf(asked, rows);

      const checks = checksByPage.get(page);

      return standing?.pullRequest === undefined || checks === undefined
        ? standing
        : { ...standing, pullRequest: { ...standing.pullRequest, checks } };
    },
    [held, checksByPage],
  );
}
