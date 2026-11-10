import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { REPOSITORY_SCRIPT_KIND } from "@repo/features/workspace-sandbox-setup-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  listRepositorySetups,
  readInstallScript,
  readRepositorySetup,
  removeInstallScript,
  removeRepositorySetup,
  setInstallScript,
  setRepositorySetup,
} from "../workspace-sandbox-script-store.js";

/**
 * A workspace's sandbox scripts, over a real dialect: a save replaces the
 * script that stood, a repository's script of each kind is one row however
 * its name is cased, a removal deletes it and leaves the other kind be, and
 * one workspace never reads or removes another's.
 * Synthetic accounts, workspaces, and scripts throughout.
 */

const AT = new Date("2026-11-08T12:00:00Z");
const LATER = new Date("2026-11-08T12:05:00Z");

const { SETUP, ARCHIVE } = REPOSITORY_SCRIPT_KIND;

const openOwnedWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return yield* openWorkspace(userId);
});

it.layer(getTestDB())("the workspace sandbox script store", (it) => {
  it.effect(
    "a save replaces the script that stood, a repository's script of each kind is one row however it is cased, and a removal deletes it alone",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openOwnedWorkspace;
        yield* setInstallScript(workspace, "sudo apt-get install -y redis", AT);
        yield* setInstallScript(workspace, "sudo apt-get install -y postgresql", LATER);
        yield* setRepositorySetup(workspace, "acme/relay", SETUP, "pnpm install", AT);
        yield* setRepositorySetup(
          workspace,
          "Acme/Relay",
          SETUP,
          "pnpm install && docker compose pull",
          LATER,
        );
        yield* setRepositorySetup(workspace, "acme/relay", ARCHIVE, "docker compose down", AT);
        yield* setRepositorySetup(workspace, "acme/api", SETUP, "uv sync", AT);

        const installed = yield* readInstallScript(workspace);
        assert.deepEqual(
          Option.map(installed, (row) => [row.script, row.updatedAt.getTime()]),
          Option.some(["sudo apt-get install -y postgresql", LATER.getTime()]),
        );
        assert.deepEqual(
          (yield* listRepositorySetups(workspace)).map((row) => [
            row.repository,
            row.kind,
            row.script,
          ]),
          [
            ["acme/api", SETUP, "uv sync"],
            ["acme/relay", ARCHIVE, "docker compose down"],
            ["Acme/Relay", SETUP, "pnpm install && docker compose pull"],
          ],
        );
        assert.equal(
          Option.map(
            yield* readRepositorySetup(workspace, "ACME/relay", SETUP),
            (row) => row.script,
          ).pipe(Option.getOrUndefined),
          "pnpm install && docker compose pull",
        );

        assert.equal(yield* removeRepositorySetup(workspace, "acme/RELAY", SETUP), true);
        assert.equal(yield* removeRepositorySetup(workspace, "acme/relay", SETUP), false);
        assert.equal(yield* removeInstallScript(workspace), true);
        assert.equal(Option.isNone(yield* readInstallScript(workspace)), true);
        assert.deepEqual(
          (yield* listRepositorySetups(workspace)).map((row) => [row.repository, row.kind]),
          [
            ["acme/api", SETUP],
            ["acme/relay", ARCHIVE],
          ],
        );
      }),
  );

  it.effect("one workspace neither reads nor removes another's scripts", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;
      yield* setInstallScript(theirs, "theirs", AT);
      yield* setRepositorySetup(theirs, "acme/relay", SETUP, "theirs", AT);

      assert.equal(Option.isNone(yield* readInstallScript(mine)), true);
      assert.deepEqual(yield* listRepositorySetups(mine), []);
      assert.equal(Option.isNone(yield* readRepositorySetup(mine, "acme/relay", SETUP)), true);
      assert.equal(yield* removeInstallScript(mine), false);
      assert.equal(yield* removeRepositorySetup(mine, "acme/relay", SETUP), false);
      assert.equal(Option.isSome(yield* readInstallScript(theirs)), true);
      assert.equal((yield* listRepositorySetups(theirs)).length, 1);
    }),
  );
});
