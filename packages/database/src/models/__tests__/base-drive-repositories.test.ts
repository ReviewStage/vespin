/**
 * base-drive-repositories.test.ts -- the workspace a drive is filled for, over a real dialect: an installation's workspace under its first owner whatever its status. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_INSTALLATION_STATUS } from "@repo/features/github-installation-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { githubInstallation } from "../../schemas/github-installation.js";
import { getTestDB, openInstallationWorkspace } from "../../testing/index.js";
import {
  baseDriveWorkspaceOfInstallation,
  workspaceDriveOwner,
} from "../base-drive-repositories.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("the workspaces a drive is filled for", (it) => {
  it.effect("an installation's workspace under its first owner whatever its status", () =>
    Effect.gen(function* () {
      const ada = yield* openAccount;
      const installationId = 600_000 + Math.floor(Math.random() * 90_000);

      const acme = yield* openInstallationWorkspace(ada, {
        installationId,
        accountId: installationId,
        accountLogin: `acme-${installationId}`,
      });

      const db = yield* Database;
      yield* db
        .update(githubInstallation)
        .set({ status: GITHUB_INSTALLATION_STATUS.SUSPENDED })
        .where(eq(githubInstallation.installationId, installationId));
      const suspended = yield* baseDriveWorkspaceOfInstallation(installationId);

      const owned = { workspaceId: acme, userId: ada };
      assert.deepEqual(suspended, Option.some(owned));
      assert.deepEqual(yield* workspaceDriveOwner(acme), Option.some(owned));
    }),
  );
});
