/**
 * github-pull-request-moves.ts -- each pull request GitHub's deliveries say moved, noted by its repository's GitHub id and its number, as one statement a delivery.
 *
 * A delivery about a pull request, its reviews, its comments, its review
 * threads, or its checks notes the pull requests it names as moved now,
 * with the head branch and commit it gives for each where it gives them:
 * one upsert of every pull request it names, the head kept where it names
 * none, so a comment's delivery never forgets a head a push recorded. A
 * commit status names only its commit and the branches whose head that is,
 * so it notes as moved now every pull request of the repository whose head
 * branch it names, which a delivery naming that branch recorded before; one
 * whose head no delivery named is not found by it. Note that the branch is
 * matched rather than the commit, because GitHub delivers out of order, and
 * a late delivery's older commit would hide every status on the newer one,
 * where a push never moves the branch. Every write moves `moved_at` past the
 * one it finds, a millisecond at least, so two deliveries read in the same
 * millisecond, or one landing after a later one, are each a move a tab
 * hears, and none moves it back.
 * Every statement is keyed by GitHub's repository id and the number alone,
 * and names no account: a row holds what GitHub said of the pull request,
 * never who reads it.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { githubPullRequestMove } from "../schemas/github-pull-request-move.js";

type MoveEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One pull request a delivery names: its number, and its head branch and commit where the delivery gives them. */
export interface MovedPullRequest {
  readonly number: number;
  readonly head?: { readonly ref: string; readonly sha: string } | undefined;
}

const MovedSchema = Schema.Struct({
  repositoryId: Schema.Number,
  pullRequests: Schema.NonEmptyArray(
    Schema.Struct({
      number: Schema.Int,
      headRef: Schema.NullOr(Schema.String),
      headSha: Schema.NullOr(Schema.String),
    }),
  ),
  at: Schema.Date,
});

/** `at`, or a millisecond past the move the row holds where that is later, so every write is a move and none goes back. */
const movedPast = (at: Date) =>
  sql`greatest(${at.toISOString()}::timestamptz, ${githubPullRequestMove.movedAt} + interval '1 millisecond')`;

const upsertMoved = SqlSchema.void({
  Request: MovedSchema,
  execute: ({ repositoryId, pullRequests, at }) =>
    Database.use((db) =>
      db
        .insert(githubPullRequestMove)
        .values(
          pullRequests.map(({ number, headRef, headSha }) => ({
            repositoryId,
            number,
            headRef,
            headSha,
            movedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [githubPullRequestMove.repositoryId, githubPullRequestMove.number],
          set: {
            movedAt: movedPast(at),
            // Note that a delivery naming no head keeps the one recorded, so a status after a comment still finds it.
            headRef: sql`coalesce(excluded.head_ref, ${githubPullRequestMove.headRef})`,
            headSha: sql`coalesce(excluded.head_sha, ${githubPullRequestMove.headSha})`,
          },
        }),
    ),
});

const updateHeadsMoved = SqlSchema.void({
  Request: Schema.Struct({
    repositoryId: Schema.Number,
    branches: Schema.NonEmptyArray(Schema.String),
    at: Schema.Date,
  }),
  execute: ({ repositoryId, branches, at }) =>
    Database.use((db) =>
      db
        .update(githubPullRequestMove)
        .set({ movedAt: movedPast(at) })
        .where(
          and(
            eq(githubPullRequestMove.repositoryId, repositoryId),
            inArray(githubPullRequestMove.headRef, branches),
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
  const named = new Map(pullRequests.map(({ number, head }) => [number, head]));

  const [first, ...rest] = [...named].map(([number, head]) => ({
    number,
    headRef: head?.ref ?? null,
    headSha: head?.sha ?? null,
  }));

  if (first === undefined) return Effect.void;

  return upsertMoved({ repositoryId, pullRequests: [first, ...rest], at });
}

/** Notes every pull request of the repository whose recorded head branch is one of `branches` as moved at `at`, as a commit status on their heads says; nothing where it names none. */
export function noteHeadsMoved(
  repositoryId: number,
  branches: readonly string[],
  at: Date,
): MoveEffect<void> {
  const [first, ...rest] = branches;

  if (first === undefined) return Effect.void;

  return updateHeadsMoved({ repositoryId, branches: [first, ...rest], at });
}
