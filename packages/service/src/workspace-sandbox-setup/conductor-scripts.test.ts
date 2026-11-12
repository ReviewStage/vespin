/**
 * conductor-scripts.test.ts -- a repository's Conductor scripts carried over: read from either file Conductor writes on its default branch, with Conductor's variables set first, and written only where the workspace has no script of its own.
 *
 * GitHub answers from each test's own files. Synthetic accounts,
 * workspaces, repositories, tokens, and commands throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  readRepositorySetup,
  readRunActions,
  setRepositorySetup,
} from "@repo/database/models/workspace-sandbox-script-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { REPOSITORY_SCRIPT_KIND } from "@repo/features/workspace-sandbox-setup-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Option, Redacted } from "effect";
import {
  CONDUCTOR_SCRIPTS_FILE,
  CONDUCTOR_SCRIPTS_FOUND,
  carryOverConductorScripts,
} from "./conductor-scripts.js";

const RELAY = { fullName: "acme/relay", defaultBranch: "main" };
const TOKEN = Redacted.make("ghs_fixture_repository_token");
const NOW = new Date("2026-11-12T12:00:00Z");

/** What every carried script is prefixed with, as Conductor's docs name the variables a cloud workspace sets. */
const EXPORTS = [
  'export CONDUCTOR_WORKSPACE_PATH="$PWD"',
  'export CONDUCTOR_ROOT_PATH="$PWD"',
  'export CONDUCTOR_BASE_DIR="$(dirname "$PWD")"',
  "export CONDUCTOR_IS_LOCAL=0",
].join("\n");

const SETTINGS_TOML = `
[scripts]
setup = "pnpm install"
archive = "./script/workspace-archive.sh"
run_mode = "concurrent"

[scripts.run.web]
command = "pnpm dev"
icon = "globe"

[scripts.run.api]
available_in = ["local", "cloud"]
command = "pnpm api"
args = ["--name", "it's"]
options = { cwd = "apps/api" }
default = true
icon = "Not An Icon"

[scripts.run.desktop]
available_in = "local"
command = "pnpm desktop"

[scripts.run.broken]
command = 42
`;

const CONDUCTOR_JSON = JSON.stringify({
  scripts: { setup: "npm ci", run: "npm start", archive: "" },
  runScriptMode: "nonconcurrent",
});

/** GitHub holding the files given on the repository's default branch, by path, and nothing else. */
function githubHolding(files: Readonly<Record<string, string>>) {
  return fakeHttpClientLayer((url) => {
    const { pathname, searchParams } = new URL(url);
    const path = decodeURIComponent(pathname.replace(`/repos/${RELAY.fullName}/contents/`, ""));
    const text = searchParams.get("ref") === RELAY.defaultBranch ? files[path] : undefined;

    if (text === undefined) return Response.json({ message: "Not Found" }, { status: 404 });
    const content = Buffer.from(text).toString("base64");

    return Response.json({ type: "file", size: text.length, encoding: "base64", content });
  });
}

/** A workspace a new account made, answering its id. */
const workspace = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) => db.insert(user).values({ id, name: id, email: `${id}@app.test` }));

  return yield* openWorkspace(id);
});

/** The repository's script of the kind as the workspace keeps it, where one is saved. */
const scriptOf = (
  workspaceId: string,
  kind: (typeof REPOSITORY_SCRIPT_KIND)[keyof typeof REPOSITORY_SCRIPT_KIND],
) =>
  Effect.map(
    readRepositorySetup(workspaceId, RELAY.fullName, kind),
    (row) => Option.getOrUndefined(row)?.script,
  );

/** The repository's run actions as the workspace keeps them, each as a save would name it. */
const actionsOf = (workspaceId: string) =>
  Effect.map(readRunActions(workspaceId, RELAY.fullName), (rows) =>
    rows.map(({ label, command, icon, isDefault }) => ({ label, command, icon, isDefault })),
  );

