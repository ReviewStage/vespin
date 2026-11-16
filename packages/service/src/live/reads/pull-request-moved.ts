/**
 * pull-request-moved.ts -- when GitHub last said one pull request moved, bound by its repository and number: the read's one statement, the tables it reads, the topics that wake it, and what it serves.
 *
 * The statement reads the pull request's row as GitHub's deliveries left it
 * (`github_pull_request_move`), under the repository's GitHub id, for an
 * account that is a member of the workspace named (`workspaceReachableBy`):
 * no rows for a pull request no delivery named yet. The id is served once a
 * token minted for the repository confirms the workspace reaches it, as the
 * read of its chapters by repository admits a reader
 * (`reachedRepository`), so a workspace the reader is no member of is not
 * found. Note that a repository whose id that read did not name is served
 * the id no repository has, so its row is never read, and its tab is read
 * again on focus and Try again alone.
 *
 * It is woken by every delivery naming one of the repository's pull
 * requests, which all name its topic by GitHub's id, and by what admits the
 * reader to the workspace.
 */

import { queryBuilder } from "@repo/database/core/query";
import { workspaceReachableBy } from "@repo/database/models/workspace-store";
import { githubPullRequestMove } from "@repo/database/schemas/github-pull-request-move";
import { TOPIC } from "@repo/database/sync/notification";
import {
  githubPersonalTokenSync,
  githubPullRequestMoveSync,
  githubRepositoryReadSync,
  memberSync,
} from "@repo/database/sync/tables";
import { REPOSITORY_PULL_REQUEST_MOVED_READ } from "@repo/features/pull-request-moved-live";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { pullRequestNumberOf } from "../../agents/asked-pull-request.js";
import { reachedRepository } from "../../github/repository-pull-request.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement, ownOrder } from "../live-read-binding.js";

/** The id no GitHub repository has, served where the read that reached the repository named none. */
const NO_REPOSITORY_ID = 0;

/** A whole number a read's param binds, as its query spelled it; zero, which names nothing, where it names none. */
function wholeParam(param: string): number {
  const number = Number(param);

  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export const repositoryPullRequestMovedRead = bindLiveRead(REPOSITORY_PULL_REQUEST_MOVED_READ, {
  reads: [githubPullRequestMoveSync, memberSync, githubPersonalTokenSync, githubRepositoryReadSync],
  topics: ({ userId, repositoryId }) => [
    [TOPIC.GITHUB_REPOSITORY, repositoryId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId, repositoryId, number }) => ({
    moved: liveRowsStatement(
      REPOSITORY_PULL_REQUEST_MOVED_READ.parts.moved,
      {
        ordered: false,
        columns: {
          number: githubPullRequestMove.number,
          headSha: githubPullRequestMove.headSha,
        },
        instants: { movedAt: githubPullRequestMove.movedAt },
      },
      (selection) =>
        ownOrder(
          queryBuilder
            .select(selection)
            .from(githubPullRequestMove)
            .where(
              and(
                eq(githubPullRequestMove.repositoryId, wholeParam(repositoryId)),
                eq(githubPullRequestMove.number, wholeParam(number)),
                workspaceReachableBy(userId, workspaceId),
              ),
            )
            .limit(1),
        ),
    ),
  }),
  // Note that the number is read first, so one of no shape is refused before the workspace is asked about.
  serve: Effect.fnUntraced(function* ({ userId, workspaceId, repository, number }) {
    const read = yield* pullRequestNumberOf([number]);

    if (read === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const { repositoryId } = yield* reachedRepository(userId, { workspaceId, repository });

    return { repositoryId: String(repositoryId ?? NO_REPOSITORY_ID) };
  }),
});
