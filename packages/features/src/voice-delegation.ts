/**
 * voice-delegation.ts -- a voice call's delegation loop: what GPT-Live hands on goes to the agent, and what the agent does goes back to the voice.
 *
 * GPT-Live runs with client delegation: it listens and speaks, and on each
 * request it decides is work it raises `session.delegation.created`, which
 * names the delegation and carries none of the words. The words are the
 * caller's own transcript (`session.input_transcript.delta`), so a
 * delegation takes everything heard since the one before it and hands it to
 * the agent as one message, under the delegation's id. While the agent
 * stands idle the message is sent and opens its turn; while a turn runs it
 * is queued, and the service's own queue holds it and hands it on once the
 * turn is over (`agent-queue-wire.ts`), so no second queue stands here.
 *
 * What the agent does goes back as context appends, each within GPT-Live's
 * 500 tokens, held as 500 UTF-8 bytes: a tool's progress as quiet thinking,
 * each finished reply as commentary the voice says in its own words, split
 * at its sentences into a few appends on the one delegation, as GPT-Live
 * takes several, and a line the caller typed during the call as thinking, since the agent has it already through the ordinary send. An
 * append names the delegation the turn answers, or none for a turn no
 * delegation opened.
 *
 * The loop is a stream over one input of all three sources, and holds no
 * socket, peer, or send of its own: the panel and the iOS app each feed it
 * from their own data channel and transcript, and deliver what it answers.
 * It ends with the session (`session.closed`) or with its input.
 */

import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result, Schema, Stream } from "effect";

/** GPT-Live's server events the loop reads; every other one passes it by. */
export const LIVE_SERVER_EVENT = {
  INPUT_TRANSCRIPT_DELTA: "session.input_transcript.delta",
  DELEGATION_CREATED: "session.delegation.created",
  CLOSED: "session.closed",
} as const;

/** GPT-Live's client events the loop answers with. */
export const LIVE_CLIENT_EVENT = {
  /** Context the voice may use later without saying it on arrival. */
  THINKING_APPEND: "session.thinking.append",
  /** Context the voice says aloud, in its own words. */
  COMMENTARY_APPEND: "session.commentary.append",
} as const;

/**
 * The most UTF-8 bytes one append's content holds: GPT-Live bounds it at 500
 * tokens, and with no tokenizer in the client the bytes are the bound that
 * holds, since OpenAI's tokenizers are byte-level BPE and no token covers
 * less than one byte. Paths, digits, code, and other scripts spell fewer
 * bytes a token than English prose, and an append over the bound is refused.
 */
const LIVE_APPEND_MAX_BYTES = 500;

/** How many commentary appends one reply is said in at most: its opening, about 250 words of English, never the whole of a long reply. */
const REPLY_MAX_APPENDS = 4;

/** Where an input to the loop came from: GPT-Live's data channel, the agent's transcript, or the caller's composer. */
export const VOICE_INPUT = {
  LIVE: "live",
  AGENT: "agent",
  TYPED: "typed",
} as const;

/** What the agent's transcript says of its turn, as the caller follows it. */
export const AGENT_TURN = {
  STARTED: "started",
  /** A tool call under way, by the words its row draws (such as "Running pnpm test"). */
  PROGRESS: "progress",
  /** A reply the agent finished writing. */
  REPLY: "reply",
  ENDED: "ended",
} as const;

export type AgentTurnEvent =
  | {
      readonly kind: typeof AGENT_TURN.STARTED;
      /** The delegation whose message opened the turn, as its row's metadata names it; absent for a turn no delegation opened. */
      readonly delegationId?: string;
    }
  | { readonly kind: typeof AGENT_TURN.PROGRESS; readonly step: string }
  | { readonly kind: typeof AGENT_TURN.REPLY; readonly text: string }
  | { readonly kind: typeof AGENT_TURN.ENDED };

export type VoiceInput =
  /** One message off GPT-Live's data channel, as the text it arrived as. */
  | { readonly from: typeof VOICE_INPUT.LIVE; readonly text: string }
  | { readonly from: typeof VOICE_INPUT.AGENT; readonly event: AgentTurnEvent }
  /** A line the caller typed and sent to the agent during the call. */
  | { readonly from: typeof VOICE_INPUT.TYPED; readonly text: string };

