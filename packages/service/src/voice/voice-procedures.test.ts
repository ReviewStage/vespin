import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { listCallLines } from "@repo/database/models/message-reads";
import { readVoiceCall } from "@repo/database/models/voice-calls";
import { agentTable } from "@repo/database/schemas/agent";
import { conversations, messages } from "@repo/database/schemas/storage";
import { voiceCallTable } from "@repo/database/schemas/voice-call";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openAgentOnOwnTask,
  openWorkspace,
} from "@repo/database/testing";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { LIVE_VOICE } from "@repo/features/voices";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE, type WireBoundaryInput } from "@repo/wire";
import { HTTP_STATUS, jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Cause, type Context, Duration, Effect, Layer, Logger, Option } from "effect";
import { TestClock } from "effect/testing";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  openVoiceCaller,
  VOICE_CALLER_ENVIRONMENT,
  VOICE_CALLER_KEY,
} from "../testing/voice-callers.js";
import {
  type VoiceCallLeaseMessage,
  VoiceCallLeaseNotPublished,
  VoiceCallLeases,
} from "./voice-call-lease.js";
import { voiceProcedures } from "./voice-procedures.js";

/**
 * A voice call opened by the hosted oRPC router the way the web route
 * answers it, over a real dialect and OpenAI faked at its HTTP door: the
 * panel's offer goes to GPT-Live on the caller's own OpenAI key, never ours,
 * with the panel's data channel cut down to audio's own events, and only the
 * call's id and the SDP answer come back, the call's row standing and its
 * first lease published. A caller with no key of their own, one outside the
 * agent's workspace, and a teammate on an agent only its starter drives are
 * each refused before OpenAI is called; a call whose lease the queue did not
 * take is refused and leaves no row. A reconnect carries the same call on
 * over a new session, its row, id, and lines kept, and its clock going on
 * from the call's start.
 *
 * Synthetic accounts, bearers, offers, and keys throughout.
 */

const ORIGIN = "https://app.test";
const SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const LIVE_SESSION_ID = "live_test";
const RECONNECTED_SESSION_ID = "live_test_reconnected";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=offer\r\n";
const ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=answer\r\n";

/** GPT-Live answers a created session with 201. */
const CREATED = 201;

/** How the fake GPT-Live answers: a created session with its SDP answer, or a status of its own. */
type LiveAnswer = { readonly created: true } | { readonly status: number };

function liveResponse(answer: LiveAnswer, sessionId: string): Response {
  if ("status" in answer) {
    return jsonResponse({ error: { message: VOICE_CALLER_KEY } }, answer.status);
  }

  return jsonResponse(
    { session: { id: sessionId }, transport: { type: "webrtc", sdp: ANSWER } },
    CREATED,
  );
}

/** An agent of the owner's on a task named "Flaky tests", running on Claude Code, in our sandbox or on the owner's own Mac; its id. */
const openAgent = (ownerId: string, workspaceId: string, onMac = false) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const agentId = yield* openAgentOnOwnTask(ownerId, workspaceId);

    const [row] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));

    assert.ok(row);

    // A call already held: the developer's spoken line, the voice's retelling of it, and the agent's reply.
    const said = [
      [
        MESSAGE_ROLE.USER,
        "Use the staging database.",
        { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
      ],
      [
        MESSAGE_ROLE.ASSISTANT,
        "Passing that on now.",
        { author: MESSAGE_AUTHOR.VOICE_MODEL, channel: MESSAGE_CHANNEL.VOICE },
      ],
      [MESSAGE_ROLE.ASSISTANT, "Switched the tests to staging.", { author: MESSAGE_AUTHOR.MODEL }],
    ] as const;

    yield* db.insert(messages).values(
      said.map(([role, text, metadata], seq) => ({
        userId: ownerId,
        conversationId: row.conversationId,
        seq,
        clientId: randomUUID(),
        role,
        parts: [{ type: "text" as const, text }],
        metadata,
        placedAt: new Date(seq),
        finishedAt: new Date(seq),
      })),
    );

    yield* db
      .update(conversations)
      .set({ runtime: CONVERSATION_RUNTIME.CLAUDE_CODE })
      .where(eq(conversations.id, row.conversationId));

    if (onMac) {
      yield* db
        .update(agentTable)
        .set({ machine: AGENT_MACHINE.DEVICE })
        .where(eq(agentTable.id, agentId));
    }

    return agentId;
  });

