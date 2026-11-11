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
import { Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { connectAgentApiKeys } from "../../testing/agent-credentials.js";
import { githubReaching } from "../../testing/github-app-fake.js";
import { AGENT_CALLER, type AgentCall } from "../agent-tools.js";
import {
  type AgentSessions,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionMessage,
  SessionUnreachable,
} from "../sessions/agent-sessions.js";
import {
  AgentWakeupNotPublished,
  AgentWakeups,
  consumeAgentWakeup,
  type PublishedAgentWakeup,
} from "./agent-wakeups.js";
import { canceledTurn } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { runScheduleWakeup, WAKEUP_DELAY } from "./wakeup-tool.js";

/**
 * A wakeup booked with `schedule_wakeup`, published to come due after the
 * delay the tool booked, and delivered by the queue's consumer: the booking
 * is handed to its agent as a line of its own and never again; booking
 * again replaces it and `stop` cancels it, so the message published before
 * sends nothing; a Stop of the agent drops it; one whose send fails stands
 * for the queue's next delivery; and one the queue did not take is refused.
 * The queue is a test's, which writes down each message published, and the
 * test hands each to the consumer as the queue would. Over a real dialect,
 * the harness a fake at the client's boundary. Synthetic accounts and
 * prompts.
 */

/** The instant the tests open on, so every row stands at a real date. */
const OPENED = new Date("2026-10-21T12:00:00Z");

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

/** A queue that writes down each message published, or refuses every publish. */
function recordingQueue(refusing = false) {
  const published: PublishedAgentWakeup[] = [];
  const publish = (wakeup: PublishedAgentWakeup) =>
    refusing
      ? Effect.fail(new AgentWakeupNotPublished({ reason: "refused" }))
      : Effect.sync(() => {
          published.push(wakeup);
        });
  return { published, publish };
}

/** One call of `schedule_wakeup` by the agent, at the clock's instant, publishing to the queue given. */
const schedule = (
  agent: Agent,
  input: UnparsedWireValue,
  queue: ReturnType<typeof recordingQueue>,
) =>
  runScheduleWakeup(callOf(agent), input).pipe(
    Effect.provideService(AgentWakeups, { publish: queue.publish }),
  );

/** One delivery of a published message, as the queue hands it, over the harness given. */
const deliver = (
  agentSessions: ReturnType<typeof fakeAgentSessions>,
  wakeup: PublishedAgentWakeup | undefined,
) => {
  assert.ok(wakeup !== undefined, "a message was published");
  return consumeAgentWakeup(agentSessions.sessionsFor, wakeup.wakeupId);
};

/** The words the session was sent, in order. */
const sentTo = (agentSessions: ReturnType<typeof fakeAgentSessions>, sessionId: string) =>
  agentSessions.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));

const SUITE = Layer.mergeAll(getTestDB(), githubReaching([]).layer, memorySandbox().layer);

