import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  APPROVAL_SETTLED_BY,
  APPROVAL_STATUS,
  type ApprovalStatus,
} from "@repo/features/agent-approval-wire";
import { RUN_EVENT, RUN_STATUS, RUN_TURN_ORIGIN, TURN_TRIGGER } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentApproval } from "../../schemas/agent-approval.js";
import { user } from "../../schemas/auth.js";
import { turns } from "../../schemas/storage.js";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  answerApproval,
  listPendingApprovals,
  readApproval,
  recordApprovalAsked,
  releaseApprovalClaim,
  settleApprovalByRunner,
} from "../agent-approvals.js";
import { createAgent } from "../agent-store.js";
import { createTask } from "../task-store.js";
import { type ConversationTarget, storeWriter } from "../writer.js";

/**
 * A coding agent's asks, over a real dialect: an ask lands once under its
 * running turn, is settled once, by a member's answer or its runner's word,
 * and expires as its turn ends; and a member who does not see the agent
 * neither reads nor answers its asks. Synthetic accounts, agents, and calls
 * throughout; the test clock starts at the epoch.
 */

/** A new account, answering its id. */
const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );

  return id;
});

/**
 * A starter's coding agent on a task of a workspace a teammate shares, with
 * a turn running, and an outsider in a workspace of their own.
 */