it.layer(getTestDB())("carrying a repository's Conductor scripts over", (it) => {
  it.effect(
    "reads settings.toml over conductor.json, keeping the cloud's run actions in order",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* workspace;

        const carried = yield* carryOverConductorScripts(TOKEN, workspaceId, RELAY, NOW).pipe(
          Effect.provide(
            githubHolding({
              [CONDUCTOR_SCRIPTS_FILE.SETTINGS_TOML]: SETTINGS_TOML,
              [CONDUCTOR_SCRIPTS_FILE.CONDUCTOR_JSON]: CONDUCTOR_JSON,
            }),
          ),
        );

        assert.deepEqual(carried, {
          found: CONDUCTOR_SCRIPTS_FOUND.READ,
          file: CONDUCTOR_SCRIPTS_FILE.SETTINGS_TOML,
          filledSetup: true,
          filledArchive: true,
          filledRunActions: 2,
        });

        assert.equal(
          yield* scriptOf(workspaceId, REPOSITORY_SCRIPT_KIND.SETUP),
          `${EXPORTS}\npnpm install`,
        );

        assert.equal(
          yield* scriptOf(workspaceId, REPOSITORY_SCRIPT_KIND.ARCHIVE),
          `${EXPORTS}\n./script/workspace-archive.sh`,
        );

        assert.deepEqual(yield* actionsOf(workspaceId), [
          {
            label: "web",
            command: `${EXPORTS}\npnpm dev`,
            icon: { kind: "glyph", glyph: "globe" },
            isDefault: false,
          },
          {
            label: "api",
            command: `${EXPORTS}\ncd 'apps/api' && pnpm api '--name' 'it'\\''s'`,
            icon: null,
            isDefault: true,
          },
        ]);
      }),
  );

  it.effect(
    "reads conductor.json where settings.toml stands nowhere, its one run command as Run",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* workspace;

        yield* carryOverConductorScripts(TOKEN, workspaceId, RELAY, NOW).pipe(
          Effect.provide(
            githubHolding({ [CONDUCTOR_SCRIPTS_FILE.CONDUCTOR_JSON]: CONDUCTOR_JSON }),
          ),
        );

        assert.equal(
          yield* scriptOf(workspaceId, REPOSITORY_SCRIPT_KIND.SETUP),
          `${EXPORTS}\nnpm ci`,
        );
        assert.equal(yield* scriptOf(workspaceId, REPOSITORY_SCRIPT_KIND.ARCHIVE), undefined);

        assert.deepEqual(yield* actionsOf(workspaceId), [
          { label: "Run", command: `${EXPORTS}\nnpm start`, icon: null, isDefault: false },
        ]);
      }),
  );

  it.effect("leaves every script a member saved as it stands, filling only what is empty", () =>
    Effect.gen(function* () {
      const workspaceId = yield* workspace;
      yield* setRepositorySetup(
        workspaceId,
        "Acme/Relay",
        REPOSITORY_SCRIPT_KIND.SETUP,
        "make",
        NOW,
      );

      const first = yield* carryOverConductorScripts(TOKEN, workspaceId, RELAY, NOW).pipe(
        Effect.provide(githubHolding({ [CONDUCTOR_SCRIPTS_FILE.CONDUCTOR_JSON]: CONDUCTOR_JSON })),
      );

      const again = yield* carryOverConductorScripts(TOKEN, workspaceId, RELAY, NOW).pipe(
        Effect.provide(githubHolding({ [CONDUCTOR_SCRIPTS_FILE.SETTINGS_TOML]: SETTINGS_TOML })),
      );

      assert.deepEqual(
        [first, again].map(({ filledSetup, filledArchive, filledRunActions }) => ({
          filledSetup,
          filledArchive,
          filledRunActions,
        })),
        [
          { filledSetup: false, filledArchive: false, filledRunActions: 1 },
          { filledSetup: false, filledArchive: true, filledRunActions: 0 },
        ],
      );

      assert.equal(yield* scriptOf(workspaceId, REPOSITORY_SCRIPT_KIND.SETUP), "make");

      assert.deepEqual(
        (yield* actionsOf(workspaceId)).map(({ label }) => label),
        ["Run"],
      );
    }),
  );
});
