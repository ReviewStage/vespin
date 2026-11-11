/**
 * base-drive-repositories.test.ts -- the workspaces a base drive may stand in, over a real dialect: each workspace with an active installation once, under its owner's account, across accounts, and none whose installation is suspended or that has none. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_INSTALLATION_STATUS } from "@repo/features/github-installation-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { githubInstallation } from "../../schemas/github-installation.js";
import {
  getTestDB,
  joinWorkspace,
  openInstallationWorkspace,
  openWorkspace,
} from "../../testing/index.js";
import { listBaseDriveWorkspaces } from "../base-drive-repositories.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** A fresh installation's ids, unique to the run. */
const installationIds = () => {
  const installationId = Math.floor(Math.random() * 1_000_000_000);
  return { installationId, accountId: installationId, accountLogin: `acct-${installationId}` };
};

it.layer(getTestDB())("the workspaces a base drive may stand in", (it) => {
  it.effect(
    "each workspace with an active installation once, under its owner, skipping a suspended installation's and one with none",
    () =>
      Effect.gen(function* () {
        const ada = yield* openAccount;
        const grace = yield* openAccount;
        const linus = yield* openAccount;
        const acme = yield* openInstallationWorkspace(ada, installationIds());
        yield* joinWorkspace(acme, grace, WORKSPACE_ROLE.MEMBER);
        const globex = yield* openInstallationWorkspace(grace, installationIds());
        const suspended = installationIds();
        yield* openInstallationWorkspace(linus, suspended);
        yield* openWorkspace(linus);
        const db = yield* Database;
        yield* db
          .update(githubInstallation)
          .set({ status: GITHUB_INSTALLATION_STATUS.SUSPENDED })
          .where(eq(githubInstallation.installationId, suspended.installationId));

        const listed = (yield* listBaseDriveWorkspaces()).filter((each) =>
          [ada, grace, linus].includes(each.userId),
        );

        assert.deepEqual(
          listed.toSorted((one, other) => one.workspaceId.localeCompare(other.workspaceId)),
          [
            { workspaceId: acme, userId: ada },
            { workspaceId: globex, userId: grace },
          ].toSorted((one, other) => one.workspaceId.localeCompare(other.workspaceId)),
        );
      }),
  );
});
