import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  openWorkspaceVariable,
  parseKeyRing,
  sealWorkspaceVariable,
} from "../provider-key-seal.js";
import {
  listWorkspaceVariables,
  openWorkspaceEnvironment,
  removeWorkspaceVariable,
  setWorkspaceVariables,
} from "../workspace-environment-store.js";

/**
 * A workspace's shared environment variables, over a real dialect: a set
 * replaces the value of a name that stands, the list hands back a config's
 * sealed value and never a secret's, a secret never becomes a config, a
 * removal deletes the one name, and one workspace never reads another's.
 * Synthetic accounts, workspaces, keys, and values throughout.
 */

const AT = new Date("2026-11-06T12:00:00Z");
const LATER = new Date("2026-11-06T12:05:00Z");

const ring = Result.getOrThrow(
  parseKeyRing(Redacted.make(`1:${randomBytes(32).toString("base64")}`)),
);

const newMember = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name, email: `${userId}@app.test` });

    return userId;
  });

const OWNER = new Map<string, string>();

const openOwnedWorkspace = Effect.gen(function* () {
  const userId = yield* newMember("Test User");
  const workspace = yield* openWorkspace(userId);
  OWNER.set(workspace, userId);

  return workspace;
});

const sealed = (organizationId: string, name: string, value: string) =>
  sealWorkspaceVariable(ring, { organizationId, name }, Redacted.make(value));

const set = (
  organizationId: string,
  name: string,
  value: string,
  now: Date,
  secret?: boolean,
  by = OWNER.get(organizationId) ?? "",
) =>
  setWorkspaceVariables(
    organizationId,
    [{ name, sealed: sealed(organizationId, name, value) }],
    secret,
    by,
    now,
  );

it.layer(getTestDB())("the workspace environment store", (it) => {
  it.effect(
    "a set replaces the value of a name that stands, the list answers names alone, and a removal deletes one name",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openOwnedWorkspace;
        yield* set(workspace, "DATABASE_URL", "postgres://first", AT);
        yield* set(workspace, "API_TOKEN", "token-value", AT);
        yield* set(workspace, "DATABASE_URL", "postgres://second", LATER);

        const listed = yield* listWorkspaceVariables(workspace);
        assert.deepEqual(
          listed.map((row) => [row.name, row.updatedAt.getTime()]),
          [
            ["API_TOKEN", AT.getTime()],
            ["DATABASE_URL", LATER.getTime()],
          ],
        );
        assert.deepEqual(yield* openWorkspaceEnvironment(ring, workspace), {
          API_TOKEN: "token-value",
          DATABASE_URL: "postgres://second",
        });

        assert.equal(yield* removeWorkspaceVariable(workspace, "API_TOKEN"), true);
        assert.equal(yield* removeWorkspaceVariable(workspace, "API_TOKEN"), false);
        assert.deepEqual(yield* openWorkspaceEnvironment(ring, workspace), {
          DATABASE_URL: "postgres://second",
        });
      }),
  );

  it.effect("one workspace neither reads nor removes another's variables", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;
      yield* set(theirs, "SECRET", "theirs", AT);

      assert.deepEqual(yield* listWorkspaceVariables(mine), []);
      assert.deepEqual(yield* openWorkspaceEnvironment(ring, mine), {});
      assert.equal(yield* removeWorkspaceVariable(mine, "SECRET"), false);
      assert.deepEqual(yield* openWorkspaceEnvironment(ring, theirs), { SECRET: "theirs" });
    }),
  );

  it.effect("a value sealed for another workspace or another name is left out, not opened", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;

      const sealedFor = (organizationId: string, name: string) =>
        sealWorkspaceVariable(ring, { organizationId, name }, Redacted.make("moved"));

      const by = OWNER.get(mine) ?? "";
      yield* setWorkspaceVariables(
        mine,
        [
          { name: "FROM_THEIRS", sealed: sealedFor(theirs, "FROM_THEIRS") },
          { name: "RENAMED", sealed: sealedFor(mine, "ORIGINAL") },
        ],
        undefined,
        by,
        AT,
      );
      yield* set(mine, "KEPT", "kept", AT);

      assert.deepEqual(yield* openWorkspaceEnvironment(ring, mine), { KEPT: "kept" });
    }),
  );

  it.effect(
    "the list names who added and changed each, hands back a config's value alone, and a secret never becomes a config",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openOwnedWorkspace;
        const ada = yield* newMember("Ada");
        yield* set(workspace, "NODE_ENV", "production", AT, false);
        yield* set(workspace, "API_TOKEN", "token-value", AT);
        yield* set(workspace, "API_TOKEN", "turned", LATER, false, ada);

        const [token, nodeEnv] = yield* listWorkspaceVariables(workspace);
        assert.deepEqual(
          [token?.secret, token?.config, token?.createdBy?.name, token?.updatedBy?.name],
          [true, undefined, "Test User", "Ada"],
        );
        assert.deepEqual(
          [nodeEnv?.secret, nodeEnv?.createdBy?.name, nodeEnv?.updatedBy],
          [false, "Test User", undefined],
        );
        assert.ok(nodeEnv?.config !== undefined);

        const opened = openWorkspaceVariable(
          ring,
          { organizationId: workspace, name: "NODE_ENV" },
          nodeEnv.config,
        );

        assert.equal(Redacted.value(Result.getOrThrow(opened)), "production");
      }),
  );
});
