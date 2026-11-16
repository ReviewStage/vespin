import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { githubPullRequestMove } from "../../schemas/github-pull-request-move.js";
import { getTestDB } from "../../testing/index.js";
import { noteHeadMoved, notePullRequestsMoved } from "../github-pull-request-moves.js";

/**
 * GitHub's deliveries noted as pull requests moved: a delivery naming no
 * head keeps the head an earlier one recorded, so a commit status, which
 * names only a commit, still finds the pull request whose head it is, and
 * moves no other.
 *
 * Synthetic repository ids, numbers, and commits throughout.
 */

/** A fresh id for a repository, so no other test's rows are in the way. */
const repositoryId = () => Math.floor(Math.random() * 1_000_000_000) + 1;

/** An instant by the minute of an hour it names. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 16, 12, minute));

/** The repository's rows as they stand: each number, its head, and the minute it last moved. */
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
      rows.map((row) => ({
        number: row.number,
        headSha: row.headSha,
        minute: row.movedAt.getUTCMinutes(),
      })),
  );

it.layer(getTestDB())("pull requests GitHub says moved", (it) => {
  it.effect(
    "a status on a head an earlier delivery recorded moves that pull request alone, though a comment since named no head",
    () =>
      Effect.gen(function* () {
        const relay = repositoryId();
        const elsewhere = repositoryId();

        // A check suite naming one pull request twice is one row, and another of the repository stands beside it.
        yield* notePullRequestsMoved(
          relay,
          [
            { number: 41, headSha: "c0ffee1" },
            { number: 41, headSha: "c0ffee1" },
            { number: 7, headSha: "ba5e000" },
          ],
          at(0),
        );
        yield* notePullRequestsMoved(elsewhere, [{ number: 41, headSha: "c0ffee1" }], at(0));
        yield* notePullRequestsMoved(relay, [{ number: 41 }], at(5));

        yield* noteHeadMoved(relay, "c0ffee1", at(9));

        assert.deepEqual(yield* rowsOf(relay), [
          { number: 7, headSha: "ba5e000", minute: 0 },
          { number: 41, headSha: "c0ffee1", minute: 9 },
        ]);
        assert.deepEqual(yield* rowsOf(elsewhere), [{ number: 41, headSha: "c0ffee1", minute: 0 }]);
      }),
  );
});
