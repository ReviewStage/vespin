/**
 * voice-procedures.ts -- a voice call into an agent: its GPT-Live session opened on the caller's own OpenAI key, and its first lease published.
 *
 * `POST /api/voice/session` takes the panel's SDP offer, the agent the call
 * speaks for, and the voice (`@repo/features/voice-wire`). The caller must
 * reach the agent and be admitted to message it, as a typed message is
 * (`agents/agent-reach.ts`'s `controlsAgent` and `admitsPlanWriter`), and the agent must still
 * have a harness to answer it. The session is created on GPT-Live with the
 * caller's own OpenAI API key, as dictation's clip is
 * (`accounts/openai-key-middleware.ts`), never ours, and with the agent's
 * recent context in its instructions (`voice-instructions.ts`). The call
 * then gets its one row (`@repo/database/models/voice-calls`) at lease epoch
 * 1, and its first lease is published, whose holder attaches to the session
 * and holds the call from there to its close (`voice-call-lease.ts`); the
 * answer is the call's id and the SDP answer alone, so neither the key nor
 * the session's id leaves the service. A lease the queue did not take
 * leaves the call unheld, so its row is deleted and the call refused as
 * unavailable before the panel ever joins the session. Nothing of the
 * offer, the instructions, or the answer is stored, logged, or traced.
 *
 * The call ends when its session closes, which the panel asks of GPT-Live
 * itself; its seconds are kept by the lease that hears the close.
 *
 * `POST /api/voice/reconnect` carries a standing call on over a new peer
 * once the panel's failed after it had connected, as on a change of
 * network: GPT-Live documents no way to renegotiate a session's audio, so
 * the service opens a new session for the same call, on the same terms and
 * in the call's voice, told that the call dropped and handed its newest
 * lines. The call keeps its id, its row, and its lines: the row moves to the
 * new session under the next lease epoch, from the session the reconnect
 * read, so every lease on the old one is stale, and with how far into the
 * call the new session starts, so the new session's lines keep counting
 * from the call's start (`clock_base_ms`). The lease published for it closes
 * the old session and keeps its seconds before it holds the new one
 * (`voice-call-lease.ts`). A call no longer standing is refused as not
 * found, and the panel lets it go.
 */

import { readAgentRouting, readVisibleAgent } from "@repo/database/models/agent-store";
import { listCallLines, listRecentMessages } from "@repo/database/models/message-reads";
import { readTaskHeader } from "@repo/database/models/task-store";
import {
  deleteVoiceCall,
  insertVoiceCall,
  moveVoiceCall,
  readVoiceCall,
  type VoiceCallRow,
} from "@repo/database/models/voice-calls";
import { DEFAULT_LIVE_VOICE, type LiveVoice, LiveVoiceSchema } from "@repo/features/voices";
import { Clock, Effect, Option, type Redacted, Schema } from "effect";
import { openAiKeyMiddleware } from "../accounts/openai-key-middleware.js";
import { admitsPlanWriter, controlsAgent } from "../agents/agent-reach.js";
import { harnessOf } from "../agents/coder-host/native-runtime.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { createLiveSession } from "./live-session.js";
import { VOICE_CALL_LEASE } from "./voice-call-bounds.js";
import { type VoiceCallLeaseMessage, VoiceCallLeases } from "./voice-call-lease.js";
import { VOICE_CONTEXT, type VoiceContext, voiceInstructions } from "./voice-instructions.js";

const MS_PER_SECOND = 1_000;

export interface VoiceProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The agent the caller reaches by this id, and the harness it runs on, none where its session ended for good; not found for one they do not reach. */
const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, agentId: string) {
  const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, agentId));

  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(userId, agentId));

  if (Option.isNone(routing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return { agent: agent.value, harness: harnessOf(routing.value.runtime) };
});

/** What a session is opened for: the caller, their key, the agent, the voice, the peer's offer, and, for a call carried on after it dropped, that call. */
interface SessionAsk {
  readonly userId: string;
  readonly key: Redacted.Redacted;
  readonly agentId: string;
  readonly voice: LiveVoice;
  readonly offer: string;
  readonly dropped?: string;
}

/**
 * A GPT-Live session opened on the caller's own key for an agent they may
 * still message, its instructions written from the agent's recent context
 * and, for a call carried on, the call's lines so far.
 */
