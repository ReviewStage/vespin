import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  readWorkspaceSandboxVcpus,
  setWorkspaceSandboxVcpus,
  workspaceSandboxVcpusOf,
} from "../workspace-sandbox-size-store.js";

/**
 * A workspace's sandbox size over a real dialect: two vCPUs until set, then
 * the size last set, its own and no other workspace's, read one by one or
 * several at once.
 *
 * Synthetic accounts and workspaces throughout.
 */

const AT = new Date("2026-11-15T12:00:00Z");

const openAccountWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return yield* openWorkspace(id);
});

it.layer(getTestDB())("a workspace's sandbox size", (it) => {
  it.effect(
    "reads two vCPUs until set, then the size last set, and is its own workspace's alone",
    () =>
      Effect.gen(function* () {
        const acme = yield* openAccountWorkspace;
        const beta = yield* openAccountWorkspace;

        assert.equal(yield* readWorkspaceSandboxVcpus(acme), 2);

        yield* setWorkspaceSandboxVcpus(acme, 8, AT);
        yield* setWorkspaceSandboxVcpus(acme, 4, AT);
        assert.equal(yield* readWorkspaceSandboxVcpus(acme), 4);
        assert.equal(yield* readWorkspaceSandboxVcpus(beta), 2);

        const vcpusOf = yield* workspaceSandboxVcpusOf([acme, beta]);
        assert.deepEqual([vcpusOf(acme), vcpusOf(beta)], [4, 2]);
      }),
  );
});
