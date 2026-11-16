import { samePullRequest } from "@repo/features/link-grammar";

/**
 * pull-request-link.ts -- which listed task, and which of its agents, opened the pull request a link names.
 *
 * A pull request is named in words by its page on GitHub, as a mention's
 * chip or a bare link, and the window opens it in a Pull request tab by its
 * repository and number alone. Which task's panel it opens in is the task
 * whose pull requests name it; which agent opened it is only ever drawn, as
 * a card hangs the agent beside the pull request, never what it opens.
 */

/** A listed task's pull requests as the window holds them: the task's id, and every pull request its agents opened, each by its page and with the agent that opened it where the service said. */
interface ListedTaskPullRequests {
  readonly taskId: string;
  readonly pullRequests: readonly {
    readonly url?: string | undefined;
    readonly agentId?: string | undefined;
  }[];
}

/** The listed task whose pull requests name the one a link names, and the agent that opened it where the task's line says. */
export interface ListedPullRequestOwner {
  readonly taskId: string;
  readonly agentId: string | undefined;
}

/**
 * The task among those the window lists whose pull requests name the one
 * the link names, however its address is spelled (`samePullRequest`), and
 * the agent its line says opened it: the first such task, wherever the link
 * is pressed, a thread, a task's card, or another task.
 */
export function listedPullRequestOf(
  href: string,
  tasks: Iterable<ListedTaskPullRequests>,
): ListedPullRequestOwner | undefined {
  for (const task of tasks) {
    const line = task.pullRequests.find(
      ({ url }) => url !== undefined && samePullRequest(url, href),
    );

    if (line !== undefined) return { taskId: task.taskId, agentId: line.agentId };
  }

  return undefined;
}
