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
 * stands for, none before one is chosen; its repository, `owner/name`, or
 * none before one is chosen; the agents whose tabs it draws, none before
 * they are read; and every agent it holds, an archived one among them.
 */
export interface Holding {
  readonly taskId: string | undefined;
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
 * A pull request pressed on a surface standing for a task's panel opens in
 * that panel by its repository and number: one the task's own lines name,
 * and any other no listed task's lines name, a pull request of another
 * repository among them, which the task's workspace reads where it reaches
 * it. One another listed task's lines name is the window's, which opens it
 * on that task. None opens beside a surface standing for no task, nor where
 * the account opens pull requests on GitHub.
 */
export function pullRequestBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.PULL_REQUEST }>,
  here: Pick<Holding, "taskId">,
): Route {
  if (address.onGitHub === true || here.taskId === undefined) return NOTHING;

  if (address.listed !== undefined && address.listed.taskId !== here.taskId) return NOTHING;

  return beside({
    kind: THING.PULL_REQUEST,
    pullRequest: { repository: address.repository, number: address.number },
  });
}
