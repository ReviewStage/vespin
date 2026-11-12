import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  cancelWorkspaceInvitation,
  createWorkspaceInvitation,
  isWorkspaceMemberAddress,
  listWorkspaceInvitations,
  pendingWorkspaceInvitations,
} from "../invitation-store.js";

/**
 * A workspace's invitations over a real dialect: one made stands pending
 * until its expiry, listed to its own workspace alone; a cancel withdraws
 * its own workspace's pending invitation and nothing else, keeping the row;
 * and an address is a member's only where an account under it is in that
 * workspace.
 *
 * Synthetic accounts, workspaces, and addresses throughout.
 */

const NOW = new Date("2026-11-10T12:00:00Z");
const LATER = new Date("2026-11-12T12:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("a workspace's invitations", (it) => {
  it.effect(
    "an invitation made stands pending until its expiry in its own workspace, and a cancel withdraws only its own workspace's pending one",
    () =>
      Effect.gen(function* () {
        const ada = yield* openAccount;
        const acme = yield* openWorkspace(ada);
        const beta = yield* openWorkspace(ada);

        const made = (organizationId: string, email: string) =>
          createWorkspaceInvitation({
            organizationId,
            email,
            role: WORKSPACE_ROLE.MEMBER,
            inviterId: ada,
            createdAt: NOW,
            expiresAt: LATER,
          });

        const grace = yield* made(acme, "grace@app.test");
        const alan = yield* made(acme, "alan@app.test");
        yield* made(beta, "linus@app.test");
        const pendingBefore = yield* pendingWorkspaceInvitations(acme, NOW);

        const canceled = {
          fromAnother: yield* cancelWorkspaceInvitation(beta, grace.id),
          own: yield* cancelWorkspaceInvitation(acme, grace.id),
          again: yield* cancelWorkspaceInvitation(acme, grace.id),
        };

        assert.deepEqual(grace, {
          id: grace.id,
          email: "grace@app.test",
          role: WORKSPACE_ROLE.MEMBER,
          status: "pending",
          expiresAt: LATER,
        });
        assert.deepEqual(
          pendingBefore.map((one) => one.id).toSorted(),
          [grace.id, alan.id].toSorted(),
        );
        assert.deepEqual(canceled, { fromAnother: false, own: true, again: false });
        assert.deepEqual(
          (yield* pendingWorkspaceInvitations(acme, NOW)).map((one) => one.id),
          [alan.id],
        );
        assert.deepEqual(yield* pendingWorkspaceInvitations(acme, LATER), []);
        assert.deepEqual(
          (yield* listWorkspaceInvitations(acme))
            .map(({ email, status }) => ({ email, status }))
            .toSorted((a, b) => a.email.localeCompare(b.email)),
          [
            { email: "alan@app.test", status: "pending" },
            { email: "grace@app.test", status: "canceled" },
          ],
        );
      }),
  );

  it.effect("an address is a member's only where its account is in the workspace named", () =>
    Effect.gen(function* () {
      const [ada, grace] = [yield* openAccount, yield* openAccount];
      const acme = yield* openWorkspace(ada);
      const beta = yield* openWorkspace(ada);
      yield* joinWorkspace(acme, grace);

      assert.equal(yield* isWorkspaceMemberAddress(acme, `${grace}@app.test`), true);
      assert.equal(yield* isWorkspaceMemberAddress(beta, `${grace}@app.test`), false);
      assert.equal(yield* isWorkspaceMemberAddress(acme, "nobody@app.test"), false);
    }),
  );
});
