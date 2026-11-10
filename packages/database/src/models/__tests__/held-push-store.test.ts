import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import {
  getTestDB,
  openAgentOnOwnTask,
  openInboxItem,
  openWorkspace,
} from "../../testing/index.js";
import { holdFailedTurnPush, holdThreadPush, takeAbsentHolds } from "../held-push-store.js";
import { stampPresence } from "../presence-store.js";

/**
 * Pushes held while a member was at their desk, over a real dialect: holding
 * a thread or an agent again keeps one hold, the newer turn standing for an
 * agent, and the sweep takes only the holds of members last active before
 * the instant it names, each once. Synthetic accounts throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("the held push store", (it) => {
  it.effect(
    "one hold per thread and per agent, taken once its member was last active before the sweep's instant",
    () =>
      Effect.gen(function* () {
        const away = yield* openAccount;
        const present = yield* openAccount;
        const workspace = yield* openWorkspace(away);
        const agentId = yield* openAgentOnOwnTask(away, workspace);
        const itemId = yield* openInboxItem(away, workspace, null, agentId, true);
        const otherWorkspace = yield* openWorkspace(present);
        const otherAgent = yield* openAgentOnOwnTask(present, otherWorkspace);
        const otherItem = yield* openInboxItem(present, otherWorkspace, null, otherAgent, true);

        yield* stampPresence(away);
        yield* holdThreadPush(away, itemId);
        yield* holdThreadPush(away, itemId);
        yield* holdFailedTurnPush(away, agentId, "turn-1");
        yield* holdFailedTurnPush(away, agentId, "turn-2");
        yield* holdThreadPush(present, otherItem);

        yield* TestClock.adjust("3 minutes");
        yield* stampPresence(present);
        const activeSince = new Date((yield* Clock.currentTimeMillis) - 2 * 60_000);

        const taken = yield* takeAbsentHolds(activeSince, 10);
        assert.deepEqual(
          [...taken].sort((a, b) => String(a.turnId).localeCompare(String(b.turnId))),
          [
            { userId: away, inboxItemId: null, agentId, turnId: "turn-2" },
            { userId: away, inboxItemId: itemId, agentId: null, turnId: null },
          ].sort((a, b) => String(a.turnId).localeCompare(String(b.turnId))),
        );
        assert.deepEqual(yield* takeAbsentHolds(activeSince, 10), []);
      }),
  );
});
