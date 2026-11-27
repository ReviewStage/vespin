/**
 * workspace-environment.test.ts -- a workspace's environment variables to an account outside it, over the test's own database: its list, put, save, and delete are each refused as not found, and the owner's variables stand as they were. Synthetic accounts, workspaces, keys, and values throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { Effect, Redacted, Result } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { AGENT_KEY_RING } from "../testing/agent-credentials.js";
import {
  deleteWorkspaceVariable,
  listWorkspaceEnvironment,
  putWorkspaceVariable,
  saveWorkspaceVariables,
} from "./workspace-environment.js";

const ring = Result.getOrThrow(parseKeyRing(AGENT_KEY_RING));

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("a workspace's environment variables", (it) => {
  it.effect("refuses an account outside the workspace every read and write of them", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const outsider = yield* openAccount;
      const workspaceId = yield* openWorkspace(owner);
      const config = { name: "REGION", value: "us-east-1" };

      yield* saveWorkspaceVariables(ring, owner, {
        workspaceId,
        secret: false,
        variables: [config],
      });

      const variable = { workspaceId, name: config.name };

      for (const refused of [
        listWorkspaceEnvironment(ring, outsider, workspaceId),
        putWorkspaceVariable(ring, outsider, variable, Redacted.make("eu-west-1")),
        saveWorkspaceVariables(ring, outsider, { workspaceId, secret: false, variables: [config] }),
        deleteWorkspaceVariable(ring, outsider, variable),
      ]) {
        assert.deepEqual(yield* Effect.flip(refused), HOSTED_REFUSAL.NOT_FOUND);
      }

      const listed = yield* listWorkspaceEnvironment(ring, owner, workspaceId);

      assert.deepEqual(
        listed.variables.map(({ name, value }) => ({ name, value })),
        [config],
      );
    }),
  );
});
