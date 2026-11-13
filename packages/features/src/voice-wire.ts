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
  /** The most characters a standing call's name or its agent's command is told in; the card cuts both to one line long before. */
  MAX_CARD_CHARS: 1_000,
} as const;

/** Where a call stands: connecting until the session says it started, live, then ending until its channel has closed. */
export const VOICE_CALL_STAGE = {
  CONNECTING: "connecting",
  LIVE: "live",
  ENDING: "ending",
} as const;

export type VoiceCallStage = (typeof VOICE_CALL_STAGE)[keyof typeof VOICE_CALL_STAGE];

const cardText = EffectSchema.String.check(EffectSchema.isMaxLength(VOICE_BOUNDS.MAX_CARD_CHARS));

/**
 * The call a window holds, as its card draws it wherever the window is not
 * in front: the agent and task it is about, its task's name (its agent's
 * where it has no task), where it stands, its two mutes, and what the agent
 * is doing, absent while it is idle, its command while it runs one. The
 * panel that holds the call tells the Mac this, and the floating call
 * window draws it and nothing else.
 */
export const standingCallSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  taskId: EffectSchema.String,
  name: cardText,
  stage: EffectSchema.Literals(Object.values(VOICE_CALL_STAGE)),
  microphoneMuted: EffectSchema.Boolean,
  speakerMuted: EffectSchema.Boolean,
  agent: EffectSchema.optionalKey(
    EffectSchema.Struct({ action: EffectSchema.optionalKey(cardText) }),
  ),
});

export type StandingCall = typeof standingCallSchema.Type;

/** A press on the floating call card: a mute set as it says, or End call, which the Mac hands to the window holding the call, or the way back to the call's agent, which the Mac opens itself. */
export const VOICE_CALL_PRESS = {
  MICROPHONE: "microphone",
  SPEAKER: "speaker",
  END: "end",
  OPEN: "open",
} as const;

export const voiceCallPressSchema = EffectSchema.Union([
  EffectSchema.Struct({
    press: EffectSchema.Literals([VOICE_CALL_PRESS.MICROPHONE, VOICE_CALL_PRESS.SPEAKER]),
    muted: EffectSchema.Boolean,
  }),
  EffectSchema.Struct({
    press: EffectSchema.Literals([VOICE_CALL_PRESS.END, VOICE_CALL_PRESS.OPEN]),
  }),
]);

export type VoiceCallPress = typeof voiceCallPressSchema.Type;

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
