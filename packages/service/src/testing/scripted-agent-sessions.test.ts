import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openTaskAgent, startTask } from "@repo/database/testing";
import { INBOX_STATUS, openAskOf } from "@repo/features/inbox-wire";
import { TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { NativeAgentSessions } from "../agents/coder-host/runtime-sessions.js";
import { SESSION_SEND_OUTCOME, SESSION_TURN } from "../agents/sessions/agent-sessions.js";
import { agentInboxItemOfKey } from "../inbox/inbox-store.js";
import { E2E_AGENT_SCRIPTS, scriptedAgentSessionsLayer } from "./scripted-agent-sessions.js";

/**
 * The scripted harness an end-to-end journey starts its agents on, over a
 * real dialect: a Start's message holding the ask script's cue plays a turn
 * that ends with an ask standing open for the agent's starter, which is
 * what the Inbox and the agent's page draw. Synthetic accounts throughout.
 */

it.layer(getTestDB())("the scripted agent sessions", (it) => {
  it.effect(
    "play the ask script's first turn to its end, leaving its ask open for the starter",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: owner, name: "Ada Lovelace", email: `${owner}@app.test` });
        const task = yield* startTask(owner, { name: "Button color", repository: "acme/relay" });
        const agentId = yield* openTaskAgent(owner, task.workspaceId, task.id);
        const [agent] = yield* db.select().from(agentTable).where(eq(agentTable.id, agentId));
        assert.ok(agent !== undefined);

        const harness = yield* Effect.provide(
          NativeAgentSessions,
          scriptedAgentSessionsLayer(E2E_AGENT_SCRIPTS),
        );

        const sessions = yield* Option.getOrThrow(
          harness.sessions(CONVERSATION_RUNTIME.CLAUDE_CODE, owner),
        );

        const opened = yield* sessions.open({
          conversationId: agent.conversationId,
          turn: SESSION_TURN.TYPED,
          message: "Pick the button's color. [script:ask]",
        });

        assert.equal(opened.outcome, SESSION_SEND_OUTCOME.ACCEPTED);
        yield* TestClock.adjust(Duration.minutes(1));

        const played = yield* db
          .select({ status: turns.status })
          .from(turns)
          .where(eq(turns.conversationId, agent.conversationId));

        assert.deepEqual(played, [{ status: TURN_STATUS.SETTLED }]);

        const item = Option.getOrThrow(
          yield* agentInboxItemOfKey({ userId: owner, agentId }, "e2e-color"),
        );

        assert.equal(item.status, INBOX_STATUS.OPEN);
        assert.equal(item.waitsOn?.userId, owner);
        assert.ok(openAskOf(item.thread ?? []) !== undefined);
      }),
  );
});
