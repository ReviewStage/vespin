/**
 * workspace-sandbox-size.test.ts -- a workspace's sandbox size as its members choose it: an owner or admin chooses it, and a member who is neither is refused.
 *
 * Synthetic accounts and workspaces throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@repo/database/testing";
import { Effect } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { chooseSandboxSize, readSandboxSize } from "./workspace-sandbox-size.js";

/** A new account, answering its id. */
const signedUp = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) => db.insert(user).values({ id, name: id, email: `${id}@app.test` }));

  return id;
});

it.layer(getTestDB())("a workspace's sandbox size", (it) => {
  it.effect("is chosen by an owner or admin, and refused to a member who is neither", () =>
    Effect.gen(function* () {
      const owner = yield* signedUp;
      const member = yield* signedUp;
      const workspaceId = yield* openWorkspace(owner);
      yield* joinWorkspace(workspaceId, member, WORKSPACE_ROLE.MEMBER);

      assert.deepEqual(yield* chooseSandboxSize(owner, workspaceId, 8), { vcpus: 8 });
      assert.deepEqual(
        yield* Effect.flip(chooseSandboxSize(member, workspaceId, 4)),
        HOSTED_REFUSAL.NOT_PERMITTED,
      );
      assert.deepEqual(yield* readSandboxSize(member, workspaceId), { vcpus: 8 });
    }),
  );
});
