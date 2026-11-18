import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect } from "effect";
import { Database } from "../../core/query.js";
import { invitation, member, organization, user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  deleteWorkspaceRows,
  handOverWorkspace,
  removeWorkspaceMember,
  renameWorkspace,
  setWorkspaceLogo,
  setWorkspaceMemberRole,
} from "../organization-store.js";

/**
 * The organization plugin's rows written by the service over a real
 * dialect: a member removed or given a role in one workspace alone, a
 * handover moving both roles, a name and a photo changed, and a delete
 * taking the workspace's row, members, and invitations, and no other
 * workspace's.
 *
 * Synthetic accounts and workspaces throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** Who is in a workspace, by account and role, in a fixed order. */
const membersOf = (organizationId: string) =>
  Database.use((db) =>
    db
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .orderBy(member.userId),
  );

/** A pending invitation to the workspace from the inviter. */
const invite = (organizationId: string, inviterId: string) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* Database.use((db) =>
      db.insert(invitation).values({
        id: randomUUID(),
        organizationId,
        email: `${randomUUID()}@app.test`,
        role: WORKSPACE_ROLE.MEMBER,
        inviterId,
        expiresAt: now,
      }),
    );
  });

/** How many member rows and invitation rows name the workspace. */
const rowsOf = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const members = yield* db
      .select()
      .from(member)
      .where(eq(member.organizationId, organizationId));

    const invitations = yield* db
      .select()
      .from(invitation)
      .where(eq(invitation.organizationId, organizationId));

    return { members: members.length, invitations: invitations.length };
  });

it.layer(getTestDB())("the organization plugin's rows", (it) => {
  it.effect(
    "a member is removed from, or given a role in, the one workspace named, and a handover moves both roles",
    () =>
      Effect.gen(function* () {
        const [ada, grace] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(ada);
        const beta = yield* openWorkspace(ada);
        yield* joinWorkspace(acme, grace);
        yield* joinWorkspace(beta, grace);

        yield* setWorkspaceMemberRole(acme, grace, WORKSPACE_ROLE.ADMIN);
        yield* handOverWorkspace(acme, ada, grace);
        yield* removeWorkspaceMember(beta, grace);

        const byId = <A extends { userId: string }>(rows: readonly A[]) =>
          rows.toSorted((a, b) => a.userId.localeCompare(b.userId));

        assert.deepEqual(
          yield* membersOf(acme),
          byId([
            { userId: ada, role: WORKSPACE_ROLE.ADMIN },
            { userId: grace, role: WORKSPACE_ROLE.OWNER },
          ]),
        );
        assert.deepEqual(yield* membersOf(beta), [{ userId: ada, role: WORKSPACE_ROLE.OWNER }]);
      }),
  );

  it.effect("a rename and a photo change their workspace alone, and null removes the photo", () =>
    Effect.gen(function* () {
      const ada = yield* openAccount;
      const acme = yield* openWorkspace(ada);
      const beta = yield* openWorkspace(ada);

      const read = (organizationId: string) =>
        Effect.map(
          Database.use((db) =>
            db
              .select({ name: organization.name, logo: organization.logo })
              .from(organization)
              .where(eq(organization.id, organizationId)),
          ),
          ([row]) => row,
        );

      const before = yield* read(beta);

      yield* renameWorkspace(acme, "Acme Labs");
      yield* setWorkspaceLogo(acme, "data:image/png;base64,AAAA");
      const photographed = yield* read(acme);
      yield* setWorkspaceLogo(acme, null);

      assert.deepEqual(photographed, { name: "Acme Labs", logo: "data:image/png;base64,AAAA" });
      assert.deepEqual(yield* read(acme), { name: "Acme Labs", logo: null });
      assert.deepEqual(yield* read(beta), before);
    }),
  );

  it.effect(
    "a delete takes the workspace, its members, and its invitations, and leaves another workspace's",
    () =>
      Effect.gen(function* () {
        const [ada, grace] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(ada);
        yield* joinWorkspace(acme, grace);
        yield* invite(acme, ada);
        const kept = yield* openWorkspace(ada);
        yield* invite(kept, ada);

        yield* deleteWorkspaceRows(acme);

        const organizations = yield* Database.use((db) =>
          db.select({ id: organization.id }).from(organization).where(eq(organization.id, acme)),
        );

        assert.deepEqual(organizations, []);
        assert.deepEqual(yield* rowsOf(acme), { members: 0, invitations: 0 });
        assert.deepEqual(yield* rowsOf(kept), { members: 1, invitations: 1 });
      }),
  );
});
