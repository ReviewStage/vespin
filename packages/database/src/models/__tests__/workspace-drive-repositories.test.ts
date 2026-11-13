/**
 * workspace-drive-repositories.test.ts -- the repositories a workspace's drive holds, over a real dialect: recorded and forgotten whatever their case, and kept apart by workspace. Synthetic accounts and repositories throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  forgetWorkspaceDriveRepositories,
  recordWorkspaceDriveRepositories,
  workspaceDriveRepositories,
} from "../workspace-drive-repositories.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("a workspace drive's repositories", (it) => {
  it.effect("are recorded and forgotten whatever their case", () =>
    Effect.gen(function* () {
      const acme = yield* openWorkspace(yield* openAccount);

      yield* recordWorkspaceDriveRepositories(acme, ["Acme/Relay", "acme/site"], new Date(1));
      yield* recordWorkspaceDriveRepositories(acme, ["acme/relay"], new Date(2));
      assert.deepEqual(yield* workspaceDriveRepositories(acme), ["acme/relay", "acme/site"]);

      yield* forgetWorkspaceDriveRepositories(acme, ["ACME/SITE"]);
      assert.deepEqual(yield* workspaceDriveRepositories(acme), ["acme/relay"]);
    }),
  );

  it.effect("one workspace never reads or forgets another's", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const [acme, globex] = [yield* openWorkspace(owner), yield* openWorkspace(owner)];

      yield* recordWorkspaceDriveRepositories(acme, ["acme/relay"], new Date(1));
      yield* forgetWorkspaceDriveRepositories(globex, ["acme/relay"]);

      assert.deepEqual(yield* workspaceDriveRepositories(globex), []);
      assert.deepEqual(yield* workspaceDriveRepositories(acme), ["acme/relay"]);
    }),
  );
});
