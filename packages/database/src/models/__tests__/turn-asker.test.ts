import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openRunningTurn,
  openWorkspace,
} from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { turnAsker } from "../turn-asker.js";

/**
 * Who asked for an agent's turn under way, read through `turnAsker` over a
 * real dialect: the member whose line opened the newest turn, never one who
 * steered it after; the starter where an automation opened it or its opener
 * has since left the workspace; and nothing of the conversation for another
 * account.
 *
 * Synthetic accounts, workspaces, and agents throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** Charles's workspace with Dean a member of it, a Manager Charles started there, and Mallory, outside it. */
const openManager = Effect.gen(function* () {
  const charles = yield* openAccount;
  const dean = yield* openAccount;
  const mallory = yield* openAccount;
  const workspace = yield* openWorkspace(charles);
  yield* joinWorkspace(workspace, dean);

  const started = yield* createAgent(charles, {
    taskId: null,
    workspaceId: workspace,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: null,
    descriptionSnapshot: null,
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    kind: AGENT_KIND.MANAGER,
  });

  const { conversationId } = Option.getOrThrow(started).agent;

  return { charles, dean, mallory, workspace, target: { userId: charles, conversationId } };
});

it.layer(getTestDB())("who asked for an agent's turn", (it) => {
  it.effect("the member whose line opened the newest turn asks, not one who steered it after", () =>
    Effect.gen(function* () {
      const { charles, dean, mallory, target } = yield* openManager;
      yield* openRunningTurn(target, [{ member: charles }]);
      yield* openRunningTurn(target, [{ member: dean }, { member: charles }]);

      assert.equal(yield* turnAsker(target), dean);
      assert.equal(
        yield* turnAsker({ userId: mallory, conversationId: target.conversationId }),
        mallory,
        "another account reads no one's ask in the conversation",
      );
    }),
  );

  it.effect(
    "the starter stands in where an automation opened the turn, or its opener has left the workspace",
    () =>
      Effect.gen(function* () {
        const { charles, dean, workspace, target } = yield* openManager;
        yield* openRunningTurn(target, [{ automation: "Nightly triage" }, { member: dean }]);
        const automation = yield* turnAsker(target);
        yield* openRunningTurn(target, [{ member: dean }]);
        yield* leaveWorkspace(workspace, dean);
        const left = yield* turnAsker(target);

        assert.equal(automation, charles);
        assert.equal(left, charles);
      }),
  );
});
