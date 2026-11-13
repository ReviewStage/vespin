/**
 * voice-wire.ts -- a voice call into an agent: the session the service opens on the caller's own OpenAI key, and the call's seconds once it ends.
 *
 * `POST /api/voice/session` takes the panel's WebRTC SDP offer, the agent
 * the call speaks for, and the voice it speaks in (`voices.ts`). The service
 * creates a GPT-Live session on the caller's own OpenAI API key, the one
 * dictation runs on, and answers the SDP answer alone: the key never leaves
 * the service, and the panel holds the call from there over WebRTC. A caller
 * with no OpenAI API key of their own is refused as missing one, as a
 * dictated clip is, and one who may not message the agent is refused as a
 * typed message to it would be.
 *
 * `POST /api/voice/calls` reports a finished call's seconds, which the
 * service adds to the member's day beside dictation's and counts once, by
 * its length alone. Nothing a call said is sent to either.
 */

import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { LiveVoiceSchema } from "./voices.js";

export const VOICE_BOUNDS = {
  /** The most characters an SDP offer may spell: a browser's offer for one audio track and a data channel runs a few thousand. */
  MAX_SDP_CHARS: 32_000,
  /** The longest call OpenAI holds open, two hours, which a reported call is held to. */
  MAX_CALL_SECONDS: 2 * 60 * 60,
} as const;

/** One call to open (POST): the agent it speaks for, the voice it speaks in, and the panel's SDP offer. */
export const voiceSessionRequestSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  voice: LiveVoiceSchema,
  sdp: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(VOICE_BOUNDS.MAX_SDP_CHARS),
  ),
});

export type VoiceSessionRequest = typeof voiceSessionRequestSchema.Type;

/** The opened call: the SDP answer the panel sets as its peer's remote description, and nothing else of the session. */
export const voiceSessionAnswerSchema = EffectSchema.Struct({
  sdp: EffectSchema.String,
});

export type VoiceSessionAnswer = typeof voiceSessionAnswerSchema.Type;

/** One finished call (POST): the agent it spoke for, and how many seconds it ran, as the panel timed it. */
export const voiceCallEndedRequestSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  seconds: countedNumber.check(EffectSchema.isLessThanOrEqualTo(VOICE_BOUNDS.MAX_CALL_SECONDS)),
});

export type VoiceCallEndedRequest = typeof voiceCallEndedRequestSchema.Type;

/** What a reported call answers once its seconds are kept: nothing a client needs to read. */
export const voiceCallEndedAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});
