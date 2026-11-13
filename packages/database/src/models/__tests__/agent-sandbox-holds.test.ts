import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openTaskAgent, startTask } from "../../testing/index.js";
import {
  agentSandboxHeld,
  heldAgentSandboxes,
  keepAgentSandboxTerminals,
  recordAgentSandboxHeld,
  recordAgentSandboxTerminalEnded,
  recordAgentSandboxTerminalOpened,
} from "../agent-sandbox-holds.js";
import { recordAgentSandboxDiscarded, recordAgentSandboxOpen } from "../agent-sandboxes.js";

/**
 * What a member holds open in a cloud agent's sandbox, over a real dialect:
 * a Terminal tab holds it until its shell ends, a heartbeat holds it for two
 * minutes, and one sandbox's holds never hold another's. Synthetic accounts,
 * agents, and sandbox names throughout.
 */

const OPENED = new Date("2026-11-10T12:00:00Z");
const MINUTE_LATER = new Date("2026-11-10T12:01:00Z");
const MINUTES_LATER = new Date("2026-11-10T12:03:00Z");

/** A sandbox opened at `OPENED` for an agent of a new account; answers its name. */
const openSandbox = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });
  const agentId = yield* openTaskAgent(userId, task.workspaceId, task.id);
  const sandboxName = `agent-sandbox-${randomUUID()}`;
  yield* recordAgentSandboxOpen(agentId, {
    sandboxName,
    at: OPENED,
    writtenBefore: OPENED,
  });

  return sandboxName;
});

/** Whether the sweep at `at` reads the sandbox held. */
const swept = (sandboxName: string, at: Date) =>
  Effect.map(heldAgentSandboxes(at, 1000), (names) => names.includes(sandboxName));

it.layer(getTestDB())("what a member holds open in an agent's sandbox", (it) => {
  it.effect(
    "a Terminal tab holds its sandbox until its shell ends or a list leaves it out, and another account's sandbox is never held by it",
    () =>
      Effect.gen(function* () {
        const held = yield* openSandbox;
        const other = yield* openSandbox;
        assert.equal(yield* agentSandboxHeld(held, OPENED), false);

        const first = randomUUID();
        const second = randomUUID();
        yield* recordAgentSandboxTerminalOpened(held, first, OPENED);
        yield* recordAgentSandboxTerminalOpened(held, second, OPENED);
        assert.equal(yield* agentSandboxHeld(held, MINUTES_LATER), true, "a tab never lapses");
        assert.equal(yield* swept(held, MINUTES_LATER), true);
        assert.equal(yield* agentSandboxHeld(other, MINUTES_LATER), false);
        assert.equal(yield* swept(other, MINUTES_LATER), false);

        yield* recordAgentSandboxTerminalEnded(held, first);
        assert.equal(yield* agentSandboxHeld(held, MINUTES_LATER), true, "one tab still stands");

        // A list that no longer reads the second shell, which ended inside the sandbox.
        yield* keepAgentSandboxTerminals(held, [first]);
        assert.equal(yield* agentSandboxHeld(held, MINUTES_LATER), false);

        yield* recordAgentSandboxTerminalOpened(held, first, MINUTES_LATER);
        yield* recordAgentSandboxDiscarded(held);
        assert.equal(
          yield* agentSandboxHeld(held, MINUTES_LATER),
          false,
          "its shells went with it",
        );
        assert.equal(yield* swept(held, MINUTES_LATER), false);
      }),
  );

  it.effect(
    "a heartbeat holds its sandbox for two minutes, and another account's sandbox is never held by it",
    () =>
      Effect.gen(function* () {
        const held = yield* openSandbox;
        const other = yield* openSandbox;
        yield* recordAgentSandboxHeld(held, OPENED);

        assert.equal(yield* agentSandboxHeld(held, MINUTE_LATER), true);
        assert.equal(yield* swept(held, MINUTE_LATER), true);
        assert.equal(yield* agentSandboxHeld(other, MINUTE_LATER), false);
        assert.equal(yield* agentSandboxHeld(held, MINUTES_LATER), false, "the beats stopped");
        assert.equal(yield* swept(held, MINUTES_LATER), false);

        yield* recordAgentSandboxHeld(held, MINUTES_LATER);
        assert.equal(yield* agentSandboxHeld(held, MINUTES_LATER), true, "a beat holds it again");
      }),
  );
});