const openRunningAgent = Effect.gen(function* () {
  const [starter, teammate, outsider] = [
    yield* openAccount,
    yield* openAccount,
    yield* openAccount,
  ];

  const workspace = yield* openWorkspace(starter);
  yield* joinWorkspace(workspace, teammate);
  yield* openWorkspace(outsider);
  const task = yield* createTask(starter, { organizationId: workspace, name: "Checkout" });

  const started = yield* createAgent(starter, {
    taskId: task.id,
    descriptionSnapshot: "# Checkout",
    prompt: null,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/shop",
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  const { agent } = Option.getOrThrow(started);
  const target: ConversationTarget = { userId: starter, conversationId: agent.conversationId };
  const writer = yield* storeWriter({ tools: {} });
  yield* writer.writeAwaitingLine(
    target,
    { text: "Fix the checkout.", clientKey: "first", sender: { kind: MESSAGE_SENDER.APP } },
    Effect.succeed(true),
  );

  const [turn] = yield* Database.use((db) =>
    db.select({ id: turns.id }).from(turns).where(eq(turns.conversationId, agent.conversationId)),
  );

  assert.ok(turn !== undefined);
  yield* writer.consume(target, {
    kind: RUN_EVENT.TURN_STARTED,
    conversationId: sessionKey(agent.conversationId),
    turnId: turn.id,
    sequence: 1,
    origin: RUN_TURN_ORIGIN.TYPED,
    trigger: TURN_TRIGGER.ASK,
    at: yield* Clock.currentTimeMillis,
    attempt: 0,
  });

  return { starter, teammate, outsider, agent, target, turnId: turn.id };
});

/** A call of the agent's held for a member's answer, under the turn named, by the CLI's id given. */
const asked = (conversationId: string, turnId: string, requestId: string) =>
  Effect.gen(function* () {
    return yield* recordApprovalAsked({
      conversationId,
      turnId,
      requestId,
      toolUseId: `toolu_${requestId}`,
      subagentId: null,
      toolName: "Bash",
      title: "Run pnpm test?",
      description: null,
      input: { command: "pnpm test" },
      commandPrefix: null,
      at: new Date(yield* Clock.currentTimeMillis),
    });
  });

/** How each of the conversation's asks stands, by the CLI's id, and what settled it. */
const standingOf = (conversationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({
          requestId: agentApproval.requestId,
          status: agentApproval.status,
          settledBy: agentApproval.settledBy,
        })
        .from(agentApproval)
        .where(eq(agentApproval.conversationId, conversationId))
        .orderBy(asc(agentApproval.requestId)),
    ),
    (rows) => rows.map((row) => [row.requestId, row.status, row.settledBy] as const),
  );

it.layer(getTestDB())("a coding agent's asks", (it) => {
  it.effect(
    "an ask lands once, its runner's word settles it, and its turn's end expires what it left pending",
    () =>
      Effect.gen(function* () {
        const { agent, target, turnId } = yield* openRunningAgent;
        assert.equal(yield* asked(agent.conversationId, turnId, "a"), true);
        assert.equal(yield* asked(agent.conversationId, turnId, "a"), false, "posted again");
        yield* asked(agent.conversationId, turnId, "b");
        yield* settleApprovalByRunner({
          conversationId: agent.conversationId,
          requestId: "a",
          status: APPROVAL_STATUS.DENIED,
          settledBy: APPROVAL_SETTLED_BY.MESSAGE,
          at: new Date(yield* Clock.currentTimeMillis),
        });
        const writer = yield* storeWriter({ tools: {} });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(agent.conversationId),
          turnId,
          sequence: 2,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: yield* Clock.currentTimeMillis,
          attempt: 0,
        });

        assert.deepEqual(yield* standingOf(agent.conversationId), [
          ["a", APPROVAL_STATUS.DENIED, APPROVAL_SETTLED_BY.MESSAGE],
          ["b", APPROVAL_STATUS.EXPIRED, APPROVAL_SETTLED_BY.ENDED],
        ]);
      }),
  );

  it.effect(
    "a teammate's answer settles a pending ask once, and the runner's word of the answer it took stands over it",
    () =>
      Effect.gen(function* () {
        const { agent, teammate, turnId } = yield* openRunningAgent;
        yield* asked(agent.conversationId, turnId, "a");
        const [pending] = yield* listPendingApprovals(teammate, agent.id);
        assert.ok(pending !== undefined);

        const answer = (status: ApprovalStatus) =>
          Effect.gen(function* () {
            return yield* answerApproval({
              userId: teammate,
              agentId: agent.id,
              approvalId: pending.id,
              status,
              at: new Date(yield* Clock.currentTimeMillis),
            });
          });

        const first = yield* answer(APPROVAL_STATUS.ALLOWED);
        const second = yield* answer(APPROVAL_STATUS.DENIED);
        assert.equal(Option.getOrThrow(first).decidedByUserId, teammate);
        assert.ok(Option.isNone(second), "an ask already answered takes no second answer");
        assert.deepEqual(yield* listPendingApprovals(teammate, agent.id), []);

        yield* settleApprovalByRunner({
          conversationId: agent.conversationId,
          requestId: "a",
          status: APPROVAL_STATUS.ALLOWED_FOR_AGENT,
          settledBy: APPROVAL_SETTLED_BY.MEMBER,
          at: new Date(yield* Clock.currentTimeMillis),
        });
        const read = Option.getOrThrow(yield* readApproval(teammate, agent.id, pending.id));
        assert.equal(read.status, APPROVAL_STATUS.ALLOWED_FOR_AGENT);
        assert.equal(read.decidedByUserId, teammate);
      }),
  );

  it.effect(
    "a claim the runner confirmed stays settled when its delivery reports failure late",
    () =>
      Effect.gen(function* () {
        const { agent, teammate, turnId } = yield* openRunningAgent;
        yield* asked(agent.conversationId, turnId, "a");
        const [pending] = yield* listPendingApprovals(teammate, agent.id);
        assert.ok(pending !== undefined);
        const at = new Date(yield* Clock.currentTimeMillis);
        yield* answerApproval({
          userId: teammate,
          agentId: agent.id,
          approvalId: pending.id,
          status: APPROVAL_STATUS.ALLOWED,
          at,
        });
        yield* settleApprovalByRunner({
          conversationId: agent.conversationId,
          requestId: "a",
          status: APPROVAL_STATUS.ALLOWED,
          settledBy: APPROVAL_SETTLED_BY.MEMBER,
          at,
        });

        const released = yield* releaseApprovalClaim({
          agentId: agent.id,
          approvalId: pending.id,
          userId: teammate,
          to: APPROVAL_STATUS.PENDING,
          at,
        });

        assert.ok(
          Option.isNone(released),
          "an answer the runner took is no longer the member's claim",
        );
        assert.deepEqual(yield* standingOf(agent.conversationId), [
          ["a", APPROVAL_STATUS.ALLOWED, APPROVAL_SETTLED_BY.MEMBER],
        ]);
      }),
  );

  it.effect(
    "a member's settle that lands after the runner's word of their answer records them as who decided, the runner's answer standing",
    () =>
      Effect.gen(function* () {
        const { agent, starter, turnId } = yield* openRunningAgent;
        yield* asked(agent.conversationId, turnId, "a");
        const [pending] = yield* listPendingApprovals(starter, agent.id);
        assert.ok(pending !== undefined);
        const at = new Date(yield* Clock.currentTimeMillis);
        yield* settleApprovalByRunner({
          conversationId: agent.conversationId,
          requestId: "a",
          status: APPROVAL_STATUS.ALLOWED_FOR_AGENT,
          settledBy: APPROVAL_SETTLED_BY.MEMBER,
          at,
        });

        const answered = yield* answerApproval({
          userId: starter,
          agentId: agent.id,
          approvalId: pending.id,
          status: APPROVAL_STATUS.ALLOWED,
          at,
        });

        const row = Option.getOrThrow(answered);
        assert.deepEqual(
          [row.status, row.settledBy, row.decidedByUserId],
          [APPROVAL_STATUS.ALLOWED_FOR_AGENT, APPROVAL_SETTLED_BY.MEMBER, starter],
        );
      }),
  );

  it.effect("a member of another workspace neither reads nor answers an agent's ask", () =>
    Effect.gen(function* () {
      const { agent, outsider, starter, turnId } = yield* openRunningAgent;
      yield* asked(agent.conversationId, turnId, "a");
      const [pending] = yield* listPendingApprovals(starter, agent.id);
      assert.ok(pending !== undefined);

      assert.deepEqual(yield* listPendingApprovals(outsider, agent.id), []);
      assert.ok(Option.isNone(yield* readApproval(outsider, agent.id, pending.id)));

      const answered = yield* answerApproval({
        userId: outsider,
        agentId: agent.id,
        approvalId: pending.id,
        status: APPROVAL_STATUS.ALLOWED,
        at: new Date(yield* Clock.currentTimeMillis),
      });

      assert.ok(Option.isNone(answered));
      assert.deepEqual(yield* standingOf(agent.conversationId), [
        ["a", APPROVAL_STATUS.PENDING, null],
      ]);
    }),
  );
});