/** What the loop asks of its caller: send a message to the agent, queue one behind its turn, or tell the voice. */
export const VOICE_OUTPUT = {
  SEND: "send",
  QUEUE: "queue",
  TELL: "tell",
} as const;

/** A client event for GPT-Live's data channel, sent as its JSON. */
export interface LiveAppend {
  readonly type: (typeof LIVE_CLIENT_EVENT)[keyof typeof LIVE_CLIENT_EVENT];
  /** The delegation it answers, or null for the session's general context. */
  readonly delegation_id: string | null;
  readonly content: string;
}

export type VoiceOutput =
  | {
      readonly kind: typeof VOICE_OUTPUT.SEND | typeof VOICE_OUTPUT.QUEUE;
      /** What was said since the delegation before, as the agent's message. */
      readonly text: string;
      readonly delegationId: string;
    }
  | { readonly kind: typeof VOICE_OUTPUT.TELL; readonly event: LiveAppend };

/** Where the call stands at its start: whether the agent's turn runs already. */
export interface VoiceCallStart {
  readonly agentWorking: boolean;
}

const liveServerEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA),
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.DELEGATION_CREATED),
    delegation: Schema.Struct({ id: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal(LIVE_SERVER_EVENT.CLOSED) }),
]);

type LiveServerEvent = typeof liveServerEventSchema.Type;

const readLiveEvent = readEither(Schema.fromJsonString(liveServerEventSchema), {
  excess: EXCESS_KEYS.DROP,
});

/** What the loop keeps between inputs. */
interface VoiceState {
  /** The caller's words heard since the last delegation took them. */
  readonly heard: string;
  /** Whether the agent's turn runs, so a delegation is queued rather than sent. */
  readonly working: boolean;
  /** The delegation the running turn answers, or null for a turn none opened. */
  readonly answering: string | null;
}

/** An input as the loop reads it, GPT-Live's text parsed. */
type ReadInput =
  | { readonly from: typeof VOICE_INPUT.LIVE; readonly event: LiveServerEvent }
  | Exclude<VoiceInput, { readonly from: typeof VOICE_INPUT.LIVE }>;

const SENTENCES = new Intl.Segmenter("en", { granularity: "sentence" });

const WORDS = new Intl.Segmenter("en", { granularity: "word" });

const UTF8 = new TextEncoder();

const ELLIPSIS = "…";

function bytesOf(text: string): number {
  return UTF8.encode(text).length;
}

/** The longest run of the pieces, from the first, whose UTF-8 bytes fit the bound. */
function prefixWithin(pieces: Iterable<string>, maxBytes: number): string {
  let kept = "";

  for (const piece of pieces) {
    if (bytesOf(kept + piece) > maxBytes) break;
    kept += piece;
  }

  return kept;
}