it.layer(SUITE)("the wakeups coding agents book", (it) => {
  it.effect(
    "a booked wakeup is published to come once its delay has run, and its delivery tells its agent once, as the agent's own line the transcript draws as a wakeup",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const queue = recordingQueue();
        const agentSessions = fakeAgentSessions();
        const { agent, sessionId } = yield* openAgent;

        const booked = yield* schedule(
          agent,
          { delaySeconds: 600, prompt: "Read the checks on pull request #42." },
          queue,
        );
        assert.deepEqual(booked, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          wakeup: { at: "2026-10-21T12:10:00.000Z", delaySeconds: 600 },
        });
        assert.deepEqual(
          queue.published.map(({ delay }) => Duration.toSeconds(delay)),
          [600],
        );

        yield* deliver(agentSessions, queue.published[0]);
        yield* deliver(agentSessions, queue.published[0]);
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
    "booking again replaces the wakeup and stop cancels it, so the message published before sends nothing, and a delay outside the bounds is held to them",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const queue = recordingQueue();
        const agentSessions = fakeAgentSessions();
        const { agent, sessionId } = yield* openAgent;

        yield* schedule(agent, { delaySeconds: 60, prompt: "The first booking." }, queue);
        yield* schedule(agent, { delaySeconds: 120, prompt: "The second booking." }, queue);
        yield* deliver(agentSessions, queue.published[0]);
        assert.deepEqual(sentTo(agentSessions, sessionId), [], "the first booking is replaced");
        yield* deliver(agentSessions, queue.published[1]);
        assert.deepEqual(sentTo(agentSessions, sessionId), ["The second booking."]);

        yield* schedule(agent, { delaySeconds: 60, prompt: "Canceled before it came." }, queue);
        const stopped = yield* schedule(agent, { stop: true }, queue);
        assert.deepEqual(stopped, { status: ACTION_RESULT_STATUS.ACCEPTED, wakeup: null });
        yield* deliver(agentSessions, queue.published[2]);
        assert.deepEqual(sentTo(agentSessions, sessionId), ["The second booking."]);

        const short = yield* schedule(agent, { delaySeconds: 5, prompt: "Too soon." }, queue);
        const long = yield* schedule(agent, { delaySeconds: 100_000, prompt: "Too late." }, queue);
        assert.equal(
          (short as { wakeup: { delaySeconds: number } }).wakeup.delaySeconds,
          WAKEUP_DELAY.MIN_SECONDS,
        );
        assert.equal(
          (long as { wakeup: { delaySeconds: number } }).wakeup.delaySeconds,
          WAKEUP_DELAY.MAX_SECONDS,
        );
        assert.deepEqual(
          queue.published.slice(3).map(({ delay }) => Duration.toSeconds(delay)),
          [WAKEUP_DELAY.MIN_SECONDS, WAKEUP_DELAY.MAX_SECONDS],
        );
        const noPrompt = yield* schedule(agent, { delaySeconds: 60 }, queue);
        assert.equal(noPrompt.status, ACTION_RESULT_STATUS.REJECTED);
      }),
  );

  it.effect(
    "a delivery whose send fails fails, so the queue delivers it again, and the wakeup stands for that delivery",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const queue = recordingQueue();
        const refusing = fakeAgentSessions(true);
        const agentSessions = fakeAgentSessions();
        const { agent, sessionId } = yield* openAgent;
        yield* schedule(agent, { delaySeconds: 60, prompt: "Check the deploy." }, queue);

        const failed = yield* Effect.exit(deliver(refusing, queue.published[0]));
        assert.equal(failed._tag, "Failure");
        yield* deliver(agentSessions, queue.published[0]);
        assert.deepEqual(sentTo(agentSessions, sessionId), ["Check the deploy."]);
      }),
  );

  it.effect("a booking the queue did not take is refused and stands no more", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(OPENED.getTime());
      const queue = recordingQueue();
      const agentSessions = fakeAgentSessions();
      const { agent, sessionId } = yield* openAgent;
      yield* schedule(agent, { delaySeconds: 60, prompt: "Booked and taken." }, queue);

      const refused = yield* schedule(
        agent,
        { delaySeconds: 60, prompt: "Never taken." },
        recordingQueue(true),
      );
      assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
      yield* deliver(agentSessions, queue.published[0]);
      assert.deepEqual(sentTo(agentSessions, sessionId), [], "the refused booking replaced it");
    }),
  );

  it.effect(
    "a Stop of the agent, with no turn running to cancel, drops its booking so none is told",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(OPENED.getTime());
        const queue = recordingQueue();
        const agentSessions = fakeAgentSessions();
        const { owner, agent, sessionId } = yield* openAgent;
        yield* schedule(
          agent,
          { delaySeconds: 60, prompt: "Read the checks on pull request #42." },
          queue,
        );
        const standing = Option.getOrThrow(yield* readAgent(owner, agent.id));

        const canceled = yield* canceledTurn(
          Effect.succeed({ cancel: () => Effect.die("no turn runs, so nothing is canceled") }),
          storeWriter({ tools: CODER_TOOL_SET }),
          standing,
        );
        yield* deliver(agentSessions, queue.published[0]);
        assert.equal(canceled, false);
        assert.deepEqual(sentTo(agentSessions, sessionId), []);
      }),
  );
});
