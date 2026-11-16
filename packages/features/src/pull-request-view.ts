/**
 * pull-request-view.ts -- one pull request of a workspace's repository as a window reads and changes it by its repository and number, with no agent: what the window names it by, and each answer as the window hears it.
 *
 * A Pull request tab names a pull request as a link does: the workspace
 * whose installation reaches its repository, the repository's full name,
 * and the number (`contract/pull-requests.ts`). The host asks the service
 * on the window's behalf and answers it one of the shapes here, the same
 * answers an agent's tab hears (`agent-view.ts`), but that the failures are
 * the repository path's own: the call never reached an answer
 * (`unanswered`), the workspace is not one the account is a member of or
 * the repository holds no pull request under the number (`not-found`), or
 * the workspace no longer reaches the repository
 * (`repository-not-reachable`). There is no pull request yet to wait for:
 * the number names one or none.
 */

import { Schema as EffectSchema } from "effect";
import { agentGitHubImageParamsSchema, PULL_REQUEST_PART } from "./agent-view.js";
import { pullRequestsContract } from "./contract/pull-requests.js";
import {
  githubPullRequestNumberSchema,
  githubRepositoryFullNameSchema,
} from "./github-repositories-wire.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import { pullRequestActionRequestSchema } from "./pull-request-write-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/** Why a read or a change of a pull request by its repository answered nothing a window can draw, as the procedures declare their refusals. */
export const REPOSITORY_PULL_REQUEST_CALL_FAILURE = failureSetOf({
  pullRequests: pullRequestsContract,
});

/** A repository as a pull request's window names it: the workspace whose installation reaches it, and its full name. */
const repositoryPlaceFields = {
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
};

/** One pull request, as a window names it: the workspace, the repository, and the number. */
export const repositoryPullRequestParamsSchema = EffectSchema.Struct({
  ...repositoryPlaceFields,
  number: githubPullRequestNumberSchema,
});

export type RepositoryPullRequestParams = typeof repositoryPullRequestParamsSchema.Type;

/** One part of one pull request, as a Pull request tab holds it: the part (`PULL_REQUEST_PART`), and the pull request. */
export const repositoryPullRequestPartParamsSchema = EffectSchema.Struct({
  part: EffectSchema.Literals(Object.values(PULL_REQUEST_PART)),
  ...repositoryPullRequestParamsSchema.fields,
});

export type RepositoryPullRequestPartParams = typeof repositoryPullRequestPartParamsSchema.Type;

/** One change to one pull request, as the window asks it made: the pull request, and the change (`pull-request-write-wire.ts`). */
export const repositoryPullRequestActionParamsSchema = EffectSchema.Struct({
  ...repositoryPullRequestParamsSchema.fields,
  request: pullRequestActionRequestSchema,
});

/** One image a pull request of the repository names, as the window asks for it: the repository, and the address GitHub's rendering spelled. */
export const repositoryGitHubImageParamsSchema = EffectSchema.Struct({
  ...repositoryPlaceFields,
  src: agentGitHubImageParamsSchema.fields.src,
});

/** The pull request as GitHub holds it now, with its head's checks and the branch it is from, as the window hears it, or why there is no answer. */
const repositoryPullRequestAnswerViewSchema = answerView(pullRequestsContract.pullRequest);

export type RepositoryPullRequestAnswerView = typeof repositoryPullRequestAnswerViewSchema.Type;

/** The pull request's changed files, as the window hears them, or why there is no answer. */
export const repositoryChangesAnswerViewSchema = answerView(pullRequestsContract.changes);

export type RepositoryChangesAnswerView = typeof repositoryChangesAnswerViewSchema.Type;

/** The pull request itself as its overview draws it, as the window hears it, or why there is no answer. */
const repositoryOverviewPullRequestAnswerViewSchema = answerView(
  pullRequestsContract.overviewPullRequest,
);

export type RepositoryOverviewPullRequestAnswerView =
  typeof repositoryOverviewPullRequestAnswerViewSchema.Type;

/** The checks on the pull request's head, as the window hears them, or why there is no answer. */
const repositoryOverviewChecksAnswerViewSchema = answerView(pullRequestsContract.overviewChecks);

export type RepositoryOverviewChecksAnswerView =
  typeof repositoryOverviewChecksAnswerViewSchema.Type;

/** The pull request's conversation and where its reviewers stand, as the window hears them, or why there is no answer. */
const repositoryOverviewConversationAnswerViewSchema = answerView(
  pullRequestsContract.overviewConversation,
);

export type RepositoryOverviewConversationAnswerView =
  typeof repositoryOverviewConversationAnswerViewSchema.Type;

/** What the reviewer and label pickers offer of the pull request's repository, as the window hears it, or why there is no answer. */
const repositoryReviewOptionsAnswerViewSchema = answerView(pullRequestsContract.reviewOptions);

export type RepositoryReviewOptionsAnswerView = typeof repositoryReviewOptionsAnswerViewSchema.Type;

/** How GitHub took a change to the pull request, as the window hears it: made, the member to sign in with GitHub again, GitHub's refusal in its words, or why there is no answer. */
export const repositoryPullRequestWriteAnswerViewSchema = answerView(pullRequestsContract.action);

export type RepositoryPullRequestWriteAnswerView =
  typeof repositoryPullRequestWriteAnswerViewSchema.Type;

/** Which of the pull request's files the member marked viewed on GitHub, as the window hears it: each file's mark, the member to sign in with GitHub again, GitHub's refusal in its words, or why there is no answer. */
const repositoryPullRequestViewedAnswerViewSchema = answerView(pullRequestsContract.viewed);

export type RepositoryPullRequestViewedAnswerView =
  typeof repositoryPullRequestViewedAnswerViewSchema.Type;
