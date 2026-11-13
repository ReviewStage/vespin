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
 */

import { readAgentRouting, readVisibleAgent } from "@repo/database/models/agent-store";
import { listRecentMessages } from "@repo/database/models/message-reads";
import { readTaskHeader } from "@repo/database/models/task-store";
import { deleteVoiceCall, insertVoiceCall } from "@repo/database/models/voice-calls";
import { Clock, Effect, Option } from "effect";
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
import { VoiceCallLeases } from "./voice-call-lease.js";
import { VOICE_CONTEXT, voiceInstructions } from "./voice-instructions.js";

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

/** The voice resource: a call's session opened to a signed-in caller, and its first lease published. */
export function voiceProcedures(seams: VoiceProcedureSeams) {
  const signedIn = hosted.voice.use(accountMiddleware(seams.resolveUserId));

  return {
    open: signedIn.open.use(openAiKeyMiddleware).effect(function* ({ input, context }) {
      const { agent, harness } = yield* reachedAgent(context.userId, input.agentId);

      // Note that an agent whose session ended for good answers no message, so no call speaks for it.
      if (harness === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);

      // An agent on its starter's own GitHub token, or on its starter's Mac, takes words from its starter alone, as a typed message does.
      if (!controlsAgent(context.userId, agent)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }

      yield* admitsPlanWriter(context.userId, agent);

      // Note that the conversation is read under the member who started the agent, as its transcript is.
      const recent = yield* hostedStoreOrUnavailable(
        listRecentMessages(agent.userId, agent.conversationId, CODER_TOOL_SET, VOICE_CONTEXT.READ),
      );

      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, agent.taskId));

      const instructions = voiceInstructions({
        agent,
        taskName: Option.match(task, { onNone: () => "", onSome: (header) => header.name }),
        messages: recent.ok ? recent.value.map((record) => record.message) : [],
      });

      const created = yield* createLiveSession({
        key: context.openAiKey,
        offer: input.sdp,
        voice: input.voice,
        instructions,
      }).pipe(
        Effect.tapError((failed) =>
          Effect.logWarning(`The voice session failed with status ${failed.status ?? "none"}`),
        ),
        Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
      );

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

      const leases = yield* VoiceCallLeases;

      yield* leases
        .publish({ callId: call.id, callerId: call.callerId, epoch: call.leaseEpoch })
        .pipe(
          Effect.tapError((failed) =>
            Effect.logWarning(`A voice call's first lease was not published: ${failed.reason}`),
          ),
          Effect.catch(() =>
            Effect.andThen(
              hostedStoreOrUnavailable(deleteVoiceCall(call.callerId, call.id)),
              Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
            ),
          ),
        );

      return { callId: call.id, sdp: created.sdp };
    }),
  };
}
