import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { APPROVAL_DECISION, INPUT_LINE } from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { listPendingApprovals, recordApprovalAsked } from "@repo/database/models/agent-approvals";
import { agentTable } from "@repo/database/schemas/agent";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace } from "@repo/database/testing";
import { HOSTED_API_ERROR } from "@repo/features";
import {
  AGENT_PERMISSION_MODE,
  APPROVAL_ANSWER,
  APPROVAL_STATUS,
  approvalAnswerAnswerSchema,
  PERMISSION_MODE_APPLIES,
} from "@repo/features/agent-approval-wire";
import { AGENT_MACHINE, agentAnswerSchema } from "@repo/features/agent-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer } from "effect";
import { RUN_EVENT, RUN_STATUS, sessionKey } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  AGENT,
  fakeAgentSessions,
  messagedAgent,
  openTask,
  readAnswer,
  refusal,
  request,
  startAs,
} from "../testing/agents-app-support.js";
import { RUNNER_ANSWER, type RunnerAnswer } from "./coder-host/runtime-sessions.js";

/**
 * An agent's permission mode and the asks its runner holds, over the hosted
 * router: a mode is set by a member who controls a Claude Code agent and
 * reaches it from its next turn; an answer is written to the agent's runner
 * and settles its ask, by a member who controls the agent alone; and an ask
 * that no longer waits is refused with how it stands, writing nothing. A
 * new Claude Code agent starts on its starter's Default permissions.
 * Synthetic accounts, agents, and calls throughout; the store is PGlite.
 */

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/** Where a member answers one ask of an agent. */
const approvalPath = (approvalId: string) => `/api/agents/{id}/approvals/${approvalId}`;

/** A call of the agent's held for a member's answer under its running turn, by the CLI's id given, answering the ask's own id. */
const asked = (started: Effect.Success<ReturnType<typeof messagedAgent>>, requestId: string) =>
  Effect.gen(function* () {
    yield* recordApprovalAsked({
      conversationId: started.target.conversationId,
      turnId: started.turnId,
      requestId,
      toolUseId: `toolu_${requestId}`,
      subagentId: null,
      toolName: "Bash",
      title: "Run git push --force?",
      description: null,
      input: { command: "git push --force" },
      at: new Date(yield* Clock.currentTimeMillis),
    });
    const pending = yield* listPendingApprovals(started.owner, started.agent.id);
    const ask = pending.find((each) => each.requestId === requestId);
    assert.ok(ask !== undefined);
    return ask.id;
  });

/** The agent kept to its starter: on the starter's own Mac, which only its starter drives, though every member sees it. */
const keptToStarter = (agentId: string) =>
  Database.use((db) =>
    db.update(agentTable).set({ machine: AGENT_MACHINE.DEVICE }).where(eq(agentTable.id, agentId)),
  );

