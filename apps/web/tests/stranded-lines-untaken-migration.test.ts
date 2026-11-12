import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@repo/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * stranded-lines-untaken-migration.test.ts -- the migration that gives a coding agent's lines no turn took after its newest turn ended the failed turn they would have had.
 *
 * Over a database migrated up to it, holding the lines the turn record's
 * backfill left awaiting nothing: once it runs, the lines written after a
 * conversation's newest turn ended, past any Stop asked of it, or in one with
 * no turn at all, await one turn of their own, failed `line_untaken` from its
 * queueing at the first of them, and lines taken, withdrawn, spoken by a call,
 * written before that turn or before its Stop, or after a session that ended
 * for good are left as they stand. A second run writes nothing. Synthetic accounts
 * throughout.
 */

const MIGRATION = "20261107202609_stranded_lines_untaken";

/** A migrations folder holding every migration named before `MIGRATION`'s. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "before-stranded-lines-" });

  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );

  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }

  return folder;
});

it.effect(
  "the lines no turn took after a conversation's newest turn ended, or after its Stop, or in one with no turn, await one turn failed as untaken from the first of them, every other line is left as it stands, and a second run writes nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* sql`insert into "user" (id, name, email) values ('dean', 'dean', 'dean@app.test')`;

        const conversation = () =>
          Effect.gen(function* () {
            const id = randomUUID();
            yield* sql`insert into conversations (id, user_id, kind) values (${id}, 'dean', 'agent')`;

            return id;
          });

        const turn = (
          conversationId: string,
          status: string,
          failure: string | null,
          stoppedAt: string | null = null,
        ) =>
          Effect.gen(function* () {
            const id = randomUUID();
            yield* sql`insert into turns (id, user_id, conversation_id, origin, status, failure, queued_at, settled_at, cancel_requested_at)
              values (${id}, 'dean', ${conversationId}, 'typed', ${status}, ${failure}, '2026-11-07T09:00:00Z', '2026-11-07T09:01:00Z', ${stoppedAt})`;

            return id;
          });

        let seq = 0;

        const line = (
          conversationId: string,
          at: string,
          kept: {
            readonly turnId?: string;
            readonly withdrawnAt?: string;
            readonly metadata?: string;
          } = {},
        ) =>
          Effect.gen(function* () {
            const id = randomUUID();
            seq += 1;
            yield* sql`insert into messages (id, user_id, conversation_id, seq, client_id, role, parts, metadata, created_at, placed_at, turn_id, withdrawn_at)
              values (${id}, 'dean', ${conversationId}, ${seq}, ${randomUUID()}, 'user', '[{"type":"text","text":"Rebase on main"}]'::jsonb,
                ${kept.metadata ?? null}::jsonb, ${at}, ${at}, ${kept.turnId ?? null}, ${kept.withdrawnAt ?? null})`;

            return id;
          });

        // An agent whose turn settled, then was sent two lines no runner took.
        const settled = yield* conversation();
        const ended = yield* turn(settled, "settled", null);
        const before = yield* line(settled, "2026-11-07T08:59:00Z");
        const taken = yield* line(settled, "2026-11-07T09:00:30Z", { turnId: ended });

        const withdrawn = yield* line(settled, "2026-11-07T09:05:00Z", {
          withdrawnAt: "2026-11-07T09:06:00Z",
        });

        const first = yield* line(settled, "2026-11-07T09:10:00Z");

        // A line a call spoke, which the call answers with no turn of the agent's.
        const spoken = yield* line(settled, "2026-11-07T09:11:00Z", {
          metadata: '{"channel":"voice"}',
        });

        const second = yield* line(settled, "2026-11-07T09:12:00Z");
        // An agent whose session ended for good, which reads failed as it stands.
        const sessionEnded = yield* conversation();
        yield* turn(sessionEnded, "failed", "session_ended");
        const afterEnd = yield* line(sessionEnded, "2026-11-07T09:10:00Z");
        // An agent whose first line no turn ever took, its conversation holding no turn at all.
        const turnless = yield* conversation();
        const unopened = yield* line(turnless, "2026-11-07T09:30:00Z");
        // An agent stopped with a line its turn never took, then sent another after the Stop.
        const stopped = yield* conversation();
        yield* turn(stopped, "cancelled", null, "2026-11-07T09:00:50Z");
        const beforeStop = yield* line(stopped, "2026-11-07T09:00:40Z");
        const afterStop = yield* line(stopped, "2026-11-07T09:02:00Z");

        yield* runWebMigrations();

        const turnsOf = (conversationId: string) =>
          sql<{
            readonly id: string;
            readonly status: string;
            readonly failure: string | null;
            readonly queuedAt: string;
            readonly settledAt: string | null;
            readonly open: boolean;
          }>`select id, status, failure, queued_at::text as "queuedAt", settled_at::text as "settledAt",
            (lease_until is not null or started_at is not null) as open
            from turns where conversation_id = ${conversationId} order by queued_at desc, id desc`;

        const awaited = sql<{
          readonly id: string;
          readonly awaits: string | null;
        }>`select id, awaits_turn_id as awaits from messages order by seq`;

        const [minted, ...rest] = yield* turnsOf(settled);
        assert.deepEqual(
          rest.map((each) => each.id),
          [ended],
        );
        assert.deepEqual(minted && { ...minted, id: undefined }, {
          id: undefined,
          status: "failed",
          failure: "line_untaken",
          queuedAt: "2026-11-07 09:10:00+00",
          settledAt: "2026-11-07 09:20:00+00",
          open: false,
        });
        const links = new Map((yield* awaited).map((each) => [each.id, each.awaits]));
        assert.deepEqual(
          [before, taken, withdrawn, first, spoken, second, afterEnd].map((id) => links.get(id)),
          [null, null, null, minted?.id, null, minted?.id, null],
        );
        assert.equal((yield* turnsOf(sessionEnded)).length, 1);
        const [opened] = yield* turnsOf(turnless);
        assert.deepEqual(
          [opened?.failure, opened?.queuedAt, links.get(unopened)],
          ["line_untaken", "2026-11-07 09:30:00+00", opened?.id],
        );
        // The line written before the Stop was stopped with its turn, and awaits nothing still.
        const [afterStopped] = yield* turnsOf(stopped);
        assert.deepEqual(
          [afterStopped?.queuedAt, links.get(beforeStop), links.get(afterStop)],
          ["2026-11-07 09:02:00+00", null, afterStopped?.id],
        );

        // A second run of the migration, as a deploy that ran it before recording it would, writes nothing.
        const fileSystem = yield* FileSystem;
        const path = yield* Path;

        const statement = yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
        );

        const linked = yield* awaited;
        yield* sql.unsafe(statement);
        assert.equal((yield* turnsOf(settled)).length, 2);
        assert.equal((yield* turnsOf(turnless)).length, 1);
        assert.deepEqual(yield* awaited, linked);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
