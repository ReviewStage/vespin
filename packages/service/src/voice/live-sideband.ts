/**
 * live-sideband.ts -- the service's own connection to a call's GPT-Live session: attached by the session's id on the caller's own key, read as the session's events in order.
 *
 * GPT-Live lets a trusted server attach to a session a client's WebRTC peer
 * opened (`wss://api.openai.com/v1/live/sessions/{id}/attach`, bearer the key
 * that created it). The sideband hears what the session says, delegations
 * and transcripts among it, which the panel's data channel is cut off from
 * (`live-session.ts`), and may send it the delegation appends, mute and
 * unmute, and `session.close`. Each attach first replays the session's last
 * few seconds of events, so two connections, one lease's and the next's, see
 * the same events under the same `event_id`s.
 *
 * Every event comes as one JSON text frame naming its `type` and `event_id`;
 * a frame that names neither is not an event and is dropped. The key is
 * revealed into the handshake's bearer header alone, and nothing a frame
 * carries is logged here, since transcripts carry the call's words; a
 * refused attach carries the status OpenAI answered and nothing it said.
 *
 * The attach is reached through `LiveSidebands`, a reference whose default is
 * the real one over `ws`, so a test hands the lease a fake session instead.
 */

import { readEither } from "@repo/wire/effect";
import {
  Context,
  Data,
  Effect,
  Option,
  Redacted,
  Result,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { WebSocket } from "ws";
import { EXCESS_KEYS, unparsedWire, valueFromJsonText, type WireValue } from "../core.js";
import { SOCKET_CLOSE_CODE, voiceSocket } from "../http/socket.js";
import { HOSTED_OPENAI_DEFAULTS } from "../providers/openai.js";
import { LIVE_SESSION } from "./live-session.js";

/** The session's events the lease reads, and the one it sends. */
export const LIVE_SIDEBAND_EVENT = {
  /** The session finished finalizing, with its cumulative audio seconds: the call is over. */
  CLOSED: "session.closed",
  /** Asks the session to close, sent only by a lease that cannot hand over. */
  CLOSE: "session.close",
} as const;

/** How long the attach's handshake may take before it counts as failed, so a stalled upstream fails the delivery for the queue to bring again. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** The statuses an attach is refused with for a while, which another attempt may get past; any other client error says the session will never be attached again. */
const PASSING_REFUSALS: ReadonlySet<number> = new Set([408, 429]);

/** What every event names: its type and its id, which a re-attach replays it under. */
const LiveEventHeadSchema = Schema.Struct({ type: Schema.String, event_id: Schema.String });

/** The close's one field read: the session's cumulative audio seconds. */
const SessionClosedSchema = Schema.Struct({
  type: Schema.Literal(LIVE_SIDEBAND_EVENT.CLOSED),
  usage: Schema.Struct({ seconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)) }),
});

/** One event the session said: its type, its id, and the whole of it, for a reader to decode what it needs. */
export interface LiveEvent {
  readonly type: string;
  readonly eventId: string;
  readonly body: WireValue;
}

/** One attached connection to a session: its events in order, ending once the connection closes, and a send. */
export interface LiveSideband {
  readonly events: Stream.Stream<LiveEvent>;
  readonly send: (event: { readonly type: string }) => Effect.Effect<void>;
}

/** The session would not be attached: refused with a status, or unanswered. */
export class SidebandRefused extends Data.TaggedError("SidebandRefused")<{
  readonly status: number | undefined;
}> {}

interface LiveSidebandsService {
  /** The session under the id attached on the key, for as long as the scope stands. */
  readonly attach: (
    sessionId: string,
    key: Redacted.Redacted,
  ) => Effect.Effect<LiveSideband, SidebandRefused, Scope.Scope>;
}

/** Whether a refused attach says the session is gone for good, as a closed or expired session's is, rather than for now. */
export function sessionGone(refused: SidebandRefused): boolean {
  const { status } = refused;

  return status !== undefined && status >= 400 && status < 500 && !PASSING_REFUSALS.has(status);
}

/** The seconds a `session.closed` carries; none for any other event. */
export function closedSeconds(event: LiveEvent): Option.Option<number> {
  const read = readEither(SessionClosedSchema, { excess: EXCESS_KEYS.DROP })(
    unparsedWire(event.body),
  );

  return Result.isSuccess(read) ? Option.some(read.success.usage.seconds) : Option.none();
}

/** One text frame read as an event; a frame that is not one reads as none. */
function eventOf(text: string): Option.Option<LiveEvent> {
  const body = valueFromJsonText(text);
  const head = readEither(LiveEventHeadSchema, { excess: EXCESS_KEYS.DROP })(unparsedWire(body));

  if (Result.isFailure(head)) return Option.none();

  return Option.some({ type: head.success.type, eventId: head.success.event_id, body });
}

function attachUrl(sessionId: string): string {
  const base = HOSTED_OPENAI_DEFAULTS.BASE_URL.replace(/^http/u, "ws");

  return `${base}${LIVE_SESSION.PATH}/${encodeURIComponent(sessionId)}/attach`;
}

/**
 * The socket once its handshake is through, paused, so not one frame the
 * replay sends lands before a reader stands; refused with the status the
 * upgrade was answered with, or none where it was not answered.
 */
function openedSocket(
  sessionId: string,
  key: Redacted.Redacted,
): Effect.Effect<WebSocket, SidebandRefused> {
  return Effect.callback<WebSocket, SidebandRefused>((resume) => {
    const socket = new WebSocket(attachUrl(sessionId), {
      headers: { Authorization: `Bearer ${Redacted.value(key)}` },
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
    });

    socket.once("open", () => {
      socket.pause();
      resume(Effect.succeed(socket));
    });
    socket.once("unexpected-response", (_request, response) => {
      socket.terminate();
      resume(Effect.fail(new SidebandRefused({ status: response.statusCode })));
    });
    socket.once("error", () => resume(Effect.fail(new SidebandRefused({ status: undefined }))));

    return Effect.sync(() => socket.terminate());
  });
}

/** The real attach: a `ws` connection, closed with the scope. */
const attachOverWs = (
  sessionId: string,
  key: Redacted.Redacted,
): Effect.Effect<LiveSideband, SidebandRefused, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(openedSocket(sessionId, key), (open) =>
      Effect.sync(() => open.close(SOCKET_CLOSE_CODE.NORMAL)),
    );

    const frames = yield* voiceSocket(socket);
    socket.resume();

    return {
      events: frames.frames.pipe(
        Stream.filterMap((frame) => {
          // A binary frame is no Live event.
          const event = "text" in frame ? eventOf(frame.text) : Option.none();

          return Option.isSome(event) ? Result.succeed(event.value) : Result.fail(undefined);
        }),
      ),
      send: (event) => frames.send({ text: JSON.stringify(event) }),
    };
  });

/** How a lease attaches to a session: over `ws` by default, as production has it; a test replaces it with a fake session. */
export const LiveSidebands = Context.Reference<LiveSidebandsService>(
  "@repo/service/LiveSidebands",
  { defaultValue: () => ({ attach: attachOverWs }) },
);
