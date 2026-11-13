/**
 * live-session.ts -- one GPT-Live session created from the caller's WebRTC offer, on the caller's own OpenAI API key.
 *
 * One JSON POST to `/live/sessions` with the session and the transport
 * (https://developers.openai.com/api/docs/guides/voice-webrtc?api=live): the
 * model, the instructions, client delegation, because the agent behind the
 * panel is the call's backend and nothing else may act, no storage, and the
 * voice; and the panel's SDP offer as a `webrtc` transport. No `audio.format`,
 * because WebRTC negotiates its own, and no data-channel allowlist, because
 * the panel is the call's only client and appends the agent's progress over
 * that channel itself. OpenAI answers the session's id and the SDP answer;
 * the SDP answer is all that is read. The key is revealed into the bearer
 * header alone. Nothing of the exchange is logged here, since the offer and
 * the instructions carry the agent's words; a failure carries the status
 * OpenAI answered and nothing it said.
 */

import type { LiveVoice } from "@repo/features/voices";
import { readEither } from "@repo/wire/effect";
import { Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";
import { HOSTED_OPENAI_DEFAULTS } from "../providers/openai.js";

const LIVE_SESSION = {
  MODEL: "gpt-live-1",
  PATH: "/live/sessions",
  TRANSPORT: "webrtc",
  DELEGATION: "client",
} as const;

/** How long OpenAI is given to create the session before the call is answered as failed: inside the panel's held wait for the route. */
const CREATE_TIMEOUT = Duration.seconds(20);

/** A created session answers 201; any 2xx is read as one. */
const SUCCESS_STATUS = { LEAST: 200, MOST: 299 } as const;

/** The part of a created session read here: the SDP answer. OpenAI names more (the session's id), which is dropped unread. */
const LiveSessionAnswerSchema = Schema.Struct({
  transport: Schema.Struct({
    type: Schema.Literal(LIVE_SESSION.TRANSPORT),
    sdp: Schema.String.check(Schema.isNonEmpty()),
  }),
});

/** The session was not created: refused with a status, unanswered, or answered with no SDP. */
export class LiveSessionFailed extends Data.TaggedError("LiveSessionFailed")<{
  readonly status: number | undefined;
}> {}

export interface LiveSessionInput {
  readonly key: Redacted.Redacted;
  readonly offer: string;
  readonly voice: LiveVoice;
  readonly instructions: string;
}

/** The body `POST /v1/live/sessions` takes: the session and the panel's SDP offer. */
function sessionBody(input: LiveSessionInput) {
  return {
    session: {
      model: LIVE_SESSION.MODEL,
      instructions: input.instructions,
      delegation: { type: LIVE_SESSION.DELEGATION },
      store: false,
      audio: { output: { voice: input.voice } },
    },
    transport: { type: LIVE_SESSION.TRANSPORT, sdp: input.offer },
  };
}

function sessionRequest(input: LiveSessionInput): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.post(`${HOSTED_OPENAI_DEFAULTS.BASE_URL}${LIVE_SESSION.PATH}`).pipe(
    HttpClientRequest.bearerToken(Redacted.value(input.key)),
    HttpClientRequest.bodyJsonUnsafe(sessionBody(input)),
  );
}

/** What OpenAI answered: its status, and its body where it created the session; a refusal's body is never read. */
interface SessionReply {
  readonly status: number;
  readonly body: UnparsedWireValue;
}

function replyOf(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<SessionReply, HttpClientError.HttpClientError> {
  if (response.status < SUCCESS_STATUS.LEAST || response.status > SUCCESS_STATUS.MOST) {
    return Effect.succeed({ status: response.status, body: unparsedWire(undefined) });
  }

  return Effect.map(response.json, (body) => ({
    status: response.status,
    body: unparsedWire(body),
  }));
}

/** Creates one session over the ambient client and answers its SDP answer; a failure carries a status at most. */
export const createLiveSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  input: LiveSessionInput,
): Effect.fn.Return<string, LiveSessionFailed, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;

  // A request that failed or timed out is no answer, and its cause is dropped unread.
  const answered = yield* client.execute(sessionRequest(input)).pipe(
    Effect.flatMap((response) => replyOf(response)),
    Effect.scoped,
    Effect.timeout(CREATE_TIMEOUT),
    Effect.option,
  );

  if (Option.isNone(answered)) return yield* new LiveSessionFailed({ status: undefined });
  const { status, body } = answered.value;
  const read = readEither(LiveSessionAnswerSchema, { excess: EXCESS_KEYS.DROP })(body);

  if (Result.isFailure(read)) return yield* new LiveSessionFailed({ status });

  return read.success.transport.sdp;
});
