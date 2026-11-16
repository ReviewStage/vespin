/**
 * voice-callers.ts -- a signed-in account with its own OpenAI key sealed under a fixed ring, as a voice call's caller is, and the environment that opens it; a call that caller opened on an agent, and a fake GPT-Live session for the lease holding it to attach to.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@repo/database/core/query";
import { parseKeyRing, sealProviderKey } from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import { insertVoiceCall } from "@repo/database/models/voice-calls";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { openAgentOnOwnTask, openWorkspace } from "@repo/database/testing";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { LIVE_VOICE } from "@repo/features/voices";
import type { WireValue } from "@repo/wire";
import { eq } from "drizzle-orm";
import { type Cause, Deferred, Effect, Layer, Queue, Redacted, Result, Stream } from "effect";
import type { HostedEnvironmentValues } from "../environment.js";
import { LIVE_SIDEBAND_EVENT, type LiveEvent, LiveSidebands } from "../voice/live-sideband.js";

/** How many of its last events the fake session replays to a new connection, as GPT-Live replays its last few seconds. */
export const LIVE_REPLAYED = 2;

/** A synthetic OpenAI key, sealed for each caller who keeps one. */
export const VOICE_CALLER_KEY = "sk-proj-account-test-key-00000000000voice";

/** The deployment's ring the caller's key is sealed under: fixed bytes written for these tests. */
const RING = `1:${Buffer.alloc(32, 5).toString("base64")}`;

/** A deployment whose only configuration is the ring that opens a caller's key. */
export const VOICE_CALLER_ENVIRONMENT: HostedEnvironmentValues = {
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

/** A signed-in account, with its own OpenAI key saved unless told otherwise; its id. */
export const openVoiceCaller = (options: { readonly key?: boolean } = {}) =>
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
      sealProviderKey(ring.success, owner, Redacted.make(VOICE_CALLER_KEY)),
      "sk-…oice",
      null,
      new Date(0),
    );

    return userId;
  });

/**
 * A fake GPT-Live session: what it says, under the event id given or one of
 * its own, reaches every attached connection, a new one hears its last
 * `LIVE_REPLAYED` events first, every event it is sent is written down,
 * whole into `told` where a test hands one, and a close it is sent is
 * answered with `session.closed` carrying the seconds given.
 */
export function fakeLiveSession(
  closingSeconds: number | undefined,
  told?: Queue.Queue<{ readonly type: string }>,
) {
  const said: LiveEvent[] = [];
  const sent: string[] = [];
  const askedToClose = Deferred.makeUnsafe<void>();
  const connections = new Set<Queue.Queue<LiveEvent, Cause.Done>>();

  const say = (
    type: string,
    extra: { readonly [key: string]: WireValue } = {},
    named = `event_${said.length + 1}`,
  ) =>
    Effect.sync(() => {
      const eventId = named;
      const event: LiveEvent = { type, eventId, body: { type, event_id: eventId, ...extra } };
      said.push(event);

      for (const connection of connections) Queue.offerUnsafe(connection, event);

      if (type === LIVE_SIDEBAND_EVENT.CLOSED) {
        for (const connection of connections) Queue.endUnsafe(connection);
      }

      return eventId;
    });

  const layer = Layer.succeed(LiveSidebands, {
    attach: () =>
      Effect.gen(function* () {
        const connection = yield* Queue.make<LiveEvent, Cause.Done>();

        for (const event of said.slice(-LIVE_REPLAYED)) Queue.offerUnsafe(connection, event);
        connections.add(connection);
        yield* Effect.addFinalizer(() => Effect.sync(() => connections.delete(connection)));

        return {
          events: Stream.fromQueue(connection),
          send: (event: { readonly type: string }) =>
            Effect.gen(function* () {
              sent.push(event.type);

              if (told !== undefined) Queue.offerUnsafe(told, event);

              if (event.type === LIVE_SIDEBAND_EVENT.CLOSE)
                Deferred.doneUnsafe(askedToClose, Effect.void);

              // A session given no seconds to close with never confirms the close.
              if (event.type === LIVE_SIDEBAND_EVENT.CLOSE && closingSeconds !== undefined) {
                yield* say(LIVE_SIDEBAND_EVENT.CLOSED, { usage: { seconds: closingSeconds } });
              }
            }),
        };
      }),
  });

  return { say, sent, askedToClose, layer };
}

/** A call opened by the route on a Claude Code agent, its row at epoch 1. */
export const openVoiceCall = Effect.gen(function* () {
  const db = yield* Database;
  const callerId = yield* openVoiceCaller();
  const workspaceId = yield* openWorkspace(callerId);
  const agentId = yield* openAgentOnOwnTask(callerId, workspaceId);

  const [agent] = yield* db
    .select({ conversationId: agentTable.conversationId })
    .from(agentTable)
    .where(eq(agentTable.id, agentId));

  assert.ok(agent);
  yield* db
    .update(conversations)
    .set({ runtime: CONVERSATION_RUNTIME.CLAUDE_CODE })
    .where(eq(conversations.id, agent.conversationId));

  const call = yield* insertVoiceCall({
    liveSessionId: "live_test",
    callerId,
    agentId,
    voice: LIVE_VOICE.MARIN,
    startedAt: new Date(0),
    leaseUntil: new Date(0),
  });

  return { call, callerId, workspaceId, agentId };
});