it.layer(SUITE)("an agent's permission mode and its asks", (it) => {
  it.effect(
    "a mode that asks takes on a Claude Code agent from its next turn, and is refused for a Codex agent and a member who does not control the agent",
    () =>
      Effect.gen(function* () {
        const started = yield* messagedAgent(fakeAgentSessions(), undefined);
        const { agent, ask, other, owner, task } = started;
        const changed = (as: string, permissionMode: string) =>
          ask(request(AGENT, as, { method: "PATCH", id: agent.id, body: { permissionMode } }));

        const taken = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* changed(owner, AGENT_PERMISSION_MODE.ASK),
        );
        yield* joinWorkspace(task.workspaceId, other);
        yield* keptToStarter(agent.id);
        const teammate = yield* changed(other, AGENT_PERMISSION_MODE.AUTO);
        yield* Database.use((db) =>
          db
            .update(conversations)
            .set({ runtime: CONVERSATION_RUNTIME.CODEX })
            .where(eq(conversations.id, started.target.conversationId)),
        );
        const onCodex = yield* changed(owner, AGENT_PERMISSION_MODE.AUTO);
        const backToFull = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* changed(owner, AGENT_PERMISSION_MODE.FULL_ACCESS),
        );

        assert.equal(taken.agent.permissionMode, AGENT_PERMISSION_MODE.ASK);
        assert.equal(taken.permissionModeApplies, PERMISSION_MODE_APPLIES.NEXT_TURN);
        assert.deepEqual(
          teammate,
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(
          onCodex,
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.PERMISSION_MODE_REFUSED),
        );
        // Full access is any harness's, and is said by saying nothing.
        assert.equal(backToFull.agent.permissionMode, undefined);
      }),
  );

  it.effect(
    "a member's Default permissions is the mode their new Claude Code agent starts on",
    () =>
      Effect.gen(function* () {
        const opened = yield* openTask({ agentSessions: fakeAgentSessions() });
        const start = () =>
          opened.ask(startAs(opened.owner, opened.task.id, { idempotencyKey: randomUUID() }));
        const before = readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, yield* start());
        yield* writeAccountPreferences(opened.owner, {
          agentPermissionMode: AGENT_PERMISSION_MODE.ASK,
        });
        const after = readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, yield* start());

        // Full access is the default, and is said by saying nothing.
        assert.equal(before.agent.permissionMode, undefined);
        assert.equal(after.agent.permissionMode, AGENT_PERMISSION_MODE.ASK);
      }),
  );

  it.effect(
    "an answer is written to the agent's runner and settles its ask, and an ask answered or expired since is refused with how it stands, writing nothing",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const started = yield* messagedAgent(agentSessions, { running: true });
        const { agent, ask, owner } = started;
        const denied = yield* asked(started, "request-1");
        const left = yield* asked(started, "request-2");
        const answer = (approvalId: string) =>
          ask(
            request(approvalPath(approvalId), owner, {
              method: "POST",
              id: agent.id,
              body: { answer: APPROVAL_ANSWER.DENY, message: "Not on main." },
            }),
          );

        const answered = readAnswer(
          approvalAnswerAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* answer(denied),
        );
        const again = yield* answer(denied);
        // The turn ends with the second ask still pending, which expires with it.
        yield* started.writer.consume(started.target, {
          kind: RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(started.target.conversationId),
          turnId: started.turnId,
          sequence: 9,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: yield* Clock.currentTimeMillis,
        });
        const expired = yield* answer(left);

        assert.deepEqual(answered.approval, { id: denied, status: APPROVAL_STATUS.DENIED });
        assert.deepEqual(
          agentSessions.answered.map(([, line]) => line),
          [
            {
              type: INPUT_LINE.APPROVAL,
              requestId: "request-1",
              decision: APPROVAL_DECISION.DENY,
              message: "Not on main.",
            },
          ],
          "only the pending ask's answer reached the runner",
        );
        assert.deepEqual(again, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: {
            error: HOSTED_API_ERROR.APPROVAL_SETTLED,
            approvalStatus: APPROVAL_STATUS.DENIED,
          },
        });
        assert.deepEqual(expired, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: {
            error: HOSTED_API_ERROR.APPROVAL_SETTLED,
            approvalStatus: APPROVAL_STATUS.EXPIRED,
          },
        });
      }),
  );

  it.effect(
    "an answer whose line no runner took hands its claim back: pending again where the runner was out of reach, expired where none runs",
    () =>
      Effect.gen(function* () {
        const outcomes = (answers: RunnerAnswer) =>
          Effect.gen(function* () {
            const started = yield* messagedAgent(fakeAgentSessions({ answers }), {
              running: true,
            });
            const approvalId = yield* asked(started, "request-1");
            const answered = yield* started.ask(
              request(approvalPath(approvalId), started.owner, {
                method: "POST",
                id: started.agent.id,
                body: { answer: APPROVAL_ANSWER.ALLOW },
              }),
            );
            const standing = yield* listPendingApprovals(started.owner, started.agent.id);
            return { answered, pending: standing.map((each) => each.decidedByUserId) };
          });

        const unreached = yield* outcomes(RUNNER_ANSWER.FAILED);
        const gone = yield* outcomes(RUNNER_ANSWER.NOT_LIVE);

        assert.deepEqual(unreached, {
          answered: refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
          pending: [null],
        });
        assert.deepEqual(gone, {
          answered: {
            status: HOSTED_HTTP_STATUS.CONFLICT,
            body: {
              error: HOSTED_API_ERROR.APPROVAL_SETTLED,
              approvalStatus: APPROVAL_STATUS.EXPIRED,
            },
          },
          pending: [],
        });
      }),
  );

  it.effect(
    "a member outside the agent's workspace does not find its ask, and a teammate who does not control the agent may not answer it",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const started = yield* messagedAgent(agentSessions, { running: true });
        const { agent, ask, other, owner, task } = started;
        const approvalId = yield* asked(started, "request-1");
        const answer = () =>
          ask(
            request(approvalPath(approvalId), other, {
              method: "POST",
              id: agent.id,
              body: { answer: APPROVAL_ANSWER.ALLOW },
            }),
          );

        const outside = yield* answer();
        yield* joinWorkspace(task.workspaceId, other);
        yield* keptToStarter(agent.id);
        const teammate = yield* answer();

        assert.deepEqual(
          outside,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          teammate,
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(agentSessions.answered, []);
        assert.equal((yield* listPendingApprovals(owner, agent.id)).length, 1);
      }),
  );
});