const openedSession = /* @__PURE__ */ Effect.fnUntraced(function* (ask: SessionAsk) {
  const { agent, harness } = yield* reachedAgent(ask.userId, ask.agentId);

  // Note that an agent whose session ended for good answers no message, so no call speaks for it.
  if (harness === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);

  // An agent on its starter's own GitHub token, or on its starter's Mac, takes words from its starter alone, as a typed message does.
  if (!controlsAgent(ask.userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);

  yield* admitsPlanWriter(ask.userId, agent);

  // Note that the conversation is read under the member who started the agent, as its transcript is.
  const recent = yield* hostedStoreOrUnavailable(
    listRecentMessages(agent.userId, agent.conversationId, CODER_TOOL_SET, VOICE_CONTEXT.READ),
  );

  const lines =
    ask.dropped === undefined
      ? undefined
      : yield* hostedStoreOrUnavailable(
          listCallLines(agent.userId, agent.conversationId, ask.dropped, CODER_TOOL_SET),
        );

  const task = yield* hostedStoreOrUnavailable(readTaskHeader(ask.userId, agent.taskId));

  const context: VoiceContext = {
    agent,
    taskName: Option.match(task, { onNone: () => "", onSome: (header) => header.name }),
    messages: recent.ok ? recent.value.map((record) => record.message) : [],
  };

  const instructions = voiceInstructions(
    lines === undefined
      ? context
      : { ...context, dropped: lines.ok ? lines.value.map((record) => record.message) : [] },
  );

  const created = yield* createLiveSession({
    key: ask.key,
    offer: ask.offer,
    voice: ask.voice,
    instructions,
  }).pipe(
    Effect.tapError((failed) =>
      Effect.logWarning(`The voice session failed with status ${failed.status ?? "none"}`),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );

  return { agent, created };
});

/** The call's next lease published; where the queue did not take it, the call's row deleted and the call refused as unavailable, since nothing would hold it. */
const publishedLease = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: VoiceCallRow,
  lease: VoiceCallLeaseMessage,
) {
  const leases = yield* VoiceCallLeases;

  yield* leases.publish(lease).pipe(
    Effect.tapError((failed) =>
      Effect.logWarning(`A voice call's lease was not published: ${failed.reason}`),
    ),
    Effect.catch(() =>
      Effect.andThen(
        hostedStoreOrUnavailable(deleteVoiceCall(call.callerId, call.id, call.liveSessionId)),
        Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
      ),
    ),
  );
});

/** The voice resource: a call's session opened to a signed-in caller, and its first lease published; or a standing call carried on over a new session. */
export function voiceProcedures(seams: VoiceProcedureSeams) {
  const signedIn = hosted.voice.use(accountMiddleware(seams.resolveUserId));

  return {
    open: signedIn.open.use(openAiKeyMiddleware).effect(function* ({ input, context }) {
      const { agent, created } = yield* openedSession({
        userId: context.userId,
        key: context.openAiKey,
        agentId: input.agentId,
        voice: input.voice,
        offer: input.sdp,
      });

      const now = yield* Clock.currentTimeMillis;

      const call = yield* hostedStoreOrUnavailable(
        insertVoiceCall({
          liveSessionId: created.sessionId,
          callerId: context.userId,
          agentId: agent.id,
          voice: input.voice,
          startedAt: new Date(now),
          leaseUntil: new Date(now + VOICE_CALL_LEASE.MAX_DURATION_SECONDS * MS_PER_SECOND),
        }),
      );

      yield* publishedLease(call, {
        callId: call.id,
        callerId: call.callerId,
        epoch: call.leaseEpoch,
      });

      return { callId: call.id, sdp: created.sdp };
    }),
    reconnect: signedIn.reconnect.use(openAiKeyMiddleware).effect(function* ({ input, context }) {
      const standing = yield* hostedStoreOrUnavailable(readVoiceCall(context.userId, input.callId));

      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const left = standing.value;

      const { created } = yield* openedSession({
        userId: context.userId,
        key: context.openAiKey,
        agentId: left.agentId,
        // Note that a voice no longer offered since the call opened is carried on in the default one.
        voice: Schema.is(LiveVoiceSchema)(left.voice) ? left.voice : DEFAULT_LIVE_VOICE,
        offer: input.sdp,
        dropped: left.id,
      });

      const now = yield* Clock.currentTimeMillis;

      const moved = yield* hostedStoreOrUnavailable(
        moveVoiceCall(left.callerId, left.id, left.liveSessionId, {
          liveSessionId: created.sessionId,
          clockBaseMs: now - left.startedAt.getTime(),
          leaseUntil: new Date(now + VOICE_CALL_LEASE.MAX_DURATION_SECONDS * MS_PER_SECOND),
        }),
      );

      // Note that a call that closed, or moved to another session, while this one opened is no longer the one this reconnect read.
      if (Option.isNone(moved)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const call = moved.value;

      yield* publishedLease(call, {
        callId: call.id,
        callerId: call.callerId,
        epoch: call.leaseEpoch,
        closes: left.liveSessionId,
      });

      return { sdp: created.sdp };
    }),
  };
}
