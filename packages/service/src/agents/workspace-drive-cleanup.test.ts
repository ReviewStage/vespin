/**
 * workspace-drive-cleanup.test.ts -- the daily cleanup, over the test's own database and `Sandbox` kept in memory: a repository no agent of the workspace started in lately loses its folder and its row, and one an agent started in is kept. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  recordWorkspaceDriveRepositories,
  workspaceDriveRepositories,
} from "@repo/database/models/workspace-drive-repositories";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "@repo/database/testing";
import { Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect, Layer } from "effect";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import { cleanWorkspaceDrives } from "./workspace-drive-cleanup.js";

const { VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

const IMAGE = Layer.succeed(AgentImage, {
  reference: Effect.succeed("agent-image:fixture"),
  runner: Effect.succeed([]),
});

/** The prune's commands run straight on the test's own runtime. */
const run: SandboxRunner = (effect) => Effect.runPromise(effect);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("the daily workspace drive cleanup", (it) => {
  it.effect(
    "drops the folder and row of a repository no agent started in, and keeps a used one",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);

        // The agent starts in acme/api, as the shared builder writes it; no agent starts in acme/site.
        yield* openAgentOnOwnTask(owner, workspaceId);
        yield* recordWorkspaceDriveRepositories(
          workspaceId,
          ["acme/api", "acme/site"],
          new Date(1),
        );
        const memory = memorySandbox();

        const cleaned = yield* cleanWorkspaceDrives(run).pipe(
          Effect.provide(IMAGE),
          Effect.provideService(Sandbox, memory.service),
        );

        const kept = memory.state.commands.flatMap((command) => {
          const keep = command.ask.env?.[VARIABLE.KEEP];

          return keep === undefined ? [] : [keep];
        });

        assert.deepEqual(cleaned, { pruned: 1, dropped: 1, passed: 0, failed: 0 });
        assert.deepEqual(kept, ["acme/api"]);
        assert.deepEqual(yield* workspaceDriveRepositories(workspaceId), ["acme/api"]);
      }),
  );
});
