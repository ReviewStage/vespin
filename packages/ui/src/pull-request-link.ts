import { samePullRequest } from "@repo/features/link-grammar";

/**
 * pull-request-link.ts -- which agent's pull request a link names, so a press on it opens the agent's Pull request tab rather than GitHub.
 *
 * A pull request an agent opened is named in words by its page on GitHub,
 * as a mention's chip or a bare link, and the window draws that pull
 * request in the agent's Pull request tab. A place that holds agents and
 * their pull requests (a task, the Inbox beside an item) asks this which one
 * a link names, and opens its tab where it does.
 */

/** A pull request one of the place's agents opened, by its page on GitHub. */
export interface OpenedPullRequest {
  readonly agentId: string;
  readonly url: string;
}

/** The agent that opened the pull request whose page, or a page under it, the link is, however its address is spelled (`samePullRequest`); nothing where none of them did. */
export function pullRequestAgentOf(
  href: string,
  pullRequests: Iterable<OpenedPullRequest>,
): string | undefined {
  for (const each of pullRequests) {
    if (samePullRequest(each.url, href)) return each.agentId;
  }

  return undefined;
}

/** A listed task's pull requests as the window holds them: the task's id, and every pull request its agents opened, each with the agent that opened it where the service said. */
interface ListedTaskPullRequests {
  readonly taskId: string;
  readonly pullRequests: readonly {
    readonly url?: string | undefined;
    readonly agentId?: string | undefined;
  }[];
}

/**
 * The agent whose Pull request tab a link to a pull request opens, and its
 * task, among the tasks the window lists, wherever the link is pressed: a
 * thread, a task's card, or another task, every pull request of a task the
 * list followed live holds among them.
 */
export function listedPullRequestOf(
  href: string,
  tasks: Iterable<ListedTaskPullRequests>,
): { readonly taskId: string; readonly agentId: string } | undefined {
  for (const task of tasks) {
    const opened = task.pullRequests.flatMap(({ url, agentId }) =>
      url === undefined || agentId === undefined ? [] : [{ agentId, url }],
    );

    const agentId = pullRequestAgentOf(href, opened);

    if (agentId !== undefined) return { taskId: task.taskId, agentId };
  }

  return undefined;
}
