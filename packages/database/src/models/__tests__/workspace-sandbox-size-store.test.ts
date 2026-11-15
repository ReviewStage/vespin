import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  readWorkspaceSandboxSize,
  setWorkspaceSandboxMaxVcpus,
  setWorkspaceSandboxVcpus,
  workspaceSandboxSizesOf,
} from "../workspace-sandbox-size-store.js";

/**
 * A workspace's sandbox size over a real dialect: two vCPUs and no more
 * until something is set, the choice and the most kept apart so setting one
 * leaves the other, its own and no other workspace's, read one by one or
 * several at once, and nothing written for a workspace that does not stand.
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
    "reads two vCPUs at most two until set, keeps the choice and the most apart, and is its own workspace's alone",
    () =>
      Effect.gen(function* () {
        const acme = yield* openAccountWorkspace;
        const beta = yield* openAccountWorkspace;

        assert.deepEqual(yield* readWorkspaceSandboxSize(acme), { vcpus: 2, maxVcpus: 2 });

        assert.deepEqual(
          yield* setWorkspaceSandboxMaxVcpus(acme, 8, AT),
          Option.some({ vcpus: 2, maxVcpus: 8 }),
        );
        assert.deepEqual(
          yield* setWorkspaceSandboxVcpus(acme, 4, AT),
          Option.some({ vcpus: 4, maxVcpus: 8 }),
        );
        assert.deepEqual(
          yield* setWorkspaceSandboxMaxVcpus(acme, 2, AT),
          Option.some({ vcpus: 4, maxVcpus: 2 }),
        );

        yield* setWorkspaceSandboxVcpus(beta, 8, AT);
        assert.deepEqual(yield* readWorkspaceSandboxSize(acme), { vcpus: 4, maxVcpus: 2 });
        assert.deepEqual(yield* readWorkspaceSandboxSize(beta), { vcpus: 8, maxVcpus: 2 });

        const sizes = yield* workspaceSandboxSizesOf([acme, beta, `workspace-${randomUUID()}`]);
        assert.deepEqual(sizes(acme), { vcpus: 4, maxVcpus: 2 });
        assert.deepEqual(sizes(`workspace-${randomUUID()}`), { vcpus: 2, maxVcpus: 2 });
      }),
  );

  it.effect("writes nothing for a workspace that does not stand", () =>
    Effect.gen(function* () {
      const gone = `workspace-${randomUUID()}`;

      assert.deepEqual(yield* setWorkspaceSandboxVcpus(gone, 4, AT), Option.none());
      assert.deepEqual(yield* setWorkspaceSandboxMaxVcpus(gone, 4, AT), Option.none());
      assert.deepEqual(yield* readWorkspaceSandboxSize(gone), { vcpus: 2, maxVcpus: 2 });
    }),
  );
});
