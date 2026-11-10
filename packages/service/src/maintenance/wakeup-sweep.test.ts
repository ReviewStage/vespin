import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { type Agent, createAgent, readAgent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { ACTION_RESULT_STATUS, MESSAGE_CHANNEL, type UnparsedWireValue } from "@repo/wire";
import { and, eq, isNotNull } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { AGENT_CALLER, type AgentCall } from "../agents/agent-tools.js";
import { canceledTurn } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { runScheduleWakeup, WAKEUP_DELAY } from "../agents/coder-host/wakeup-tool.js";
import {
  type AgentSessions,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionMessage,
  SessionUnreachable,
} from "../agents/sessions/agent-sessions.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { sweepAgentWakeups, WAKEUP_SWEEP } from "./wakeup-sweep.js";

/**
 * A wakeup booked with `schedule_wakeup` and delivered by the sweep: the
 * booking is handed to its agent as a line of its own once the delay the
 * tool booked has run on the clock, and never again; booking again replaces
 * it and `stop` cancels it; a Stop of the agent drops it; and one whose
 * delivery fails is tried again past the retry, then given up. The clock is
 * the test's (`TestClock`), so the due time is read off it as the sweep
 * reads it off the cron's. Over a real dialect, the harness a fake at the
 * client's boundary. The claim is the deployment's, so each test reads back
 * only the lines its own agent was sent. Synthetic accounts and prompts.
 */

/** The instant the tests open on, so every row and claim stands at a real date. */
const OPENED = new Date("2026-10-21T12:00:00Z");
const RETRY_MS = Duration.toMillis(WAKEUP_SWEEP.RETRY);

/** The agent's harness, writing down every message sent, by session, or refusing every send. */
function fakeAgentSessions(refusing = false) {
  const sent: { readonly sessionId: string; readonly message: SessionMessage }[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({
        outcome: SESSION_SEND_OUTCOME.ACCEPTED,
        sessionId: `codex-${randomUUID()}`,
      }),
    send: (sessionId, message) =>
      refusing
        ? Effect.fail(
            new SessionUnreachable({
              // SAFETY: the client's own error shape, built by the fake at the transport it stands for.
              cause: {
                _tag: "RequestError",
                reason: { _tag: "TransportError" },
                message: "refused",
              } as never,
            }),
          )
        : Effect.sync(() => {
            sent.push({ sessionId, message });
            return {
              outcome: SESSION_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: randomUUID(),
            } as const;
          }),
    cancel: () => Effect.succeed({ outcome: SESSION_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: SESSION_RESET_OUTCOME.RESET }),
  };
  return { sent, sessions, sessionsFor: () => Effect.succeed(sessions) };
}

/** The words of a message sent to the harness. */
function sentText(message: SessionMessage["message"]): string {
  if (!Array.isArray(message)) return message;
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** A Codex agent of a new account's, its harness session recorded, and the session's id. */
const openAgent = Effect.gen(function* () {
  const db = yield* Database;
  const owner = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: owner, name: "Test User", email: `${owner}@app.test` });
  yield* connectAgentApiKeys(owner);
  const task = yield* startTask(owner, { name: "Invitations" });
  const started = yield* createAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "openai/gpt-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CODEX,
    payer: AGENT_PAYER.API_KEY,
  });
  const { agent } = Option.getOrThrow(started);
  const sessionId = `codex-${randomUUID()}`;
  yield* claimRuntimeSession(
    { userId: owner, conversationId: agent.conversationId },
    sessionId,
    new Date(OPENED.getTime() - 3_600_000),
  );
  return { owner, agent, sessionId };
});

/** The tool's call as the agent makes it, its sessions unused since a booking reaches none. */
function callOf(agent: Agent): AgentCall {
  const { sessions } = fakeAgentSessions();
  return {
    caller: { kind: AGENT_CALLER.AGENT, agent, descriptionsOn: true },
    agentSessions: sessions,
    agentSessionsAs: () => sessions,
    writer: storeWriter({ tools: CODER_TOOL_SET }),
    clientKey: randomUUID(),
  };
}

/** One call of `schedule_wakeup` by the agent, at the clock's instant. */
const schedule = (agent: Agent, input: UnparsedWireValue) =>
  runScheduleWakeup(callOf(agent), input);

/** One sweep at the clock's instant, as the cron's sweep is handed it, over the harness given. */
const sweepNow = (agentSessions: ReturnType<typeof fakeAgentSessions>) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    sweepAgentWakeups(agentSessions.sessionsFor, new Date(now)),
  );

/** The words the session was sent, in order. */
const sentTo = (agentSessions: ReturnType<typeof fakeAgentSessions>, sessionId: string) =>
  agentSessions.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));

const SUITE = Layer.mergeAll(getTestDB(), githubReaching([]).layer, memorySandbox().layer);

