import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it, test } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { archiveAgent, createAgent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { createTask } from "@repo/database/models/task-store";
import { SettledTurnListener } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { AGENT_PAYER, agentMessageReplyLine } from "@repo/features/agent-wire";
import { RUN_STATUS, TURN_FAILURE } from "@repo/features/turn-run";
import { memorySandbox } from "@repo/sandbox/testing";
import { TURN_STATUS } from "@repo/wire";
import type { StoredUIMessage } from "@repo/wire/ui-messages";
import { Effect, Layer, Option } from "effect";
import { connectAgentApiKeys } from "../../testing/agent-credentials.js";
import { endedAt } from "../../testing/agent-turns.js";
import { githubReaching } from "../../testing/github-app-fake.js";
import { recordingSessions, sentTo } from "../../testing/recording-sessions.js";
import { lastSaid, reportToStarter } from "./starter-report.js";

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * A started agent's final message handed to its starter as the store writer
 * settles its turn, where the starter, which takes a turn only when a
 * message reaches it, would otherwise wait on a report that never comes.
 * Over a real dialect, the agents' sessions a recording fake, the writer told
 * to hand each settled turn here as the deployment's listener does.
 * Synthetic accounts and agents.
 */

const T0 = new Date("2026-10-28T12:00:00Z").getTime();

const REPORT = "Opened the pull request; the checks are green and auto-merge is armed.";

/** A member of a fresh workspace, their orchestrating agent with its session recorded, and an agent it started, both on Claude Code. */
const openStarted = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const member = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: member, name: "Test User", email: `${member}@app.test` });
    yield* connectAgentApiKeys(member);
    const organizationId = yield* openWorkspace(member);
    const task = yield* createTask(member, { organizationId });
    const start = { taskId: task.id, descriptionSnapshot: null, repository: null };

    const choice = {
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      payer: AGENT_PAYER.API_KEY,
    };

    const starter = Option.getOrThrow(
      yield* createAgent(member, {
        ...start,
        prompt: "Orchestrate the rollout.",
        idempotencyKey: randomUUID(),
        ...choice,
      }),
    ).agent;

    const agent = Option.getOrThrow(
      yield* createAgent(member, {
        ...start,
        prompt: "Record the starter.",
        title: "Record the starter",
        idempotencyKey: randomUUID(),
        startedByAgentId: starter.id,
        ...choice,
      }),
    ).agent;

    const sessionId = `wrun_${randomUUID()}`;
    yield* claimRuntimeSession(
      { userId: member, conversationId: starter.conversationId },
      sessionId,
      new Date(T0 - 60_000),
    );

    return { member, starter, agent, sessionId };
  });

/** The writer told to hand each turn it settles to the agent's starter over the sessions given, as the deployment's listener does. */
const reporting = (agentSessions: ReturnType<typeof recordingSessions>) =>
  Layer.succeed(SettledTurnListener, {
    heard: (turn) =>
      reportToStarter(agentSessions.sessionsFor, turn).pipe(
        Effect.provide(Layer.merge(githubReaching([]).layer, memorySandbox().layer)),
      ),
  });

