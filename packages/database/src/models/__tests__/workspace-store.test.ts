import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  WORKSPACE_ROLE,
} from "../../testing/index.js";
import { claimSoleWorkspace, listWorkspaces } from "../workspace-store.js";

/**
 * A workspace claimed by its only member over a real dialect, as an
 * account's deletion claims one whose owner left before it.
 *
 * Synthetic accounts and workspaces throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("a sole member's claim", (it) => {
  it.effect(
    "a member of a workspace someone else is still in is not made its owner, nor in their other workspace",
    () =>
      Effect.gen(function* () {
        const [ada, grace] = [yield* openAccount, yield* openAccount];
        const shared = yield* openWorkspace(ada);
        yield* joinWorkspace(shared, grace);
        // Grace is left alone in a second workspace whose owner left.
        const alone = yield* openWorkspace(ada);
        yield* joinWorkspace(alone, grace);
        yield* leaveWorkspace(alone, ada);

        yield* claimSoleWorkspace(grace, shared);

        const roles = (yield* listWorkspaces(grace)).map(({ id, role }) => ({ id, role }));
        assert.deepEqual(
          roles.toSorted((a, b) => a.id.localeCompare(b.id)),
          [
            { id: shared, role: WORKSPACE_ROLE.MEMBER },
            { id: alone, role: WORKSPACE_ROLE.MEMBER },
          ].toSorted((a, b) => a.id.localeCompare(b.id)),
        );
      }),
  );
});
