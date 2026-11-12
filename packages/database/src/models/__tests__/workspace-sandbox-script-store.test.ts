import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TASK_SECTION_ICON_KIND } from "@repo/features/task-section-wire";
import {
  REPOSITORY_SCRIPT_KIND,
  RUN_ACTION_AVAILABILITY,
} from "@repo/features/workspace-sandbox-setup-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  listRepositorySetups,
  listRunActions,
  readInstallScript,
  readRepositorySetup,
  readRunActions,
  removeInstallScript,
  removeRepositorySetup,
  setInstallScript,
  setRepositorySetup,
  setRunActions,
} from "../workspace-sandbox-script-store.js";

/**
 * A workspace's sandbox scripts, over a real dialect: a save replaces the
 * script that stood, a repository's script of each kind is one row however
 * its name is cased, a removal deletes it and leaves the other kind be, a
 * repository's run actions are replaced as one list in its order, and one
 * workspace never reads or removes another's.
 * Synthetic accounts, workspaces, and scripts throughout.
 */

const AT = new Date("2026-11-08T12:00:00Z");
const LATER = new Date("2026-11-08T12:05:00Z");

const { SETUP, ARCHIVE } = REPOSITORY_SCRIPT_KIND;

const BOOKS = { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "📚" } as const;

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

  it.effect(
    "a save replaces a repository's run actions in its order with their icons, one default, and where each may run, both where unsaid, an action keeps only its own repository's id and only once, and an empty list removes them",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openOwnedWorkspace;
        yield* setRunActions(
          workspace,
          "acme/relay",
          [
            { id: randomUUID(), label: "Dev server", command: "pnpm dev" },
            { label: "Tests", command: "pnpm test" },
          ],
          AT,
        );
        yield* setRunActions(
          workspace,
          "acme/api",
          [{ label: "Serve", command: "uv run serve" }],
          AT,
        );
        const dev = (yield* readRunActions(workspace, "acme/relay"))[0]?.id ?? "";
        const api = (yield* readRunActions(workspace, "acme/api"))[0]?.id ?? "";
        yield* setRunActions(
          workspace,
          "Acme/Relay",
          [
            {
              label: "Storybook",
              command: "pnpm storybook",
              icon: BOOKS,
              availableIn: RUN_ACTION_AVAILABILITY.LOCAL,
            },
            { id: dev, label: "Dev", command: "pnpm dev --port 3000", isDefault: true },
            {
              id: dev,
              label: "Dev again",
              command: "pnpm dev",
              isDefault: true,
              availableIn: RUN_ACTION_AVAILABILITY.CLOUD,
            },
            { id: api, label: "Serve", command: "uv run serve" },
          ],
          LATER,
        );

        assert.deepEqual(
          (yield* listRunActions(workspace)).map((row) => [row.repository, row.label]),
          [
            ["acme/api", "Serve"],
            ["Acme/Relay", "Storybook"],
            ["Acme/Relay", "Dev"],
            ["Acme/Relay", "Dev again"],
            ["Acme/Relay", "Serve"],
          ],
        );
        const relay = yield* readRunActions(workspace, "ACME/relay");
        assert.deepEqual(
          relay.map((row) => [
            row.label,
            row.command,
            row.icon,
            row.isDefault,
            row.availableIn,
            row.updatedAt.getTime(),
          ]),
          [
            [
              "Storybook",
              "pnpm storybook",
              BOOKS,
              false,
              RUN_ACTION_AVAILABILITY.LOCAL,
              LATER.getTime(),
            ],
            [
              "Dev",
              "pnpm dev --port 3000",
              null,
              true,
              RUN_ACTION_AVAILABILITY.BOTH,
              LATER.getTime(),
            ],
            ["Dev again", "pnpm dev", null, false, RUN_ACTION_AVAILABILITY.CLOUD, LATER.getTime()],
            ["Serve", "uv run serve", null, false, RUN_ACTION_AVAILABILITY.BOTH, LATER.getTime()],
          ],
        );
        const ids = relay.map((row) => row.id);
        assert.equal(ids[1], dev);
        assert.equal(new Set(ids).size, 4);
        assert.equal(ids.includes(api), false);

        yield* setRunActions(workspace, "acme/relay", [], LATER);
        assert.deepEqual(yield* readRunActions(workspace, "acme/relay"), []);
        assert.equal((yield* listRunActions(workspace)).length, 1);
      }),
  );

  it.effect(
    "a save of a repository's run actions is stamped later than the list it replaces, even from an earlier or the same clock reading",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openOwnedWorkspace;

        const stampOf = Effect.map(
          readRunActions(workspace, "acme/relay"),
          (rows) => rows[0]?.updatedAt.getTime() ?? 0,
        );

        yield* setRunActions(
          workspace,
          "acme/relay",
          [{ label: "Dev", command: "pnpm dev" }],
          LATER,
        );
        const first = yield* stampOf;
        yield* setRunActions(
          workspace,
          "acme/relay",
          [{ label: "Dev", command: "pnpm dev" }],
          LATER,
        );
        const second = yield* stampOf;
        // A save whose clock was read before the lock, while the save before it waited.
        yield* setRunActions(workspace, "acme/relay", [{ label: "Dev", command: "pnpm dev" }], AT);
        const third = yield* stampOf;

        assert.equal(first, LATER.getTime());
        assert.ok(second > first, `${second} > ${first}`);
        assert.ok(third > second, `${third} > ${second}`);
      }),
  );

  it.effect("one workspace neither reads nor removes another's scripts", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;
      yield* setInstallScript(theirs, "theirs", AT);
      yield* setRepositorySetup(theirs, "acme/relay", SETUP, "theirs", AT);
      yield* setRunActions(theirs, "acme/relay", [{ label: "Dev", command: "theirs" }], AT);

      assert.equal(Option.isNone(yield* readInstallScript(mine)), true);
      assert.deepEqual(yield* listRepositorySetups(mine), []);
      assert.equal(Option.isNone(yield* readRepositorySetup(mine, "acme/relay", SETUP)), true);
      assert.equal(yield* removeInstallScript(mine), false);
      assert.equal(yield* removeRepositorySetup(mine, "acme/relay", SETUP), false);
      assert.deepEqual(yield* listRunActions(mine), []);
      assert.deepEqual(yield* readRunActions(mine, "acme/relay"), []);
      yield* setRunActions(mine, "acme/relay", [], AT);
      assert.equal(Option.isSome(yield* readInstallScript(theirs)), true);
      assert.equal((yield* listRepositorySetups(theirs)).length, 1);
      assert.equal((yield* readRunActions(theirs, "acme/relay")).length, 1);
    }),
  );
});