it.layer(SUITE)("a started agent's final message handed to its starter", (it) => {
  it.effect(
    "a completed turn hands its last words to the starter once, under the agent's name and how it ended, however many times the settle is heard",
    () =>
      Effect.gen(function* () {
        const agentSessions = recordingSessions();
        const { agent, sessionId } = yield* openStarted();

        const turnId = yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0, REPORT).pipe(
          Effect.provide(reporting(agentSessions)),
        );

        const [told, ...more] = sentTo(agentSessions, sessionId);
        assert.equal(more.length, 0, more.join("\n"));
        assert.ok(told !== undefined);
        assert.match(
          told,
          /^Message · \[@Record the starter\]\(.*\), an agent you started, finished its turn\. Its final message:\n\n/u,
        );
        assert.ok(told.includes(`\n\n${REPORT}\n\n`), told);
        assert.ok(told.endsWith(agentMessageReplyLine(agent.id)), told);

        // The settle heard again, as a retried batch or a second listener would, sends nothing twice.
        yield* reportToStarter(agentSessions.sessionsFor, {
          userId: agent.userId,
          conversationId: agent.conversationId,
          turnId,
          status: TURN_STATUS.SETTLED,
          failure: null,
          ranMs: 1,
        }).pipe(Effect.provide(githubReaching([]).layer));
        assert.equal(sentTo(agentSessions, sessionId).length, 1);
      }),
  );

  it.effect(
    "a failed turn that said nothing hands its failure, a stopped one that it was stopped, and one the plan's limit stopped that limit",
    () =>
      Effect.gen(function* () {
        const agentSessions = recordingSessions();
        const { agent, sessionId } = yield* openStarted();

        yield* endedAt(agent, RUN_STATUS.FAILED, T0).pipe(Effect.provide(reporting(agentSessions)));
        yield* endedAt(agent, RUN_STATUS.CANCELED, T0 + 1_000, "Stopping.").pipe(
          Effect.provide(reporting(agentSessions)),
        );
        yield* endedAt(
          agent,
          RUN_STATUS.FAILED,
          T0 + 2_000,
          undefined,
          TURN_FAILURE.PLAN_LIMIT,
        ).pipe(Effect.provide(reporting(agentSessions)));

        const [failed, stopped, limited] = sentTo(agentSessions, sessionId);
        assert.ok(
          failed?.includes(
            `failed its turn (${TURN_FAILURE.MODEL}). Its final message:\n\n(it said nothing)`,
          ),
          failed ?? "nothing was sent",
        );
        assert.ok(
          stopped?.includes("was stopped before it finished. Its final message:\n\nStopping."),
          stopped ?? "nothing was sent",
        );
        // One its plan's usage limit stopped says so, never as a failure word.
        assert.ok(
          limited?.includes(
            "was stopped: the plan hit its usage limit and the turn could not go on. Its final message:",
          ),
          limited ?? "nothing was sent",
        );
      }),
  );

  it.effect("nothing is handed to a starter archived since", () =>
    Effect.gen(function* () {
      const agentSessions = recordingSessions();
      const { member, starter, agent } = yield* openStarted();
      yield* archiveAgent(member, starter.id, true);

      yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0, REPORT).pipe(
        Effect.provide(reporting(agentSessions)),
      );

      assert.deepEqual(agentSessions.sent, []);
    }),
  );
});

test("a turn ended with end_turn hands its summary as its final words, and one whose end_turn was refused or never answered its last text", () => {
  const said = "Pushed the fix; the checks run again.";
  const summary = "- Fixed the failing check\n- Pushed to #214";

  const ended = (state: "output-available" | "output-error"): StoredUIMessage =>
    ({
      id: "message-1",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: said },
        {
          type: "tool-end_turn" as const,
          toolCallId: "call-1",
          state,
          input: { summary, followUps: ["Show pending invitations on the Members page"] },
          ...(state === "output-available"
            ? { output: { status: "accepted" } }
            : { errorText: "Not taken." }),
        },
      ],
    }) as unknown as StoredUIMessage;

  assert.equal(lastSaid(ended("output-available")), summary);
  assert.equal(lastSaid(ended("output-error")), said);
  // A turn that ended before the call answered keeps it as available, with no answer that took it.
  const unanswered = ended("output-available");
  const [text, call] = unanswered.parts;
  assert.equal(
    lastSaid({
      ...unanswered,
      parts: [text, { ...call, output: undefined }],
    } as unknown as StoredUIMessage),
    said,
  );
  // A later call refused stands for the turn over an earlier one taken.
  const refused = ended("output-error").parts[1];
  assert.equal(
    lastSaid({
      ...unanswered,
      parts: [text, call, { ...refused, toolCallId: "call-2" }],
    } as unknown as StoredUIMessage),
    said,
  );
});
