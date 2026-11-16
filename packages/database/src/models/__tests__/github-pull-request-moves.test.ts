import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { githubPullRequestMove } from "../../schemas/github-pull-request-move.js";
import { getTestDB } from "../../testing/index.js";
import { noteHeadsMoved, notePullRequestsMoved } from "../github-pull-request-moves.js";

/**
 * GitHub's deliveries noted as pull requests moved: a commit status finds
 * the pull request by the head branch an earlier delivery recorded, though
 * one since named no head or a late one an older commit, and moves no
 * other; and every write moves the row past where it stood, though two are
 * read in one millisecond or a late one reads earlier.
 *
 * Synthetic repository ids, numbers, branches, and commits throughout.
 */

/** A fresh id for a repository, so no other test's rows are in the way. */
const repositoryId = () => Math.floor(Math.random() * 1_000_000_000) + 1;

/** An instant by the minute of an hour it names. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 16, 12, minute));

const INVITES = { ref: "agent/invite-once", sha: "c0ffee1" };

/** The repository's rows as they stand: each number, its head branch, and when it last moved. */
const rowsOf = (repository: number) =>
  Effect.map(
    Database.use((db) =>
      db
        .select()
        .from(githubPullRequestMove)
        .where(eq(githubPullRequestMove.repositoryId, repository))
        .orderBy(asc(githubPullRequestMove.number)),
    ),
    (rows) =>
      rows.map((row) => ({ number: row.number, headRef: row.headRef, at: row.movedAt.getTime() })),
  );

it.layer(getTestDB())("pull requests GitHub says moved", (it) => {
  it.effect(
    "a status on a head branch moves that pull request alone, though a comment since named no head and a late delivery an older commit",
    () =>
      Effect.gen(function* () {
        const relay = repositoryId();
        const elsewhere = repositoryId();

        // A check suite naming one pull request twice is one row, and another of the repository stands beside it.
        yield* notePullRequestsMoved(
          relay,
          [
            { number: 41, head: INVITES },
            { number: 41, head: INVITES },
            { number: 7, head: { ref: "agent/expiry", sha: "ba5e000" } },
          ],
          at(0),
        );
        yield* notePullRequestsMoved(elsewhere, [{ number: 41, head: INVITES }], at(0));
        yield* notePullRequestsMoved(relay, [{ number: 41 }], at(5));
        yield* notePullRequestsMoved(
          relay,
          [{ number: 41, head: { ...INVITES, sha: "0ld0000" } }],
          at(6),
        );

        yield* noteHeadsMoved(relay, [INVITES.ref], at(9));

        assert.deepEqual(yield* rowsOf(relay), [
          { number: 7, headRef: "agent/expiry", at: at(0).getTime() },
          { number: 41, headRef: INVITES.ref, at: at(9).getTime() },
        ]);
        assert.deepEqual(yield* rowsOf(elsewhere), [
          { number: 41, headRef: INVITES.ref, at: at(0).getTime() },
        ]);
      }),
  );

  it.effect(
    "a write read in the same millisecond as the last, or before it, still moves the row past where it stood",
    () =>
      Effect.gen(function* () {
        const relay = repositoryId();
        yield* notePullRequestsMoved(relay, [{ number: 41, head: INVITES }], at(5));
        yield* notePullRequestsMoved(relay, [{ number: 41 }], at(5));
        yield* noteHeadsMoved(relay, [INVITES.ref], at(1));

        assert.deepEqual(yield* rowsOf(relay), [
          { number: 41, headRef: INVITES.ref, at: at(5).getTime() + 2 },
        ]);
      }),
  );
});
