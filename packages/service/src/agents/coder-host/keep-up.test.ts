/**
 * keep-up.test.ts -- the minute sweep's keep-alive over the test's own database and `Sandbox` kept in memory: a sandbox a member holds open is touched with no turn running in it, and one nobody holds is not. Synthetic accounts and sandbox names throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { recordAgentSandboxTerminalOpened } from "@repo/database/models/agent-sandbox-holds";
import { recordAgentSandboxOpen } from "@repo/database/models/agent-sandboxes";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "@repo/database/testing";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { keepRunningSandboxesUp } from "./reconcile.js";

const AT = new Date("2026-11-10T12:00:00Z");

/** A running sandbox opened for a new account's agent, with no turn in it; answers its name. */
const openSandbox = (memory: ReturnType<typeof memorySandbox>) =>
  Effect.gen(function* () {
    const owner = `user-${randomUUID()}`;
    yield* (yield* Database)
      .insert(user)
      .values({ id: owner, name: "Test User", email: `${owner}@app.test` });
    const agentId = yield* openAgentOnOwnTask(owner, yield* openWorkspace(owner));
    const sandboxName = `agent-sandbox-${randomUUID()}`;
    yield* recordAgentSandboxOpen(agentId, { sandboxName, at: AT, writtenBefore: AT });
    memory.stand({ name: sandboxName });

    return sandboxName;
  });

it.layer(getTestDB())("the minute sweep's keep-alive", (it) => {
  it.effect("a sandbox a member holds open is touched with no turn running in it", () =>
    Effect.gen(function* () {
      const memory = memorySandbox();
      const held = yield* openSandbox(memory);
      const idle = yield* openSandbox(memory);
      yield* recordAgentSandboxTerminalOpened(held, randomUUID(), AT);

      yield* keepRunningSandboxesUp(AT.getTime()).pipe(Effect.provide(memory.layer));

      const touched = memory.state.touched.map((touch) => touch.name);
      assert.ok(touched.includes(held));
      assert.ok(!touched.includes(idle));
    }),
  );
});
