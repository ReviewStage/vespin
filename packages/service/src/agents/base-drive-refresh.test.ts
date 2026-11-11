/**
 * base-drive-refresh.test.ts -- the hourly base drive refresh, over the test's own database, a GitHub that answers from the test's own installation, and `Sandbox` kept in memory: a drive filled for each connected repository that has none, though no agent was ever started on it, a drive that stands passed by but on the refill run, and a fill that failed logged and passed by while the rest go on. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { SANDBOX_CALL, Sandbox, SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect, Layer } from "effect";
import { connectWorkspaceGitHub, githubReaching } from "../testing/github-app-fake.js";
import { baseDriveName } from "./base-drive.js";
import { refreshBaseDrives } from "./base-drive-refresh.js";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";

/** The installation each case connects its own workspace to, under an id of its own, since one installation stands for one workspace. */
const installationOf = (id: number) => ({
  id,
  login: "acme",
  repositories: [
    { owner: "acme", name: "relay" },
    { owner: "acme", name: "ledger" },
    { owner: "acme", name: "beacon" },
  ],
});

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

it.layer(getTestDB())("the hourly base drive refresh", (it) => {
  /** The refresh run over a workspace connected to the installation, relay's drive standing and beacon's fill failing at its create. */
  const refreshed = (installationId: number, refillStanding: boolean) =>
    Effect.gen(function* () {
      const installation = installationOf(installationId);
      const owner = yield* openAccount;
      const workspaceId = yield* openWorkspace(owner);
      yield* connectWorkspaceGitHub(workspaceId, installation);
      const nameOf = (fullName: string) => baseDriveName({ workspaceId, fullName });
      const relay = nameOf("acme/relay");
      const ledger = nameOf("acme/ledger");
      const beacon = nameOf("acme/beacon");
      const memory = memorySandbox({
        fail: (call, name) =>
          call === SANDBOX_CALL.CREATE && name === beacon
            ? new SandboxUnavailable({ call })
            : undefined,
      });
      memory.state.drives.set(relay, { name: relay, forkedFrom: undefined });
      const counts = yield* refreshBaseDrives(run, refillStanding).pipe(
        Effect.provide(Layer.mergeAll(IMAGE, githubReaching([installation]).layer)),
        Effect.provideService(Sandbox, memory.service),
      );
      return { counts, memory, relay, ledger };
    });

  it.effect(
    "fills a drive for each connected repository that has none, passes by one that stands, and goes on past a fill that failed",
    () =>
      Effect.gen(function* () {
        const { counts, memory, relay, ledger } = yield* refreshed(7101, false);

        assert.deepEqual(counts, { filled: 1, refilled: 0, passed: 1, failed: 1 });
        assert.deepEqual(memory.state.deleted, [ledger]);
        assert.deepEqual([...memory.state.drives.keys()].toSorted(), [relay, ledger].toSorted());
      }),
  );

  it.effect("refills a drive that stands on the refill run", () =>
    Effect.gen(function* () {
      const { counts, memory, relay, ledger } = yield* refreshed(7102, true);

      assert.deepEqual(counts, { filled: 1, refilled: 1, passed: 0, failed: 1 });
      assert.deepEqual(memory.state.deleted.toSorted(), [relay, ledger].toSorted());
    }),
  );
});
