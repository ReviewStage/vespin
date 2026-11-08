import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { listPortShares } from "@repo/database/models/sandbox-port-shares";
import { getTestDB } from "@repo/database/testing";
import { Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Duration, Effect } from "effect";
import { agentSandboxName } from "../agents/agent-sandbox-open.js";
import { PORT_SHARE, sharePort } from "../agents/terminal/port-share.js";
import { sweepPortShares } from "./port-share-sweep.js";

/**
 * The sweep finds a share by the row sharing kept, never a mark on the
 * sandbox: a share no one visited past the idle bound is closed and listed
 * no more. The memory sandbox runs no helper, so its folder holds no visit.
 *
 * Synthetic sessions throughout.
 */

it.layer(getTestDB())("the shared ports' sweep", (it) => {
  it.effect("a share no one visited past the idle bound is closed and listed no more", () =>
    Effect.gen(function* () {
      const memory = memorySandbox();
      const sessionId = `wrun_${randomUUID()}`;
      const standing = memory.stand({ name: agentSandboxName(sessionId) });
      const running = { name: standing.name, running: standing.running };
      yield* sharePort(memory.service, sessionId, { name: standing.name }, running, 3000);

      const closed = yield* Effect.provideService(
        sweepPortShares(new Date(Duration.toMillis(PORT_SHARE.IDLE))),
        Sandbox,
        memory.service,
      );

      const listed = yield* listPortShares();
      assert.equal(closed, 1);
      assert.deepEqual(standing.routes, []);
      assert.equal(
        listed.some((share) => share.sessionId === sessionId),
        false,
      );
    }),
  );
});