function segmentsOf(segmenter: Intl.Segmenter, text: string): Iterable<string> {
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

/** One sentence too long alone, cut to the bound: its words, or for one word too long alone its characters, and an ellipsis counted inside it. */
function cutWithin(sentence: string, maxBytes: number): string {
  const room = maxBytes - bytesOf(ELLIPSIS);
  const words = prefixWithin(segmentsOf(WORDS, sentence.trim()), room);
  const cut = words === "" ? prefixWithin(sentence.trim(), room) : words;

  return `${cut.trimEnd()}${ELLIPSIS}`;
}

/**
 * The text as at most the given number of pieces within the bound in UTF-8
 * bytes, in order from its opening: whole sentences gathered into each, a
 * sentence too long alone cut as a piece of its own, and what is left past
 * the last piece dropped.
 */
function piecesWithin(text: string, maxBytes: number, maxPieces: number): readonly string[] {
  const pieces: string[] = [];
  let piece = "";

  for (const sentence of segmentsOf(SENTENCES, text.trim())) {
    if (bytesOf(piece + sentence) <= maxBytes) {
      piece += sentence;
      continue;
    }

    if (piece !== "") pieces.push(piece.trimEnd());
    piece = sentence;

    if (bytesOf(sentence) > maxBytes) {
      pieces.push(cutWithin(sentence, maxBytes));
      piece = "";
    }

    if (pieces.length >= maxPieces) break;
  }

  if (piece.trim() !== "") pieces.push(piece.trimEnd());

  return pieces.slice(0, maxPieces);
}

/** The appends that tell the voice the content, at most the number given, each within GPT-Live's bound. */
function tell(
  type: LiveAppend["type"],
  delegationId: string | null,
  content: string,
  maxAppends = 1,
): readonly VoiceOutput[] {
  return piecesWithin(content, LIVE_APPEND_MAX_BYTES, maxAppends).map((piece) => ({
    kind: VOICE_OUTPUT.TELL,
    event: { type, delegation_id: delegationId, content: piece },
  }));
}

type Step = readonly [VoiceState, readonly VoiceOutput[]];

/** A delegation takes what was heard since the one before: sent to an idle agent, which opens its turn, or queued behind a running one. */
function delegated(state: VoiceState, delegationId: string): Step {
  const text = state.heard.trim();

  // Note that a delegation raised before any of its words were transcribed
  // hands nothing on, and its words go with the next one, because the
  // service refuses a message with no words.
  if (text === "") {
    return [
      state,
      tell(
        LIVE_CLIENT_EVENT.THINKING_APPEND,
        delegationId,
        "Nothing was transcribed for this request yet, so it was not passed to the agent.",
      ),
    ];
  }

  if (state.working) {
    return [{ ...state, heard: "" }, [{ kind: VOICE_OUTPUT.QUEUE, text, delegationId }]];
  }

  return [
    { ...state, heard: "", working: true, answering: delegationId },
    [{ kind: VOICE_OUTPUT.SEND, text, delegationId }],
  ];
}

function heardLive(state: VoiceState, event: LiveServerEvent): Step {
  switch (event.type) {
    case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
      return [{ ...state, heard: state.heard + event.delta }, []];
    case LIVE_SERVER_EVENT.DELEGATION_CREATED:
      return delegated(state, event.delegation.id);
    case LIVE_SERVER_EVENT.CLOSED:
      return [state, []];
  }
}

function followedAgent(state: VoiceState, event: AgentTurnEvent): Step {
  switch (event.kind) {
    // Note that a turn whose opening line names no delegation keeps the one
    // just sent, since that send is what opened it; a turn's end clears it.
    case AGENT_TURN.STARTED:
      return [{ ...state, working: true, answering: event.delegationId ?? state.answering }, []];
    case AGENT_TURN.PROGRESS:
      return [state, tell(LIVE_CLIENT_EVENT.THINKING_APPEND, state.answering, event.step)];
    case AGENT_TURN.REPLY:
      return [
        state,
        tell(LIVE_CLIENT_EVENT.COMMENTARY_APPEND, state.answering, event.text, REPLY_MAX_APPENDS),
      ];
    case AGENT_TURN.ENDED:
      return [{ ...state, working: false, answering: null }, []];
  }
}

/** An input read: GPT-Live's text parsed, or nothing for an event the loop passes by. */
function readInput(input: VoiceInput): ReadInput | undefined {
  if (input.from !== VOICE_INPUT.LIVE) return input;
  const event = Result.getOrUndefined(readLiveEvent(unparsedWire(input.text)));

  return event === undefined ? undefined : { from: VOICE_INPUT.LIVE, event };
}

function stepped(state: VoiceState, input: ReadInput): Step {
  switch (input.from) {
    case VOICE_INPUT.LIVE:
      return heardLive(state, input.event);
    case VOICE_INPUT.AGENT:
      return followedAgent(state, input.event);
    case VOICE_INPUT.TYPED:
      return [
        state,
        tell(
          LIVE_CLIENT_EVENT.THINKING_APPEND,
          null,
          `The caller typed to the agent: ${input.text}`,
        ),
      ];
  }
}

/**
 * The delegation loop over a call's inputs, merged into one stream by the
 * caller, answering what to send the agent and what to tell the voice, in
 * order; it ends once GPT-Live closes the session or the input ends.
 */
export function voiceDelegations<E, R>(
  inputs: Stream.Stream<VoiceInput, E, R>,
  start: VoiceCallStart,
): Stream.Stream<VoiceOutput, E, R> {
  const initial: VoiceState = { heard: "", working: start.agentWorking, answering: null };

  return inputs.pipe(
    Stream.map(readInput),
    Stream.filter((input): input is ReadInput => input !== undefined),
    Stream.takeUntil(
      (input) => input.from === VOICE_INPUT.LIVE && input.event.type === LIVE_SERVER_EVENT.CLOSED,
      { excludeLast: true },
    ),
    Stream.mapAccum(() => initial, stepped),
  );
}
