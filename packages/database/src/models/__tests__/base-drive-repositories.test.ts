/**
 * base-drive-repositories.test.ts -- the workspaces' repositories a base drive may stand for, over a real dialect: each workspace's repository once, its case aside, under the account of its newest agent, across accounts, and none an agent on another branch or on a member's own token started. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_INSTALLATION_STATUS } from "@repo/features/github-installation-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { githubInstallation } from "../../schemas/github-installation.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, openInstallationWorkspace, openWorkspace } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import {
  baseDriveWorkspaceOfInstallation,
  listBaseDriveRepositories,
  listBaseDriveWorkspaces,
} from "../base-drive-repositories.js";
import { createTask } from "../task-store.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** An agent of the account's in its workspace, in the repository named, started at the day given. */
const startedIn = (
  userId: string,
  organizationId: string,
  repository: string,
  day: number,
  options: { readonly startBranch?: string; readonly githubAccess?: GitHubAccess } = {},
) =>
  Effect.gen(function* () {
    const { id: taskId } = yield* createTask(userId, { organizationId, name: "Client bump" });
    const started = yield* createAgent(userId, {
      taskId,
      descriptionSnapshot: null,
      prompt: "Bump the client",
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository,
      startBranch: options.startBranch,
      githubAccess: options.githubAccess ?? GITHUB_ACCESS.APP,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    const db = yield* Database;
    yield* db
      .update(agentTable)
      .set({ createdAt: new Date(Date.UTC(2026, 10, day)) })
      .where(eq(agentTable.id, Option.getOrThrow(started).agent.id));
  });

it.layer(getTestDB())("the repositories a base drive may stand for", (it) => {
  it.effect(
    "each workspace's repository once, under its newest default-branch agent's account, skipping another branch's and a member token's",
    () =>
      Effect.gen(function* () {
        const ada = yield* openAccount;
        const grace = yield* openAccount;
        const acme = yield* openWorkspace(ada);
        const globex = yield* openWorkspace(grace);
        const db = yield* Database;
        yield* db.delete(agentTable);

        yield* startedIn(ada, acme, "Acme/Relay", 1);
        yield* startedIn(ada, acme, "acme/relay", 3);
        yield* startedIn(ada, acme, "Acme/Relay", 5, { startBranch: "release" });
        yield* startedIn(ada, acme, "Acme/Ledger", 2, { githubAccess: GITHUB_ACCESS.TOKEN });
        yield* startedIn(grace, globex, "Globex/Relay", 4);

        const listed = yield* listBaseDriveRepositories();

        assert.deepEqual(
          listed.toSorted((one, other) => one.repository.localeCompare(other.repository)),
          [
            { workspaceId: acme, repository: "acme/relay", userId: ada },
            { workspaceId: globex, repository: "Globex/Relay", userId: grace },
          ],
        );
      }),
  );

  it.effect(
    "the workspace an active installation connects, under its owner, singly and in the list, and none once the installation is suspended",
    () =>
      Effect.gen(function* () {
        const ada = yield* openAccount;
        const installationId = 600_000 + Math.floor(Math.random() * 90_000);
        const acme = yield* openInstallationWorkspace(ada, {
          installationId,
          accountId: installationId,
          accountLogin: `acme-${installationId}`,
        });

        const connected = yield* baseDriveWorkspaceOfInstallation(installationId);
        const listedActive = (yield* listBaseDriveWorkspaces()).filter(
          (each) => each.userId === ada,
        );
        const db = yield* Database;
        yield* db
          .update(githubInstallation)
          .set({ status: GITHUB_INSTALLATION_STATUS.SUSPENDED })
          .where(eq(githubInstallation.installationId, installationId));
        const suspended = yield* baseDriveWorkspaceOfInstallation(installationId);

        const listed = (yield* listBaseDriveWorkspaces()).filter((each) => each.userId === ada);

        assert.deepEqual(connected, Option.some({ workspaceId: acme, userId: ada }));
        assert.deepEqual(suspended, Option.none());
        assert.deepEqual(listedActive, [{ workspaceId: acme, userId: ada }]);
        assert.deepEqual(listed, []);
      }),
  );
});
