/**
 * github-pull-request-moves.ts -- each pull request GitHub's deliveries say moved, noted by its repository's GitHub id and its number, as one statement a delivery.
 *
 * A delivery about a pull request, its reviews, its comments, its review
 * threads, or its checks notes the pull requests it names as moved now,
 * with the head commit it gives for each where it gives one: one upsert of
 * every pull request it names, the head kept where it names none, so a
 * comment's delivery never forgets a head a push recorded. A commit status
 * names only a commit, so it notes as moved now every pull request of the
 * repository whose head that commit is, which a delivery naming that head
 * recorded before; one whose head no delivery named is not found by it.
 * Every statement is keyed by GitHub's repository id and the number alone,
 * and names no account: a row holds what GitHub said of the pull request,
 * never who reads it.
 */

import { and, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { githubPullRequestMove } from "../schemas/github-pull-request-move.js";

type MoveEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One pull request a delivery names: its number, and its head commit where the delivery gives one. */
export interface MovedPullRequest {
  readonly number: number;
  readonly headSha?: string | undefined;
}

const MovedSchema = Schema.Struct({
  repositoryId: Schema.Number,
  pullRequests: Schema.NonEmptyArray(
    Schema.Struct({ number: Schema.Int, headSha: Schema.NullOr(Schema.String) }),
  ),
  at: Schema.Date,
});

const upsertMoved = SqlSchema.void({
  Request: MovedSchema,
  execute: ({ repositoryId, pullRequests, at }) =>
    Database.use((db) =>
      db
        .insert(githubPullRequestMove)
        .values(
          pullRequests.map(({ number, headSha }) => ({
            repositoryId,
            number,
            headSha,
            movedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [githubPullRequestMove.repositoryId, githubPullRequestMove.number],
          set: {
            movedAt: at,
            // Note that a delivery naming no head keeps the one recorded, so a status after a comment still finds it.
            headSha: sql`coalesce(excluded.head_sha, ${githubPullRequestMove.headSha})`,
          },
        }),
    ),
});

const updateHeadMoved = SqlSchema.void({
  Request: Schema.Struct({ repositoryId: Schema.Number, headSha: Schema.String, at: Schema.Date }),
  execute: ({ repositoryId, headSha, at }) =>
    Database.use((db) =>
      db
        .update(githubPullRequestMove)
        .set({ movedAt: at })
        .where(
          and(
            eq(githubPullRequestMove.repositoryId, repositoryId),
            eq(githubPullRequestMove.headSha, headSha),
          ),
        ),
    ),
});

/** Notes each pull request a delivery names as moved at `at`, its head as the delivery gives it, or as recorded where it gives none; nothing where it names none. */
export function notePullRequestsMoved(
  repositoryId: number,
  pullRequests: readonly MovedPullRequest[],
  at: Date,
): MoveEffect<void> {
  // Note that each number is written once, the last head named for it kept, since one statement may move a row only once.
  const named = new Map(pullRequests.map(({ number, headSha }) => [number, headSha ?? null]));
  const [first, ...rest] = [...named].map(([number, headSha]) => ({ number, headSha }));

  if (first === undefined) return Effect.void;

  return upsertMoved({ repositoryId, pullRequests: [first, ...rest], at });
}

/** Notes every pull request of the repository whose recorded head is `headSha` as moved at `at`, as a commit status on that commit says. */
export function noteHeadMoved(repositoryId: number, headSha: string, at: Date): MoveEffect<void> {
  return updateHeadMoved({ repositoryId, headSha, at });
}