/** The router with GPT-Live answering as given and the queue taking leases unless told otherwise, and every request it sent, lease it published, and line it logged kept for the test to read. */
const openRouter = (live: LiveAnswer = { created: true }, queue = { takes: true }) => {
  // The first session made is the call's, and the next one a reconnect's.
  let made = 0;

  const model = recordingHttpClient(() => {
    made += 1;

    return liveResponse(live, made === 1 ? LIVE_SESSION_ID : RECONNECTED_SESSION_ID);
  });

  const logged: string[] = [];
  const published: VoiceCallLeaseMessage[] = [];

  const procedures = voiceProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
      ),
  });

  const ask = (userId: string, path: string, body: WireBoundaryInput) =>
    Effect.gen(function* () {
      const recorder = Logger.make(({ message, cause }) => {
        logged.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
      });

      const services = yield* Effect.context<never>().pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HostedEnvironment, VOICE_CALLER_ENVIRONMENT),
            Layer.succeed(VoiceCallLeases, {
              publish: (lease) =>
                queue.takes
                  ? Effect.sync(() => {
                      published.push(lease);
                    })
                  : Effect.fail(new VoiceCallLeaseNotPublished({ reason: "refused" })),
            }),
            model.layer,
            Logger.layer([recorder]),
          ),
        ),
      );
      // SAFETY: the voice procedures yield the database, the clock, the environment, the queue, and OpenAI's HTTP client alone, which the context above holds.

      const webServices = services as Context.Context<WebServices>;

      const response = yield* Effect.promise(() =>
        hostedFetch({ voice: procedures })(
          new Request(new URL(path, ORIGIN), {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${userId}` },
            body: JSON.stringify(body),
          }),
          webServices,
        ),
      );

      const text = yield* Effect.promise(() => response.text());
      // SAFETY: the route answers JSON; the test compares it as the wire value it is.

      return { status: response.status, body: JSON.parse(text) as WireBoundaryInput };
    });

  const open = (userId: string, agentId: string) =>
    ask(userId, "/api/voice/session", { agentId, voice: LIVE_VOICE.CEDAR, sdp: OFFER });

  const reconnect = (userId: string, callId: string) =>
    ask(userId, "/api/voice/reconnect", { callId, sdp: OFFER });

  return { open, reconnect, calls: model.requests, published, logged };
};

/** The JSON body a recorded request to GPT-Live sent. */
function sentBody(request: { readonly init: { readonly body?: unknown } } | undefined) {
  const raw = request?.init.body;
  assert.ok(raw instanceof Uint8Array, "the session goes as a JSON body");

  return JSON.parse(new TextDecoder().decode(raw));
}

/** Two lines said on the call, the developer's and the voice's, as the call's holder records them. */
const saidOnCall = (ownerId: string, agentId: string, callId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const [row] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));

    assert.ok(row);

    const lines = [
      [MESSAGE_ROLE.USER, "Can you hear me?", MESSAGE_AUTHOR.DEVELOPER, "line_1"],
      [MESSAGE_ROLE.ASSISTANT, "Yes, go on.", MESSAGE_AUTHOR.VOICE_MODEL, "line_2"],
    ] as const;

    yield* db.insert(messages).values(
      lines.map(([role, text, author, key], index) => ({
        userId: ownerId,
        conversationId: row.conversationId,
        seq: 10 + index,
        clientId: randomUUID(),
        role,
        parts: [{ type: "text" as const, text }],
        metadata: {
          author,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: callId,
          line_key: key,
          from_ms: 1_000 * index,
          to_ms: 1_000 * index + 800,
        },
        placedAt: new Date(10 + index),
        finishedAt: new Date(10 + index),
      })),
    );

    return row.conversationId;
  });

const refusal = (status: number, error: string) => ({ status, body: { error } });

it.layer(getTestDB())("the voice routes", (it) => {
  it.effect(
    "a call is created on GPT-Live with the panel's offer, the voice, the agent's task, and the panel's channel cut down, on the caller's own key, and answered with its id and the SDP answer alone, its row standing and its first lease published",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openVoiceCaller();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const router = openRouter();

        const answered = yield* router.open(ownerId, agentId);

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        // SAFETY: an answered open is the call's id and its SDP answer, which the next line compares whole.
        const { callId, sdp } = answered.body as { callId: string; sdp: string };
        assert.deepEqual(answered.body, { callId, sdp: ANSWER });
        assert.equal(sdp, ANSWER);

        // The session's id stays with the service, on the call's row, and the call's first lease names the epoch the row opened at.
        const call = Option.getOrThrow(yield* readVoiceCall(ownerId, callId));
        assert.equal(call.liveSessionId, LIVE_SESSION_ID);
        assert.equal(call.agentId, agentId);
        assert.equal(call.voice, LIVE_VOICE.CEDAR);
        assert.deepEqual(router.published, [{ callId, callerId: ownerId, epoch: 1 }]);
        assert.equal(router.calls.length, 1);
        const [request] = router.calls;
        assert.ok(request);
        assert.equal(request.url, SESSIONS_URL);
        assert.equal(request.authorization, `Bearer ${VOICE_CALLER_KEY}`);
        const sent = sentBody(request);
        assert.deepEqual(sent.transport, { type: "webrtc", sdp: OFFER });
        assert.equal(sent.session.model, "gpt-live-1");
        assert.deepEqual(sent.session.delegation, { type: "client" });
        assert.equal(sent.session.store, false);
        assert.deepEqual(sent.session.audio, { output: { voice: LIVE_VOICE.CEDAR } });
        // The panel may only mute, unmute, and end the call, and hears only its start, its close, and the mute acknowledgments.
        assert.deepEqual(sent.session.client, {
          data_channel: {
            allowed_client_events: [
              "session.input_audio.mute",
              "session.input_audio.unmute",
              "session.close",
            ],
            allowed_server_events: [
              { type: "session.started" },
              { type: "session.closed" },
              { type: "session.input_audio.muted" },
              { type: "session.input_audio.unmuted" },
            ],
          },
        });
        assert.ok(sent.session.instructions.includes("Task: Flaky tests"));
        // The developer's spoken line and the agent's reply are context; the voice's own retelling is not.
        assert.ok(sent.session.instructions.includes("Developer: Use the staging database."));
        assert.ok(sent.session.instructions.includes("Agent: Switched the tests to staging."));
        assert.ok(!sent.session.instructions.includes("Passing that on now."));
      }),
  );

  it.effect(
    "a caller with no OpenAI key of their own is refused as missing one, one outside the agent's workspace as not found, and a teammate on an agent that runs on its starter's Mac as not permitted, and OpenAI is never called",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openVoiceCaller();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const keyless = yield* openVoiceCaller({ key: false });
        yield* joinWorkspace(workspaceId, keyless);
        const stranger = yield* openVoiceCaller();
        const teammate = yield* openVoiceCaller();
        yield* joinWorkspace(workspaceId, teammate);
        const onMac = yield* openAgent(ownerId, workspaceId, true);
        const router = openRouter();

        assert.deepEqual(
          yield* router.open(keyless, agentId),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.OPENAI_KEY_MISSING),
        );
        assert.deepEqual(
          yield* router.open(stranger, agentId),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* router.open(teammate, onMac),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.equal(router.calls.length, 0);
      }),
  );

  it.effect(
    "a session OpenAI refused is answered unavailable, and neither the key nor the offer is logged",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openVoiceCaller();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const router = openRouter({ status: HTTP_STATUS.UNAUTHORIZED });

        const answered = yield* router.open(ownerId, agentId);

        assert.deepEqual(
          answered,
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.ok(router.logged.length > 0, "the failure is logged");

        for (const secret of [VOICE_CALLER_KEY, OFFER]) {
          assert.ok(router.logged.every((line) => !line.includes(secret)));
        }
      }),
  );

  it.effect(
    "a call whose first lease the queue did not take is refused as unavailable, and its row is gone",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const ownerId = yield* openVoiceCaller();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const router = openRouter({ created: true }, { takes: false });

        const answered = yield* router.open(ownerId, agentId);

        assert.deepEqual(
          answered,
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );

        const standing = yield* db
          .select({ id: voiceCallTable.id })
          .from(voiceCallTable)
          .where(eq(voiceCallTable.callerId, ownerId));

        assert.deepEqual(standing, []);
      }),
  );

  it.effect(
    "a reconnect carries the same call on over a new session in its voice, told that it dropped and what was said, the call's id, row, and lines kept and its clock going on from the call's start, and the lease it publishes closes the session it left",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openVoiceCaller();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const stranger = yield* openVoiceCaller();
        const router = openRouter();

        // SAFETY: an answered open is the call's id and its SDP answer.
        const { callId } = (yield* router.open(ownerId, agentId)).body as { callId: string };
        const conversationId = yield* saidOnCall(ownerId, agentId, callId);
        // A second in by the wall, but the voice's last line already ended 1.8 s in, since a session's clock starts at its first audio.
        yield* TestClock.adjust(Duration.seconds(1));

        assert.deepEqual(
          yield* router.reconnect(stranger, callId),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );

        const answered = yield* router.reconnect(ownerId, callId);

        assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { sdp: ANSWER } });
        const call = Option.getOrThrow(yield* readVoiceCall(ownerId, callId));
        assert.equal(call.liveSessionId, RECONNECTED_SESSION_ID);
        assert.equal(call.clockBaseMs, 1_800);
        assert.equal(call.leaseEpoch, 2);
        assert.deepEqual(router.published.at(-1), {
          callId,
          callerId: ownerId,
          epoch: 2,
          closes: LIVE_SESSION_ID,
        });

        const sent = sentBody(router.calls[1]);
        assert.deepEqual(sent.transport, { type: "webrtc", sdp: OFFER });
        assert.deepEqual(sent.session.audio, { output: { voice: LIVE_VOICE.CEDAR } });
        assert.ok(sent.session.instructions.includes("This call dropped a moment ago"));
        assert.ok(
          sent.session.instructions.includes("Developer: Can you hear me?\nYou: Yes, go on."),
        );

        const lines = yield* listCallLines(ownerId, conversationId, callId, CODER_TOOL_SET);
        assert.ok(lines.ok);
        assert.equal(lines.value.length, 2);
      }),
  );
});
