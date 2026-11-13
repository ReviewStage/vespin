/**
 * voice.ts -- a voice call into an agent (`voice-wire.ts`): its session opened on the caller's own OpenAI key.
 *
 * Beyond what any procedure may refuse, a call is refused where the account
 * saved no OpenAI key to speak on, where the agent is none the caller
 * reaches, where the caller may not message it, and where its session
 * ended for good. A reconnect is refused the same ways, and as not found
 * where the call is no longer standing.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  VOICE_BOUNDS,
  voiceReconnectAnswerSchema,
  voiceReconnectRequestSchema,
  voiceSessionAnswerSchema,
  voiceSessionRequestSchema,
} from "../voice-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** An offer at JSON's widest escape, six bytes to a character, and room for the keys around it. */
const SESSION_BODY_BYTES = 6 * VOICE_BOUNDS.MAX_SDP_CHARS + 1_024;

export const voiceContract = {
  open: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.OPENAI_KEY_MISSING,
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.AGENT_RETIRED,
      ),
    )
    .meta(bodyCap(SESSION_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.VOICE_SESSION }))
    .input(exactInput(voiceSessionRequestSchema))
    .output(EffectSchema.flip(voiceSessionAnswerSchema)),
  reconnect: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.OPENAI_KEY_MISSING,
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.AGENT_RETIRED,
      ),
    )
    .meta(bodyCap(SESSION_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.VOICE_RECONNECT }))
    .input(exactInput(voiceReconnectRequestSchema))
    .output(EffectSchema.flip(voiceReconnectAnswerSchema)),
};
