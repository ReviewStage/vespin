/**
 * base-drive-refresh.test.ts -- the daily refresh, over the test's own database, a GitHub that answers from the test's own installations, and `Sandbox` kept in memory: each connected workspace's drive filled, and a fill that failed logged and passed by while the next is filled. Synthetic accounts throughout.
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
import { refreshBaseDrives } from "./base-drive-refresh.js";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import { workspaceDriveName } from "./workspace-drive.js";

const ACME = { id: 7101, login: "acme", repositories: [{ owner: "acme", name: "relay" }] };
const GLOBEX = { id: 7102, login: "globex", repositories: [{ owner: "globex", name: "beacon" }] };

const IMAGE = Layer.succeed(AgentImage, {
  reference: Effect.succeed("agent-image:fixture"),
  runner: Effect.succeed([]),
});

/** The fill's checkout run straight on the test's own runtime. */
const run: SandboxRunner = (effect) => Effect.runPromise(effect);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("the daily refresh", (it) => {
  it.effect("fills each connected workspace's drive and goes on past a fill that failed", () =>
    Effect.gen(function* () {
      const acme = yield* openWorkspace(yield* openAccount);
      const globex = yield* openWorkspace(yield* openAccount);
      yield* connectWorkspaceGitHub(acme, ACME);
      yield* connectWorkspaceGitHub(globex, GLOBEX);
      const filled = workspaceDriveName(acme);
      const broken = workspaceDriveName(globex);
      // Globex's fill fails as its sandbox is created; acme's goes through.
      const memory = memorySandbox({
        fail: (call, name) =>
          call === SANDBOX_CALL.CREATE && name === broken
            ? new SandboxUnavailable({ call })
            : undefined,
      });

      const refreshed = yield* refreshBaseDrives(run).pipe(
        Effect.provide(Layer.mergeAll(IMAGE, githubReaching([ACME, GLOBEX]).layer)),
        Effect.provideService(Sandbox, memory.service),
      );

      assert.deepEqual(refreshed, { filled: 1, passed: 0, failed: 1 });
      assert.deepEqual(memory.state.deleted, [filled]);
      assert.ok(memory.state.drives.has(filled));
    }),
  );
});
