/**
 * voice-wire.ts -- a voice call into an agent: the session the service opens on the caller's own OpenAI key.
 *
 * `POST /api/voice/session` takes the panel's WebRTC SDP offer, the agent
 * the call speaks for, and the voice it speaks in (`voices.ts`). The service
 * creates a GPT-Live session on the caller's own OpenAI API key, the one
 * dictation runs on, and answers the call's id and the SDP answer alone: the
 * key and the session's id never leave the service. The panel carries the
 * call's audio from there over WebRTC, and may send GPT-Live only mute,
 * unmute, and `session.close`, which is how the caller ends the call; the
 * service holds the rest of the call over its own connection to the session,
 * and keeps the call's seconds once it closes. A caller with no OpenAI API
 * key of their own is refused as missing one, as a dictated clip is, and one
 * who may not message the agent is refused as a typed message to it would be.
 */

import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";
import { LiveVoiceSchema } from "./voices.js";

export const VOICE_BOUNDS = {
  /** The most characters an SDP offer may spell: a browser's offer for one audio track and a data channel runs a few thousand. */
  MAX_SDP_CHARS: 32_000,
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

/** The opened call: its id, and the SDP answer the panel sets as its peer's remote description; nothing else of the session. */
export const voiceSessionAnswerSchema = EffectSchema.Struct({
  callId: wireUuidSchema,
  sdp: EffectSchema.String,
});

export type VoiceSessionAnswer = typeof voiceSessionAnswerSchema.Type;
