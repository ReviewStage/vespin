/**
 * base-drive-refresh.test.ts -- the daily base drive refresh, over the test's own database, a GitHub that answers from the test's own installation, and `Sandbox` kept in memory: each base drive that stands refilled, a repository whose drive stands not passed by with no drive filled for it, and a refill that failed logged and passed by while the next is refilled. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { SANDBOX_CALL, Sandbox, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect, Layer, Option } from "effect";
import { connectWorkspaceGitHub, githubReaching } from "../testing/github-app-fake.js";
import { baseDriveName } from "./base-drive.js";
import { refreshBaseDrives } from "./base-drive-refresh.js";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";

const INSTALLATION = {
  id: 7101,
  login: "acme",
  repositories: [
    { owner: "acme", name: "relay" },
    { owner: "acme", name: "ledger" },
    { owner: "acme", name: "beacon" },
  ],
};

const IMAGE = Layer.succeed(AgentImage, {
  reference: Effect.succeed("agent-image:fixture"),
  runner: Effect.succeed([]),
});

/** The refill's checkout run straight on the test's own runtime. */
const run: SandboxRunner = (effect) => Effect.runPromise(effect);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** An agent of the account's started on a task on the repository's default branch on the workspace's installation. */
const startedIn = (userId: string, organizationId: string, repository: string) =>
  Effect.flatMap(createTask(userId, { organizationId, repository }), (task) =>
    createAgent(userId, {
      taskId: task.id,
      descriptionSnapshot: null,
      prompt: "Bump the client",
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository,
      githubAccess: GITHUB_ACCESS.APP,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    }),
  );

it.layer(getTestDB())("the daily base drive refresh", (it) => {
  it.effect(
    "refills each base drive that stands, fills none for a repository without one, and goes on past a refill that failed",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspaceId, INSTALLATION);
        const relay = baseDriveName({ workspaceId, fullName: "acme/relay" });
        const beacon = baseDriveName({ workspaceId, fullName: "acme/beacon" });
        // Beacon's fill fails as its sandbox is created; relay's goes through.
        const memory = memorySandbox({
          fail: (call, name) =>
            call === SANDBOX_CALL.CREATE && name === beacon
              ? new SandboxUnavailable({ call })
              : undefined,
        });
        for (const name of [relay, beacon]) {
          memory.state.drives.set(name, { name, forkedFrom: undefined });
        }
        for (const repository of ["acme/beacon", "acme/ledger", "acme/relay"]) {
          Option.getOrThrow(yield* startedIn(owner, workspaceId, repository));
        }

        const refreshed = yield* refreshBaseDrives(run).pipe(
          Effect.provide(Layer.mergeAll(IMAGE, githubReaching([INSTALLATION]).layer)),
          Effect.provideService(Sandbox, memory.service),
        );

        assert.deepEqual(refreshed, { refilled: 1, passed: 1, failed: 1 });
        assert.deepEqual(memory.state.deleted, [relay]);
        assert.deepEqual([...memory.state.drives.keys()].toSorted(), [relay, beacon].toSorted());
      }),
  );
});
