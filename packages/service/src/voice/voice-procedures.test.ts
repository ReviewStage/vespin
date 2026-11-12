import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { parseKeyRing, sealProviderKey } from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { hostedUsage } from "@repo/database/schemas/usage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openAgentOnOwnTask,
  openWorkspace,
} from "@repo/database/testing";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { LIVE_VOICE } from "@repo/features/voices";
import type { WireBoundaryInput } from "@repo/wire";
import { HTTP_STATUS, jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Cause, type Context, Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import {
  recordingProductAnalytics,
  SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_VOICE_CALL_DURATION,
} from "../events/server-events.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { voiceProcedures } from "./voice-procedures.js";

/**
 * A voice call opened by the hosted oRPC router the way the web route
 * answers it, over a real dialect and OpenAI faked at its HTTP door: the
 * panel's offer goes to GPT-Live on the caller's own OpenAI key, never ours,
 * and only the SDP answer comes back. A caller with no key of their own, and
 * one outside the agent's workspace, are each refused before OpenAI is
 * called. A finished call's seconds
 * land on the caller's day and are counted by length and harness alone.
 *
 * Synthetic accounts, bearers, offers, and keys throughout.
 */

const ANALYTICS = recordingProductAnalytics();

const ORIGIN = "https://app.test";
const SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const OPENAI_KEY = "sk-proj-account-test-key-00000000000voice";

/** The deployment's ring the account's key is sealed under: fixed bytes written for this file. */
const RING = `1:${Buffer.alloc(32, 5).toString("base64")}`;

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=offer\r\n";
const ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=answer\r\n";

/** GPT-Live answers a created session with 201. */
const CREATED = 201;

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** How the fake GPT-Live answers: a created session with its SDP answer, or a status of its own. */
type LiveAnswer = { readonly created: true } | { readonly status: number };

function liveResponse(answer: LiveAnswer): Response {
  if ("status" in answer) return jsonResponse({ error: { message: OPENAI_KEY } }, answer.status);

  return jsonResponse(
    { session: { id: "live_test" }, transport: { type: "webrtc", sdp: ANSWER } },
    CREATED,
  );
}

/** A signed-in account, with its own OpenAI key saved unless told otherwise. */
const openAccount = (options: { readonly key?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

    if (options.key === false) return userId;
    const ring = parseKeyRing(Redacted.make(RING));
    assert.ok(Result.isSuccess(ring));

    const owner = {
      userId,
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.API_KEY,
    } as const;

    yield* saveProviderKey(
      userId,
      owner.provider,
      owner.kind,
      sealProviderKey(ring.success, owner, Redacted.make(OPENAI_KEY)),
      "sk-…oice",
      null,
      new Date(0),
    );

    return userId;
  });

/** An agent of the owner's on a task named "Flaky tests", running on Claude Code; its id. */
const openAgent = (ownerId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const agentId = yield* openAgentOnOwnTask(ownerId, workspaceId);

    const [row] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));

    assert.ok(row);
    yield* db
      .update(conversations)
      .set({ runtime: CONVERSATION_RUNTIME.CLAUDE_CODE })
      .where(eq(conversations.id, row.conversationId));

    return agentId;
  });

/** The router with GPT-Live answering as given, and every request it sent and line it logged kept for the test to read. */
const openRouter = (live: LiveAnswer = { created: true }) => {
  const model = recordingHttpClient(() => liveResponse(live));
  const logged: string[] = [];

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
            Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
            model.layer,
            ANALYTICS.layer,
            Logger.layer([recorder]),
          ),
        ),
      );
      // SAFETY: the voice procedures yield the database, the clock, the environment, the analytics, and OpenAI's HTTP client alone, which the context above holds.

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

  const ended = (userId: string, agentId: string, seconds: number) =>
    ask(userId, "/api/voice/calls", { agentId, seconds });

  return { open, ended, calls: model.requests, logged };
};

const refusal = (status: number, error: string) => ({ status, body: { error } });

it.layer(getTestDB())("the voice routes", (it) => {
  it.effect(
    "a call is created on GPT-Live with the panel's offer, the voice, and the agent's task on the caller's own key, and answered with the SDP answer alone",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openAccount();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const router = openRouter();

        const answered = yield* router.open(ownerId, agentId);

        assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { sdp: ANSWER } });
        assert.equal(router.calls.length, 1);
        const [call] = router.calls;
        assert.ok(call);
        assert.equal(call.url, SESSIONS_URL);
        assert.equal(call.authorization, `Bearer ${OPENAI_KEY}`);
        const raw = call.init.body;
        assert.ok(raw instanceof Uint8Array, "the session goes as a JSON body");
        const sent = JSON.parse(new TextDecoder().decode(raw));
        assert.deepEqual(sent.transport, { type: "webrtc", sdp: OFFER });
        assert.equal(sent.session.model, "gpt-live-1");
        assert.deepEqual(sent.session.delegation, { type: "client" });
        assert.equal(sent.session.store, false);
        assert.deepEqual(sent.session.audio, { output: { voice: LIVE_VOICE.CEDAR } });
        assert.ok(sent.session.instructions.includes("Task: Flaky tests"));
      }),
  );

  it.effect(
    "a caller with no OpenAI key of their own is refused as missing one, and one outside the agent's workspace as not found, and OpenAI is never called",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openAccount();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const keyless = yield* openAccount({ key: false });
        yield* joinWorkspace(workspaceId, keyless);
        const stranger = yield* openAccount();
        const router = openRouter();

        assert.deepEqual(
          yield* router.open(keyless, agentId),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.OPENAI_KEY_MISSING),
        );
        assert.deepEqual(
          yield* router.open(stranger, agentId),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.equal(router.calls.length, 0);
      }),
  );

  it.effect(
    "a session OpenAI refused is answered unavailable, and neither the key nor the offer is logged",
    () =>
      Effect.gen(function* () {
        const ownerId = yield* openAccount();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const router = openRouter({ status: HTTP_STATUS.UNAUTHORIZED });

        const answered = yield* router.open(ownerId, agentId);

        assert.deepEqual(
          answered,
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.ok(router.logged.length > 0, "the failure is logged");

        for (const secret of [OPENAI_KEY, OFFER]) {
          assert.ok(router.logged.every((line) => !line.includes(secret)));
        }
      }),
  );

  it.effect(
    "a finished call's seconds land on the caller's day, and it is counted under the agent's workspace by its length and harness alone",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const ownerId = yield* openAccount();
        const workspaceId = yield* openWorkspace(ownerId);
        const agentId = yield* openAgent(ownerId, workspaceId);
        const router = openRouter();

        const answered = yield* router.ended(ownerId, agentId, 330);

        assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { done: true } });

        const days = yield* db
          .select({ voiceSeconds: hostedUsage.voiceSeconds })
          .from(hostedUsage)
          .where(eq(hostedUsage.userId, ownerId));

        assert.deepEqual(days, [{ voiceSeconds: 330 }]);
        assert.deepEqual(
          ANALYTICS.recorded
            .filter((event) => event.userId === ownerId && event.name === SERVER_EVENT.VOICE_CALL)
            .map((event) => ({ workspaceId: event.workspaceId, ...event.properties })),
          [
            {
              workspaceId,
              duration: SERVER_VOICE_CALL_DURATION.UNDER_15M,
              harness: SERVER_AGENT_HARNESS.CLAUDE_CODE,
            },
          ],
        );
        assert.equal(router.calls.length, 0);
      }),
  );
});
