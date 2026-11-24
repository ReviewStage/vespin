/**
 * pull-request-beside.ts -- where a pull request's page on GitHub pressed on a surface opens: in a Pull request tab of the task's panel the surface stands for, or the window's.
 *
 * An Inbox item (`inbox-item-links.ts`) and a task's page
 * (`use-open-link.ts`'s `openPullRequestsHere`) answer a pull request alike,
 * by the task whose panel they stand for (`pressed-address.ts` states every
 * surface's choices). A Pull request tab names its pull request by its
 * repository and number alone, so no agent is asked which one it is.
 */

import {
  type ADDRESS,
  type Address,
  beside,
  NOTHING,
  type Route,
  THING,
} from "./pressed-address.js";

/**
 * What a surface holds that a link may name: the task whose panel it
 * stands for, none before one is chosen or for an agent on no task's page;
 * the workspace its panel reads pull requests through, the task's or the
 * agent's own, none until it is known; its repository, `owner/name`, or
 * none before one is chosen; the agents whose tabs it draws, none before
 * they are read; and every agent it holds, an archived one among them.
 */
export interface Holding {
  readonly taskId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly repository: string | null | undefined;
  readonly agentIds: readonly string[] | undefined;
  readonly heldIds: readonly string[] | undefined;
}

/** Whether a repository an address names is the one a surface holds, whatever the case its owner and name are spelled in, as GitHub reads them. */
export function ofRepository(named: string, repository: string | null | undefined): boolean {
  return (
    repository !== null &&
    repository !== undefined &&
    named.toLowerCase() === repository.toLowerCase()
  );
}

/**
 * A pull request pressed on a surface whose panel reads pull requests
 * through a workspace opens in that panel by its repository and number: on
 * a task's surface, one the task's own lines name, and any other no listed
 * task's lines name, a pull request of another repository among them,
 * which the task's workspace reads where it reaches it; one another listed
 * task's lines name is the window's, which opens it on that task. A surface
 * standing for no task, as an agent on no task's page, has no task's lines
 * of its own, so every pull request opens beside it, read through the
 * agent's workspace. None opens beside a surface whose workspace is not
 * known, nor where the account opens pull requests on GitHub.
 */
export function pullRequestBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.PULL_REQUEST }>,
  here: Pick<Holding, "taskId" | "workspaceId">,
): Route {
  if (address.onGitHub === true || here.workspaceId === undefined) return NOTHING;

  if (
    here.taskId !== undefined &&
    address.listed !== undefined &&
    address.listed.taskId !== here.taskId
  ) {
    return NOTHING;
  }

  return beside({
    kind: THING.PULL_REQUEST,
    pullRequest: { repository: address.repository, number: address.number },
  });
}
