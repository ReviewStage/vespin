/**
 * use-link-standings.ts -- what GitHub holds of each pull request and issue a page's words link to, as their chips say it: each held followed on the host while the page stands, read through the words' workspace, as the panel's chip reads one (`use-link-standing.ts`).
 *
 * A chip's page is read through the workspace the words are of, and only
 * where that workspace's GitHub App is connected, so a page read through
 * another workspace's connection is never drawn in this one, and a chip in a
 * workspace without the App asks nothing. Until the host answers, or where it
 * never does, a chip says what its link says. A pull request one of the
 * member's agents opened stands at once on the task list's synced read of
 * it, before GitHub answers or where it never does, and carries how its
 * checks went, which GitHub's answer for a link carries none of, so its
 * chip and its preview never wait on the network.
 */

import { type AgentPullRequest, pullRequestAuthorOf } from "@repo/features/agent-wire";
import type { GitHubRepositoryPullRequestAnswer } from "@repo/features/github-repositories-wire";
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

/** Each pull request the member's agents opened, by its page on GitHub, as the task list synced it. */
function useSyncedByPage(): ReadonlyMap<string, AgentPullRequest> {
  const collections = useTaskListCollections();
  const rows = useLiveQuery((q) => q.from({ pullRequest: collections.agentPullRequests })).data;

  return useMemo(
    () => new Map((rows ?? []).map(({ pullRequest }) => [pullRequest.url, pullRequest])),
    [rows],
  );
}

/** A synced pull request read as GitHub's answer for its link would say it: what the task list holds of it, with no branches, labels, or times, which it never syncs. */
function syncedAnswer(synced: AgentPullRequest): GitHubRepositoryPullRequestAnswer {
  return {
    pullRequest: {
      number: synced.number,
      title: synced.title,
      url: synced.url,
      state: synced.state,
      additions: synced.additions,
      deletions: synced.deletions,
      changedFiles: synced.changedFiles,
      ...pullRequestAuthorOf(synced),
      ...(synced.queued === true ? { queued: true } : undefined),
    },
  };
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

  const syncedByPage = useSyncedByPage();

  return useCallback(
    (page: string) => {
      const asked = githubPageAsked(page);
      const synced = syncedByPage.get(page);
      // Note that GitHub's answer wins where it is held, as the fuller read, and the synced row stands in until it lands.
      const rows = held?.[page]?.rows ?? (synced === undefined ? undefined : syncedAnswer(synced));

      const standing =
        asked === undefined || rows === undefined ? undefined : linkStandingOf(asked, rows);

      return standing?.pullRequest === undefined || synced === undefined
        ? standing
        : { ...standing, pullRequest: { ...standing.pullRequest, checks: synced.checks } };
    },
    [held, syncedByPage],
  );
}
