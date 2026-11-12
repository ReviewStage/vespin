/**
 * voice-procedures.ts -- a voice call into an agent: its GPT-Live session opened on the caller's own OpenAI key, and its seconds kept once it ends.
 *
 * `POST /api/voice/session` takes the panel's SDP offer, the agent the call
 * speaks for, and the voice (`@repo/features/voice-wire`). The caller must
 * reach the agent and be admitted to message it, as a typed message is
 * (`agents/agent-reach.ts`'s `controlsAgent` and `admitsPlanWriter`), and the agent must still
 * have a harness to answer it. The session is created on GPT-Live with the
 * caller's own OpenAI API key, as dictation's clip is
 * (`accounts/openai-key-middleware.ts`), never ours, and with the agent's
 * recent context in its instructions (`voice-instructions.ts`); the answer is
 * the SDP answer alone, so the key never leaves the service. Nothing of the
 * offer, the instructions, or the answer is stored, logged, or traced.
 *
 * `POST /api/voice/calls` reports a finished call's seconds, as the panel
 * timed them, since the call ran between the panel and OpenAI and never
 * through here: they are added to the member's day beside dictation's
 * (`@repo/database/models/quota`), and the call is counted once, by its
 * length and the agent's harness alone. As with dictation, nothing is
 * refused on the meter, and a meter the database refused is logged and the
 * report still answered.
 */

import { readAgentRouting, readVisibleAgent } from "@repo/database/models/agent-store";
import { listRecentMessages } from "@repo/database/models/message-reads";
import { spendVoiceMeter } from "@repo/database/models/quota";
import { readTaskHeader } from "@repo/database/models/task-store";
import { Clock, Effect, Option } from "effect";
import { openAiKeyMiddleware } from "../accounts/openai-key-middleware.js";
import { admitsPlanWriter, controlsAgent } from "../agents/agent-reach.js";
import { harnessOf } from "../agents/coder-host/native-runtime.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { recordServerEvent, SERVER_EVENT, voiceCallDurationOf } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { createLiveSession } from "./live-session.js";
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

/** The voice resource: a call's session opened, and a finished call's seconds kept, each to a signed-in caller. */
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
        listRecentMessages(
          agent.userId,
          agent.conversationId,
          CODER_TOOL_SET,
          VOICE_CONTEXT.MESSAGES,
        ),
      );

      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, agent.taskId));

      const instructions = voiceInstructions({
        agent,
        taskName: Option.match(task, { onNone: () => "", onSome: (header) => header.name }),
        messages: recent.ok ? recent.value.map((record) => record.message) : [],
      });

      const sdp = yield* createLiveSession({
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

      return { sdp };
    }),

    ended: signedIn.ended.effect(function* ({ input, context }) {
      const { agent, harness } = yield* reachedAgent(context.userId, input.agentId);
      const now = yield* Clock.currentTimeMillis;

      yield* spendVoiceMeter({ userId: context.userId, seconds: input.seconds, now }).pipe(
        Effect.catch(logStoreFailure),
      );

      // Note that a call whose agent ended for good while it ran is metered but not counted, since it has no harness to count it by.
      if (harness !== undefined) {
        yield* recordServerEvent(
          SERVER_EVENT.VOICE_CALL,
          { userId: context.userId, workspaceId: agent.organizationId },
          { duration: voiceCallDurationOf(input.seconds * MS_PER_SECOND), harness },
        );
      }

      return { done: true } as const;
    }),
  };
}