it.layer(SUITE)("the wakeups coding agents book", (it) => {
  it.effect(
    "a booked wakeup is told to its agent once its delay has run, and never again, as the agent's own line the transcript draws as a wakeup",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const agentSessions = fakeAgentSessions();
        const { agent, sessionId } = yield* openAgent;

        const booked = yield* schedule(agent, {
          delaySeconds: 600,
          prompt: "Read the checks on pull request #42.",
        });
        assert.deepEqual(booked, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          wakeup: { at: "2026-10-21T12:10:00.000Z", delaySeconds: 600 },
        });

        yield* sweepNow(agentSessions);
        yield* TestClock.adjust("9 minutes");
        yield* sweepNow(agentSessions);
        assert.deepEqual(sentTo(agentSessions, sessionId), [], "not yet due");
        yield* TestClock.adjust("1 minute");
        yield* sweepNow(agentSessions);
        yield* TestClock.adjust(WAKEUP_SWEEP.RETRY);
        yield* sweepNow(agentSessions);
        assert.deepEqual(sentTo(agentSessions, sessionId), [
          "Read the checks on pull request #42.",
        ]);
        // The words are the agent's own, so its row names the agent as their sender, on the app's channel, which the transcript draws as the agent waking up.
        const db = yield* Database;
        const lines = yield* db
          .select({
            sender: messages.sender,
            senderAgentId: messages.senderAgentId,
            metadata: messages.metadata,
          })
          .from(messages)
          .where(
            and(eq(messages.conversationId, agent.conversationId), isNotNull(messages.sender)),
          );
        assert.deepEqual(
          lines.map(({ sender, senderAgentId, metadata }) => ({
            sender,
            senderAgentId,
            channel: metadata !== null && "channel" in metadata ? metadata.channel : undefined,
          })),
          [{ sender: MESSAGE_SENDER.AGENT, senderAgentId: agent.id, channel: MESSAGE_CHANNEL.APP }],
        );
      }),
  );

  it.effect(
    "booking again replaces the wakeup, stop cancels it, and a delay outside the bounds is held to them",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const agentSessions = fakeAgentSessions();
        const { agent, sessionId } = yield* openAgent;

        yield* schedule(agent, { delaySeconds: 60, prompt: "The first booking." });
        yield* schedule(agent, { delaySeconds: 120, prompt: "The second booking." });
        yield* TestClock.adjust("1 minute");
        yield* sweepNow(agentSessions);
        assert.deepEqual(sentTo(agentSessions, sessionId), [], "the first booking is replaced");
        yield* TestClock.adjust("1 minute");
        yield* sweepNow(agentSessions);
        assert.deepEqual(sentTo(agentSessions, sessionId), ["The second booking."]);

        yield* schedule(agent, { delaySeconds: 60, prompt: "Canceled before it came." });
        const stopped = yield* schedule(agent, { stop: true });
        assert.deepEqual(stopped, { status: ACTION_RESULT_STATUS.ACCEPTED, wakeup: null });
        yield* TestClock.adjust("1 minute");
        yield* sweepNow(agentSessions);
        assert.deepEqual(sentTo(agentSessions, sessionId), ["The second booking."]);

        const short = yield* schedule(agent, { delaySeconds: 5, prompt: "Too soon." });
        const long = yield* schedule(agent, { delaySeconds: 100_000, prompt: "Too late." });
        assert.equal(
          (short as { wakeup: { delaySeconds: number } }).wakeup.delaySeconds,
          WAKEUP_DELAY.MIN_SECONDS,
        );
        assert.equal(
          (long as { wakeup: { delaySeconds: number } }).wakeup.delaySeconds,
          WAKEUP_DELAY.MAX_SECONDS,
        );
        const noPrompt = yield* schedule(agent, { delaySeconds: 60 });
        assert.equal(noPrompt.status, ACTION_RESULT_STATUS.REJECTED);
      }),
  );

  it.effect("a wakeup whose delivery fails is tried again past the retry, then given up", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(OPENED.getTime());
      const refusing = fakeAgentSessions(true);
      const agentSessions = fakeAgentSessions();
      const { agent, sessionId } = yield* openAgent;
      yield* schedule(agent, { delaySeconds: 60, prompt: "Check the deploy." });

      yield* TestClock.adjust("1 minute");
      yield* sweepNow(refusing);
      yield* TestClock.adjust("1 second");
      yield* sweepNow(agentSessions);
      assert.deepEqual(sentTo(agentSessions, sessionId), [], "not before the retry");
      yield* TestClock.adjust(RETRY_MS);
      yield* sweepNow(agentSessions);
      assert.deepEqual(sentTo(agentSessions, sessionId), ["Check the deploy."]);

      const given = yield* openAgent;
      yield* schedule(given.agent, { delaySeconds: 60, prompt: "Never lands." });
      yield* TestClock.adjust("1 minute");
      for (let attempt = 0; attempt < WAKEUP_SWEEP.MAX_ATTEMPTS; attempt += 1) {
        yield* sweepNow(refusing);
        yield* TestClock.adjust(RETRY_MS);
      }
      yield* sweepNow(agentSessions);
      assert.deepEqual(sentTo(agentSessions, given.sessionId), [], "given up past the bound");
    }),
  );

  it.effect(
    "a Stop of the agent, with no turn running to cancel, drops its booking so none is told",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const agentSessions = fakeAgentSessions();
        const { owner, agent, sessionId } = yield* openAgent;
        yield* schedule(agent, {
          delaySeconds: 60,
          prompt: "Read the checks on pull request #42.",
        });
        const standing = Option.getOrThrow(yield* readAgent(owner, agent.id));

        const canceled = yield* canceledTurn(
          Effect.succeed({ cancel: () => Effect.die("no turn runs, so nothing is canceled") }),
          storeWriter({ tools: CODER_TOOL_SET }),
          standing,
        );
        yield* TestClock.adjust("1 minute");
        yield* sweepNow(agentSessions);
        assert.equal(canceled, false);
        assert.deepEqual(sentTo(agentSessions, sessionId), []);
      }),
  );
});
