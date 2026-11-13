/**
 * link-standing-model.ts -- what a chip says of the GitHub pull request or issue a link names, from what GitHub answered for it: its key, its title, the state it stands in, a pull request's or an issue's own state for its mark, and who opened it, as every client's chip and card draw it.
 *
 * The host holds what GitHub answered while a chip draws it
 * (`LIVE_READ.LINK_STANDINGS`), by the workspace and the link's own address;
 * this reads that answer, so the panel's chip and the iOS app's say the same.
 */

import { type GitHubPerson, PULL_REQUEST_STATE, type PullRequestState } from "./agent-wire.js";
import type {
  GitHubPullRequestSummary,
  GitHubRepositoryIssueAnswer,
  GitHubRepositoryPullRequestAnswer,
  IssueState,
} from "./github-repositories-wire.js";
import { issueAddressOf, pullRequestAddressOf } from "./link-grammar.js";
import { PULL_REQUEST_STATE_LABEL, QUEUED_LABEL } from "./pull-request-model.js";
import { repositoryParts } from "./task-list-model.js";

/** A GitHub page as GitHub answered for it: its key, `relay#42`, its title, the state it stands in, and a pull request's or an issue's own state for its mark. */
export interface LinkStanding {
  readonly key: string;
  readonly title: string;
  readonly state: string | undefined;
  readonly pullRequest: StandingPullRequest | undefined;
  readonly issue: { readonly number: number; readonly state: IssueState } | undefined;
  /** Who opened a pull request or a GitHub issue, as its card draws them by their face; none where GitHub named no one. */
  readonly opener: GitHubPerson | undefined;
}

/** The suffix GitHub gives an App's bot's login, which names a bot where an older service answered no more than the login. */
const BOT_LOGIN_SUFFIX = "[bot]";

/** Who opened a pull request or a GitHub issue, as GitHub named them on it: their login, their avatar where the service answered one, and whether they are an App's bot. */
export function openerOf(summary: {
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
}): GitHubPerson | undefined {
  const { author, authorAvatarUrl, authorBot } = summary;

  if (author === undefined) return undefined;
  const person = { login: author, bot: authorBot ?? author.endsWith(BOT_LOGIN_SUFFIX) };

  return authorAvatarUrl === undefined ? person : { ...person, avatarUrl: authorAvatarUrl };
}

/** A pull request as its chip draws it: its number and state for its mark, and for its card what the service answered of it, each none, or no labels, where an older service answered none. */
export interface StandingPullRequest {
  readonly number: number;
  readonly state: PullRequestState;
  readonly lines: { readonly additions: number; readonly deletions: number } | undefined;
  readonly files: number | undefined;
  /** When it was last opened, merged, or closed, as its state says: merged when merged, closed when closed, and opened otherwise. */
  readonly when: { readonly moment: PullRequestMoment; readonly at: number } | undefined;
  readonly branches: { readonly base: string; readonly head: string } | undefined;
  readonly labels: readonly { readonly name: string; readonly color: string }[];
  readonly comments: number | undefined;
  readonly commits: number | undefined;
  /** True where it is open and GitHub's merge queue holds it, which its mark and its words say as its Pull request tab does. */
  readonly queued?: true;
}

