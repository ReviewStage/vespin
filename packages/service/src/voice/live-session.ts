/**
 * live-session.ts -- one GPT-Live session created from the caller's WebRTC offer, on the caller's own OpenAI API key.
 *
 * One JSON POST to `/live/sessions` with the session and the transport
 * (https://developers.openai.com/api/docs/guides/voice-webrtc?api=live): the
 * model, the instructions, the startup history, client delegation, because
 * the agent behind the call is its backend and nothing else may act, no
 * storage, the voice, standby, and the panel's data channel cut down to what
 * the panel does with it; and the panel's SDP offer as a `webrtc` transport.
 * No `audio.format`, because WebRTC negotiates its own.
 *
 * The startup history is `session.input`
 * (https://developers.openai.com/api/docs/guides/live-conversations#seed-a-session-with-prior-conversation):
 * text messages, each one text part, a user's as `input_text` and an
 * assistant's as `output_text`, within OpenAI's bounds of 128 messages and
 * 8,192 tokens together (`LIVE_INPUT`). OpenAI refuses a session past either
 * bound rather than cutting it (live-tested on `gpt-live-1.1`, Nov 19, 2026),
 * so the history is fitted to them before it is sent (`voice-instructions.ts`).
 *
 * Standby
 * (https://developers.openai.com/api/docs/guides/live-conversations#managing-idle-sessions)
 * waits for the caller's speech before inference starts, and pauses it again
 * after `IDLE_TIMEOUT_S` with no transcript, billed at the paused rate, with
 * the connection, the session's id, and the sideband all standing; the
 * caller's next words resume it. Only speech wakes it: nothing the sideband
 * sends does, and an append sent while it is paused waits, unsaid, for the
 * caller to speak. A delegation still unanswered holds inference running, so
 * the agent's reply to one is said as it comes, and only the reply to a turn
 * no delegation opened can find the voice paused (live-tested on
 * `gpt-live-1.1`, Nov 19, 2026). The sideband hears `session.paused` and
 * `session.resumed`, which the loop passes by as it does every event it does
 * not read, and the panel hears neither.
 *
 * The panel carries the call's audio and nothing
 * of its logic, which the service holds over its own sideband
 * (`live-sideband.ts`), unaffected by the allowlist: so the panel may send
 * only mute, unmute, and the close that ends the call, and hears only the
 * session's start and close and the mute acknowledgments, never a
 * delegation or a transcript. OpenAI answers the session's id, which the
 * sideband attaches by, and the SDP answer. The key is revealed into the
 * bearer header alone. Nothing of the exchange is logged here, since the
 * offer and the history carry the agent's words; a failure carries the
 * status OpenAI answered and nothing it said.
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

export const LIVE_SESSION = {
  /** GPT-Live-1.1, which takes the same session body and events as GPT-Live-1 and is told when to delegate in plain language (`voice-instructions.ts`). */
  MODEL: "gpt-live-1.1",
  PATH: "/live/sessions",
  TRANSPORT: "webrtc",
  DELEGATION: "client",
  /** Inference starts on the caller's speech, at the default threshold, and again after each pause. */
  WAKE_POLICY: "speech",
  /** The seconds with no transcript after which inference pauses (5 to 60): past a breath, so a silent call bills at the paused rate soon. */
  IDLE_TIMEOUT_S: 10,
} as const;

/**
 * OpenAI's bounds on a session's startup history, `session.input`
 * (https://developers.openai.com/api/docs/guides/live-conversations#seed-a-session-with-prior-conversation):
 * at most 128 messages and 8,192 tokens together. What a message's framing
 * counts toward those tokens is not documented; it was measured on
 * `gpt-live-1.1` (Nov 19, 2026), where one message holds 8,188 tokens of
 * text, and 128 messages hold 60 each but not 61: 4 a message.
 */
export const LIVE_INPUT = {
  MAX_MESSAGES: 128,
  MAX_TOKENS: 8_192,
  MESSAGE_FRAME_TOKENS: 4,
} as const;

/** The roles a startup message may take that the history uses: the caller's side and the voice's. */
export const LIVE_INPUT_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type LiveInputRole = (typeof LIVE_INPUT_ROLE)[keyof typeof LIVE_INPUT_ROLE];

/** The content part each role's text goes in. */
const LIVE_INPUT_CONTENT = {
  [LIVE_INPUT_ROLE.USER]: "input_text",
  [LIVE_INPUT_ROLE.ASSISTANT]: "output_text",
} as const;

/** One message of the startup history: its role and its one text part. */
export interface LiveInputMessage {
  readonly role: LiveInputRole;
  readonly text: string;
}

/** How long OpenAI is given to create the session before the call is answered as failed: inside the panel's held wait for the route. */
const CREATE_TIMEOUT = Duration.seconds(20);

/** A created session answers 201; any 2xx is read as one. */
const SUCCESS_STATUS = { LEAST: 200, MOST: 299 } as const;

/** What the panel's data channel may carry: the events it may send, and the events it hears. */
const PANEL_DATA_CHANNEL = {
  CLIENT_EVENTS: ["session.input_audio.mute", "session.input_audio.unmute", "session.close"],
  SERVER_EVENTS: [
    "session.started",
    "session.closed",
    "session.input_audio.muted",
    "session.input_audio.unmuted",
  ],
} as const;

/** The part of a created session read here: its id and the SDP answer. */
const LiveSessionAnswerSchema = Schema.Struct({
  session: Schema.Struct({ id: Schema.String.check(Schema.isNonEmpty()) }),
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
  /** Oldest first, within `LIVE_INPUT`. */
  readonly history: readonly LiveInputMessage[];
}

/** The body `POST /v1/live/sessions` takes: the session and the panel's SDP offer. */
function sessionBody(input: LiveSessionInput) {
  return {
    session: {
      model: LIVE_SESSION.MODEL,
      instructions: input.instructions,
      input: input.history.map((message) => ({
        type: "message",
        role: message.role,
        content: [{ type: LIVE_INPUT_CONTENT[message.role], text: message.text }],
      })),
      delegation: { type: LIVE_SESSION.DELEGATION },
      store: false,
      audio: { output: { voice: input.voice } },
      wake_policy: { type: LIVE_SESSION.WAKE_POLICY },
      idle_timeout_s: LIVE_SESSION.IDLE_TIMEOUT_S,
      client: {
        data_channel: {
          allowed_client_events: PANEL_DATA_CHANNEL.CLIENT_EVENTS,
          allowed_server_events: PANEL_DATA_CHANNEL.SERVER_EVENTS.map((type) => ({ type })),
        },
      },
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

/** A created session: its id, which only the service keeps, and the SDP answer the panel takes. */
export interface LiveSessionCreated {
  readonly sessionId: string;
  readonly sdp: string;
}

/** Creates one session over the ambient client and answers its id and SDP answer; a failure carries a status at most. */
export const createLiveSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  input: LiveSessionInput,
): Effect.fn.Return<LiveSessionCreated, LiveSessionFailed, HttpClient.HttpClient> {
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

  return { sessionId: read.success.session.id, sdp: read.success.transport.sdp };
});
