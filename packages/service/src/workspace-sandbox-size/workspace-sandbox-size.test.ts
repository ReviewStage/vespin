/**
 * workspace-sandbox-size.test.ts -- a workspace's sandbox size as its members choose it: an owner or admin chooses it up to the most the workspace may have, and is refused above it, as a member who is neither is refused any choice.
 *
 * Synthetic accounts and workspaces throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { setWorkspaceSandboxMaxVcpus } from "@repo/database/models/workspace-sandbox-size-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@repo/database/testing";
import { Effect } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { chooseSandboxSize, readSandboxSize } from "./workspace-sandbox-size.js";

const AT = new Date("2026-11-15T12:00:00Z");

/** A new account, answering its id. */
const signedUp = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) => db.insert(user).values({ id, name: id, email: `${id}@app.test` }));

  return id;
});

it.layer(getTestDB())("a workspace's sandbox size", (it) => {
  it.effect(
    "is chosen by an owner or admin up to the most the workspace may have, and refused above it or to a member",
    () =>
      Effect.gen(function* () {
        const owner = yield* signedUp;
        const member = yield* signedUp;
        const workspaceId = yield* openWorkspace(owner);
        yield* joinWorkspace(workspaceId, member, WORKSPACE_ROLE.MEMBER);

        assert.deepEqual(
          yield* Effect.flip(chooseSandboxSize(owner, workspaceId, 4)),
          HOSTED_REFUSAL.NOT_PERMITTED,
        );

        yield* setWorkspaceSandboxMaxVcpus(workspaceId, 8, AT);
        assert.deepEqual(yield* chooseSandboxSize(owner, workspaceId, 8), {
          vcpus: 8,
          maxVcpus: 8,
        });
        assert.deepEqual(
          yield* Effect.flip(chooseSandboxSize(member, workspaceId, 4)),
          HOSTED_REFUSAL.NOT_PERMITTED,
        );
        assert.deepEqual(yield* readSandboxSize(member, workspaceId), { vcpus: 8, maxVcpus: 8 });
      }),
  );
});