/** The moment a pull request's card names when it says how long ago: when it was opened, merged, or closed. */
export const PULL_REQUEST_MOMENT = {
  OPENED: "opened",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PullRequestMoment = (typeof PULL_REQUEST_MOMENT)[keyof typeof PULL_REQUEST_MOMENT];

/** When the card says a pull request last moved, as its state names it: merged or closed when it was, and opened otherwise; none where the service answered no time for it. */
function whenOf(pullRequest: GitHubPullRequestSummary): StandingPullRequest["when"] {
  if (pullRequest.state === PULL_REQUEST_STATE.MERGED && pullRequest.mergedAt !== undefined) {
    return { moment: PULL_REQUEST_MOMENT.MERGED, at: pullRequest.mergedAt };
  }

  if (pullRequest.state === PULL_REQUEST_STATE.CLOSED && pullRequest.closedAt !== undefined) {
    return { moment: PULL_REQUEST_MOMENT.CLOSED, at: pullRequest.closedAt };
  }

  return pullRequest.openedAt === undefined
    ? undefined
    : { moment: PULL_REQUEST_MOMENT.OPENED, at: pullRequest.openedAt };
}

/** A pull request as the service answered it for a chip, as its card draws it. */
function standingPullRequestOf(pullRequest: GitHubPullRequestSummary): StandingPullRequest {
  return {
    number: pullRequest.number,
    state: pullRequest.state,
    // Note that an older service answers none of what follows, so its card draws none of it.
    lines:
      pullRequest.additions === undefined || pullRequest.deletions === undefined
        ? undefined
        : { additions: pullRequest.additions, deletions: pullRequest.deletions },
    files: pullRequest.changedFiles,
    when: whenOf(pullRequest),
    branches:
      pullRequest.baseRef === undefined || pullRequest.headRef === undefined
        ? undefined
        : { base: pullRequest.baseRef, head: pullRequest.headRef },
    labels: pullRequest.labels ?? [],
    comments: pullRequest.comments,
    commits: pullRequest.commits,
    ...(queuedOf(pullRequest) ? { queued: true } : undefined),
  };
}

/** Whether a pull request is drawn queued: open, and held in GitHub's merge queue. */
function queuedOf(pullRequest: GitHubPullRequestSummary): boolean {
  return pullRequest.queued === true && pullRequest.state === PULL_REQUEST_STATE.OPEN;
}

/** A GitHub issue's state in words, as its chip says it. */
const ISSUE_WORDS = {
  open: "Open",
  closed: "Closed",
  "not-planned": "Not planned",
} as const satisfies Record<IssueState, string>;

/** The numbered pages of GitHub's a link may name. */
export const GITHUB_PAGE = { PULL_REQUEST: "pull-request", ISSUE: "issue" } as const;

export type GitHubPage = (typeof GITHUB_PAGE)[keyof typeof GITHUB_PAGE];

/** What a link mention asks GitHub: a pull request or an issue by repository and number. */
export interface GitHubPageAsked {
  readonly page: GitHubPage;
  readonly repository: string;
  readonly number: number;
}

/** What an address asks GitHub for, where it is a pull request's or a GitHub issue's page. */
export function githubPageAsked(address: string): GitHubPageAsked | undefined {
  const pullRequest = pullRequestAddressOf(address);

  if (pullRequest !== undefined) return { page: GITHUB_PAGE.PULL_REQUEST, ...pullRequest };
  const issue = issueAddressOf(address);

  return issue === undefined ? undefined : { page: GITHUB_PAGE.ISSUE, ...issue };
}

/** The key a chip names an asked page by: the repository's name and the pull request's or the issue's number. */
function keyOf(asked: GitHubPageAsked): string {
  return `${repositoryParts(asked.repository).name}#${asked.number}`;
}

/** What a chip draws of the page a link names, from what GitHub holds of it as the host last read it; none where GitHub holds no such page. */
export function linkStandingOf(
  asked: GitHubPageAsked,
  held: GitHubRepositoryPullRequestAnswer | GitHubRepositoryIssueAnswer,
): LinkStanding | undefined {
  const key = keyOf(asked);

  if ("issue" in held) {
    const { issue } = held;

    return issue === null
      ? undefined
      : {
          key,
          title: issue.title,
          state: ISSUE_WORDS[issue.state],
          pullRequest: undefined,
          issue: { number: issue.number, state: issue.state },
          opener: openerOf(issue),
        };
  }

  const { pullRequest } = held;

  return pullRequest === null
    ? undefined
    : {
        key,
        title: pullRequest.title,
        state: queuedOf(pullRequest) ? QUEUED_LABEL : PULL_REQUEST_STATE_LABEL[pullRequest.state],
        pullRequest: standingPullRequestOf(pullRequest),
        issue: undefined,
        opener: openerOf(pullRequest),
      };
}
