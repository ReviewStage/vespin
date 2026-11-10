/**
 * repository-pull-request-procedures.ts -- the hosted doors onto one pull request of a workspace's repository, read and changed by its repository and number rather than through an agent.
 *
 * Every procedure reaches the pull request as the member MCP server's tools
 * do (`repository-pull-request.ts`), which says what each refuses and on
 * which token each is read; the procedures add only who is asking.
 */

import { Effect } from "effect";
import {
  overviewChecksRead,
  overviewConversationRead,
  overviewPullRequestRead,
} from "../agents/agent-pull-request-procedures.js";
import { githubReadRefusal } from "../agents/asked-pull-request.js";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { markRefusedToken } from "./github-app.js";
import { namedReviewOptions } from "./github-people.js";
import { pullRequestReviewOptions } from "./pull-requests.js";
import {
  actionOn,
  changesOf,
  overviewOf,
  publishedOf,
  reachedPullRequest,
  reachedRepository,
  viewedOf,
} from "./repository-pull-request.js";

export interface RepositoryPullRequestProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The pull request resource: its seven reads and its one change, to a signed-in member of the workspace the query names. */
export function repositoryPullRequestProcedures(seams: RepositoryPullRequestProcedureSeams) {
  const signedIn = hosted.pullRequests.use(accountMiddleware(seams.resolveUserId));
  return {
    pullRequest: signedIn.pullRequest.effect(function* ({ input, context }) {
      return publishedOf(yield* reachedPullRequest(context.userId, input));
    }),
    /** One change to the pull request, as the asking member on their own GitHub sign-in (`pull-request-write.ts`), and how GitHub took it. */
    action: signedIn.action.effect(function* ({ input, context }) {
      return yield* actionOn(context.userId, input.query, input.body);
    }),
    /** Which of the pull request's files the asking member marked viewed on GitHub, on their own GitHub sign-in. */
    viewed: signedIn.viewed.effect(function* ({ input, context }) {
      return yield* viewedOf(context.userId, input);
    }),
    changes: signedIn.changes.effect(function* ({ input, context }) {
      return yield* changesOf(yield* reachedPullRequest(context.userId, input));
    }),
    /**
     * What the reviewer and label pickers offer, of the repository rather than
     * the pull request. Note that the number is left unchecked, because reading
     * the pull request would cost a GitHub call on every picker read for no
     * gain: a non-member is refused all the same.
     */
    reviewOptions: signedIn.reviewOptions.effect(function* ({ input, context }) {
      const { token, access, subject } = yield* reachedRepository(context.userId, input);
      return yield* githubReadRefusal(
        pullRequestReviewOptions(token, subject.repository).pipe(markRefusedToken(access)),
      ).pipe(
        Effect.flatMap((read) =>
          namedReviewOptions({ organizationId: subject.organizationId }, read),
        ),
      );
    }),
    overviewPullRequest: signedIn.overviewPullRequest.effect(function* ({ input, context }) {
      const reached = yield* reachedPullRequest(context.userId, input);
      return yield* overviewOf(reached, context.userId, overviewPullRequestRead);
    }),
    overviewChecks: signedIn.overviewChecks.effect(function* ({ input, context }) {
      const reached = yield* reachedPullRequest(context.userId, input);
      return yield* overviewOf(reached, context.userId, overviewChecksRead);
    }),
    overviewConversation: signedIn.overviewConversation.effect(function* ({ input, context }) {
      const reached = yield* reachedPullRequest(context.userId, input);
      return yield* overviewOf(reached, context.userId, overviewConversationRead);
    }),
  };
}
