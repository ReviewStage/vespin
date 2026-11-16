/**
 * pull-request-client.ts -- the window's reads and changes of one pull request of a workspace's repository, named by its repository and number rather than by an agent.
 *
 * Every read and the change are the hosted `pullRequests` procedures
 * (`contract/pull-requests.ts`), a Generate of its chapters is
 * `pullRequestChapters.repositoryGenerate`, and an image its overview names
 * is the bytes `GET /api/pull-requests/github-image` serves, each over the
 * one account call, answering what the service said or why there is no
 * answer (`pull-request-view.ts`). They mirror the reads and the change an
 * agent's Pull request tab asks through the agent (`agent-client.ts`), so a
 * window draws either alike.
 */

import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type AccountCallEffects, accountCall, type HostedServiceOptions } from "./account-call.js";
import { AGENT_CALL_FAILURE, type AgentGitHubImageView } from "./agent-view.js";
import { hostedCall } from "./hosted-call.js";
import { HOSTED_DEADLINE, type HostedClient, hostedClient } from "./hosted-link.js";
import {
  PULL_REQUEST_CHAPTERS_RENAMES,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import type {
  RepositoryChangesAnswerView,
  RepositoryOverviewChecksAnswerView,
  RepositoryOverviewConversationAnswerView,
  RepositoryOverviewPullRequestAnswerView,
  RepositoryPullRequestAnswerView,
  RepositoryPullRequestParams,
  RepositoryPullRequestViewedAnswerView,
  RepositoryPullRequestWriteAnswerView,
  RepositoryReviewOptionsAnswerView,
} from "./pull-request-view.js";
import {
  type PullRequestActionRequest,
  pullRequestActionRequestSchema,
} from "./pull-request-write-wire.js";
import { servedGitHubImage } from "./served-bytes.js";
import { pullRequestGitHubImagePath } from "./service-paths.js";

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** A pull request as the procedures' query names it, the number as the query spells it. */
function numberedQuery(key: RepositoryPullRequestParams) {
  return { workspaceId: key.workspaceId, repository: key.repository, number: String(key.number) };
}

export class HostedPullRequestClient {
  readonly #call: AccountCallEffects;

  readonly #hosted: HostedClient;

  constructor(options: HostedServiceOptions) {
    const { credential } = options;
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The pull request as GitHub holds it now, with its head's checks and the branch it is from. */
  pullRequest(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryPullRequestAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.pullRequest, numberedQuery(key));
  }

  /** The pull request's changed files, who it names, and the commits its changed images are read at, as GitHub holds them now. */
  changes(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryChangesAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.changes, numberedQuery(key));
  }

  /** The pull request itself as its overview draws it: its description, branches, mergeability, and people as GitHub holds them now. */
  overviewPullRequest(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryOverviewPullRequestAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.overviewPullRequest, numberedQuery(key));
  }

  /** The checks on the pull request's head and its deployments as GitHub holds them now. */
  overviewChecks(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryOverviewChecksAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.overviewChecks, numberedQuery(key));
  }

  /** The pull request's conversation and where its reviewers stand, as GitHub holds them now. */
  overviewConversation(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryOverviewConversationAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.overviewConversation, numberedQuery(key));
  }

  /** What the reviewer and label pickers offer of the pull request's repository: its labels, assignable users, and teams as GitHub holds them now. */
  reviewOptions(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryReviewOptionsAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.reviewOptions, numberedQuery(key));
  }

  /** Which of the pull request's files the member marked viewed on GitHub, read on their own sign-in. */
  viewed(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<RepositoryPullRequestViewedAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.pullRequests.viewed, numberedQuery(key));
  }

  /**
   * One change to the pull request, made on GitHub by the service as the
   * account, on its own GitHub sign-in: how GitHub took it; a change the
   * service would refuse by shape is refused here without traveling.
   */
  action(
    key: RepositoryPullRequestParams,
    request: PullRequestActionRequest,
  ): Effect.Effect<RepositoryPullRequestWriteAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(pullRequestActionRequestSchema)(request));

    if (admitted === undefined) return Effect.succeed(UNANSWERED);

    return hostedCall(this.#hosted.pullRequests.action, {
      query: numberedQuery(key),
      body: admitted,
    });
  }

  /** The pull request's chapters generated for its head now, or the generation already under way, answered as a read of them is; held for as long as a generation may take. */
  generateChapters(
    key: RepositoryPullRequestParams,
  ): Effect.Effect<PullRequestChaptersAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(
      this.#hosted.pullRequestChapters.repositoryGenerate,
      { query: numberedQuery(key) },
      { as: PULL_REQUEST_CHAPTERS_RENAMES, deadline: HOSTED_DEADLINE.CHAPTERS },
    );
  }

  /**
   * One image a pull request of the repository names, by the address
   * GitHub's rendering spelled, fetched under the account: its bytes in
   * base64 under the type GitHub served; not found where the workspace is
   * not one the account is a member of or GitHub answers no image the
   * window draws; unanswered for anything else.
   */
  githubImage(
    place: Pick<RepositoryPullRequestParams, "workspaceId" | "repository">,
    src: string,
  ): Effect.Effect<AgentGitHubImageView, never, HttpClient.HttpClient> {
    return servedGitHubImage(this.#call, pullRequestGitHubImagePath(place, src));
  }
}
