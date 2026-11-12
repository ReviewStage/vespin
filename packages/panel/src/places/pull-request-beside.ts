/**
 * pull-request-beside.ts -- where a pull request's page on GitHub pressed on a surface opens: in the Pull request tab of an agent the surface holds, or the window's.
 *
 * An Inbox item (`inbox-item-links.ts`), a task's page and an agent's page
 * (`use-open-link.ts`'s `openPullRequestsHere`) answer a pull request alike,
 * by what they hold (`pressed-address.ts` states every surface's choices).
 */

import {
  type OpenedPullRequest,
  pullRequestAgentOf,
  repositoryPullRequestOf,
} from "@repo/ui/pull-request-link";
import {
  type ADDRESS,
  type Address,
  beside,
  NOTHING,
  type Route,
  THING,
} from "./pressed-address.js";

/**
 * What a surface holds that a link may name: its repository, `owner/name`,
 * or none before one is chosen; the pull requests its agents opened, by
 * agent; the agents whose tabs it draws, none before they are read; and
 * every agent it holds, an archived one among them, whose Pull request tab
 * stands as a live agent's does.
 */
export interface Holding {
  readonly repository: string | null | undefined;
  readonly pullRequests: ReadonlyMap<string, { readonly url: string }>;
  readonly agentIds: readonly string[] | undefined;
  readonly heldIds: readonly string[] | undefined;
}

/** The pull requests a surface's agents opened, by their pages on GitHub, each by the agent that opened it; only those of `owners` where it names them. */
function openedBy(holding: Holding, owners?: readonly string[]): OpenedPullRequest[] {
  return [...holding.pullRequests].flatMap(([agentId, { url }]) =>
    owners === undefined || owners.includes(agentId) ? [{ agentId, url }] : [],
  );
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
 * A pull request pressed on a surface: one an agent it holds opened, however
 * its page is spelled, a page under it among them, opens in that agent's
 * Pull request tab; one a listed agent elsewhere opened, a related task's
 * row's chip among them, is the window's, which opens it in that agent's;
 * and any other of its repository, such as one an agent opened before
 * moving to another branch, in its first agent's by its number; one of
 * another repository is the window's. An Inbox item, a task's page and an
 * agent's answer it alike, an archived agent's pull request, merged or not,
 * opening its tab too. None opens beside a surface where the account opens
 * pull requests on GitHub.
 */
export function pullRequestBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.PULL_REQUEST }>,
  here: Holding,
): Route {
  if (address.onGitHub === true) return NOTHING;
  const opened = openedBy(here, here.heldIds ?? here.agentIds);
  const agentId = pullRequestAgentOf(address.href, opened);

  if (agentId !== undefined) return beside({ kind: THING.PULL_REQUEST, agentId });

  if (!ofRepository(address.repository, here.repository)) return NOTHING;

  // A page under an agent's own pull request's, its files say, is still that agent's.
  const owner = opened.find(
    (each) => repositoryPullRequestOf(each.url, here.repository) === address.number,
  );

  if (owner !== undefined) return beside({ kind: THING.PULL_REQUEST, agentId: owner.agentId });

  if (address.listed !== undefined) return NOTHING;
  const first = here.agentIds?.[0];

  return first === undefined
    ? NOTHING
    : beside({ kind: THING.PULL_REQUEST, agentId: first, number: address.number });
}
