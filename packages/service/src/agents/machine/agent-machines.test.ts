/**
 * agent-machines.test.ts -- the machines behind one over a real dialect: an agent on a machine its workspace owns refused by name, never laid out on a cloud sandbox.
 *
 * Synthetic accounts, workspaces, and agents throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import {
  connectWorkspaceMachine,
  getTestDB,
  openAgentOnOwnTask,
  openWorkspace,
} from "@repo/database/testing";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Result } from "effect";
import { NO_GITHUB } from "../../testing/github-app-fake.js";
import { AgentMachine, LaunchRefused } from "./agent-machine.js";
import { agentMachinesLayer } from "./agent-machines.js";

it.layer(Layer.mergeAll(getTestDB(), NO_GITHUB, memorySandbox().layer))("the machines", (it) => {
  it.effect(
    "an agent on a machine its workspace owns is refused, never laid out in a sandbox",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const userId = "user-workspace-machine-owner";
        yield* db
          .insert(user)
          .values({ id: userId, name: "Test User", email: `${userId}@app.test` });
        const workspaceId = yield* openWorkspace(userId);
        const box = yield* connectWorkspaceMachine(workspaceId, userId);
        const agentId = yield* openAgentOnOwnTask(userId, workspaceId);

        yield* db
          .update(agentTable)
          .set({ machine: AGENT_MACHINE.WORKSPACE, deviceId: box })
          .where(eq(agentTable.id, agentId));

        const agent = Option.getOrThrow(yield* readAgent(userId, agentId));

        const laidOut = yield* Effect.gen(function* () {
          return yield* (yield* AgentMachine).layout(agent);
        }).pipe(
          Effect.provide(
            agentMachinesLayer({ run: () => assert.fail("a workspace's agent runs no checkout") }),
          ),
          Effect.result,
        );

        assert.ok(Result.isFailure(laidOut));
        assert.ok(laidOut.failure instanceof LaunchRefused);
        assert.equal(laidOut.failure.workspaceMachinesPending, true);
      }),
  );
});
