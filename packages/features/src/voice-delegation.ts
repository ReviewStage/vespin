/**
 * voice-delegation.ts -- a voice call's delegation loop: what GPT-Live hands on goes to the agent, and what the agent does goes back to the voice.
 *
 * GPT-Live runs with client delegation: it listens and speaks, and on each
 * request it decides is work it raises `session.delegation.created`, which
 * names the delegation and carries none of the words. The words are the
 * caller's own transcript (`session.input_transcript.delta`), and what the
 * voice says is its own (`session.output_transcript.delta`).
 *
 * Both sides are kept as text, one line to each utterance, recorded under an
 * id the loop derives from the event its first fragment came in (`lineId`),
 * since GPT-Live's deltas carry no item id and no event ends an utterance:
 * only a fragment and its interval on the session's timeline. An utterance is one speaker's run of fragments: it ends where
 * the other speaker starts, where a delegation takes the caller's words, or
 * after a silence of more than `SILENCE_SPLIT_MS`. A fragment that started
 * before the other speaker's open utterance did is a late one, as the
 * caller's transcript lags the audio, and grows its own speaker's last line
 * instead. A line is recorded as it opens, so the rows stand in the order
 * they were said, and again each time a fragment grows it, under the same
 * id, with the span it was said over and the event it took last, which the
 * service writes in place, so the stored lines are all a later holder of
 * the call needs to go on from.
 *
 * A delegation hands the agent the caller's lines since the one before it,
 * by their ids, so the service starts the turn on the rows already written
 * rather than writing the words again. While the agent stands idle the
 * message is sent and opens its turn; while a turn runs it is queued, and
 * the service's own queue holds it and hands it on once the turn is over
 * (`agent-queue-wire.ts`), so no second queue stands here. A line a
 * delegation took grows no more: a late fragment of it opens a line of its
 * own, which goes with the next delegation.
 *
 * What the agent does goes back as context appends, each within GPT-Live's
 * 500 tokens, held as 500 UTF-8 bytes: a tool's progress as quiet thinking,
 * and each finished reply as commentary the voice says in its own words,
 * split at its sentences into a few appends on the one delegation, as
 * GPT-Live takes several. An append names the delegation the turn answers,
 * or none for a turn no delegation opened. A line the caller types during
 * the call reaches the agent the ordinary way, and the voice hears of it
 * only through the turn it opens.
 *
 * The loop holds no socket, send, or store of its own: the service's holder
 * of the call feeds it the session's events and the agent's turn, one input
 * at a time, and carries out what it answers (`voice-call-delegations.ts`).
 * A holder that takes the call over from another starts it from the call's
 * stored lines and the delegations already handed on, and the session
 * replays its last few seconds to it: a replayed fragment its speaker's
 * stored line took already, and a delegation handed on already, are passed
 * by. It ends with the session (`session.closed`) or with its input.
 */

import { EXCESS_KEYS, unparsedWire, type WireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result, Schema, Stream } from "effect";
import { VOICE_SPEAKER, type VoiceSpeaker } from "./agent-wire.js";

/** GPT-Live's server events the loop reads; every other one passes it by. */
export const LIVE_SERVER_EVENT = {
  INPUT_TRANSCRIPT_DELTA: "session.input_transcript.delta",
  OUTPUT_TRANSCRIPT_DELTA: "session.output_transcript.delta",
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

/** The longest silence on the session's timeline inside one speaker's line; a longer one starts a new line, so a long monologue reads as paragraphs. */
const SILENCE_SPLIT_MS = 3000;

/** Where an input to the loop came from: GPT-Live's session, or the agent's transcript. */
export const VOICE_INPUT = {
  LIVE: "live",
  AGENT: "agent",
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
  /** One event GPT-Live's session said, whole, its `event_id` among it. */
  | { readonly from: typeof VOICE_INPUT.LIVE; readonly body: WireValue }
  | { readonly from: typeof VOICE_INPUT.AGENT; readonly event: AgentTurnEvent };

/** What the loop asks of its caller: record a line of the call, send a message to the agent, queue one behind its turn, or tell the voice. */
export const VOICE_OUTPUT = {
  RECORD: "record",
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
      /** A line of the call as it stands, written under its id once and grown in place after. */
      readonly kind: typeof VOICE_OUTPUT.RECORD;
      readonly speaker: VoiceSpeaker;
      readonly id: string;
      readonly text: string;
      /** The span of the session's timeline it was said over, where GPT-Live named it. */
      readonly fromMs: number | undefined;
      readonly toMs: number | undefined;
      /** The event whose fragment it took last. */
      readonly eventId: string;
    }
  | {
      readonly kind: typeof VOICE_OUTPUT.SEND | typeof VOICE_OUTPUT.QUEUE;
      /** What was said since the delegation before, as the agent's message: the words of the lines it names. */
      readonly text: string;
      readonly delegationId: string;
      /** The caller's lines the message is, by the ids they were recorded under, oldest first. */
      readonly lines: readonly string[];
    }
  | { readonly kind: typeof VOICE_OUTPUT.TELL; readonly event: LiveAppend };

/** A line of the call as the service stored it, for a holder that takes the call over. */
export interface StoredVoiceLine {
  readonly speaker: VoiceSpeaker;
  readonly id: string;
  readonly text: string;
  readonly fromMs: number | undefined;
  readonly toMs: number | undefined;
  /** The event whose fragment it took last, where one is named. */
  readonly eventId: string | undefined;
  /** Whether a delegation took it, for a caller's line. */
  readonly delegated: boolean;
}

/**
 * Where the call stands at its start: whether the agent's turn runs already,
 * and the delegation it answers; how a line's id is derived from the event
 * its first fragment came in, since GPT-Live names none; and, for a holder
 * taking the call over, its lines as stored, oldest first, and the
 * delegations already handed on.
 */
export interface VoiceCallStart {
  readonly agentWorking: boolean;
  readonly answering: string | null;
  readonly lineId: (eventId: string) => string;
  readonly lines: readonly StoredVoiceLine[];
  readonly delegations: ReadonlySet<string>;
}

/** A transcript fragment's interval on the session's timeline, in milliseconds, where GPT-Live names it. */
const fragmentSpan = {
  start_ms: Schema.optionalKey(Schema.Finite),
  end_ms: Schema.optionalKey(Schema.Finite),
};

const liveServerEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA),
    event_id: Schema.String,
    delta: Schema.String,
    ...fragmentSpan,
  }),
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA),
    event_id: Schema.String,
    delta: Schema.String,
    ...fragmentSpan,
  }),
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.DELEGATION_CREATED),
    delegation: Schema.Struct({ id: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal(LIVE_SERVER_EVENT.CLOSED) }),
]);

type LiveServerEvent = typeof liveServerEventSchema.Type;

const readLiveEvent = readEither(liveServerEventSchema, { excess: EXCESS_KEYS.DROP });

/** One line of the call: its id, its words so far, the words last recorded, its interval on the session's timeline, and the event it took last. */
interface Line {
  readonly speaker: VoiceSpeaker;
  readonly id: string;
  readonly text: string;
  readonly recorded: string;
  readonly startMs: number | undefined;
  readonly endMs: number | undefined;
  readonly eventId: string;
}

/** Where a speaker's stored line stood as this holder took the call: the event it took last, and where it ended. */
interface Resume {
  readonly eventId: string;
  readonly endMs: number | undefined;
}

/** What the loop keeps between inputs. */
interface VoiceState {
  readonly lineId: (eventId: string) => string;
  /** Each speaker's stored line, whose replayed fragments are passed by until its event goes by; none once it has, or where none was stored. */
  readonly resuming: { readonly [speaker in VoiceSpeaker]: Resume | undefined };
  /** The delegations handed on before this holder took the call, which a replay raises again. */
  readonly handedOn: ReadonlySet<string>;
  /** The caller's lines since the last delegation took them, oldest first; the last grows. */
  readonly heard: readonly Line[];
  /** The voice's latest line, which grows. */
  readonly voiced: Line | undefined;
  /** The speaker whose line is open, or null where none is. */
  readonly open: VoiceSpeaker | null;
  /** Whether the agent's turn runs, so a delegation is queued rather than sent. */
  readonly working: boolean;
  /** The delegation the running turn answers, or null for a turn none opened. */
  readonly answering: string | null;
}

/** An input as the loop reads it, GPT-Live's event read. */
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

const SPEAKER_OF_DELTA = {
  [LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA]: VOICE_SPEAKER.CALLER,
  [LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA]: VOICE_SPEAKER.VOICE,
} as const;

type TranscriptDelta = Extract<
  LiveServerEvent,
  {
    readonly type:
      | typeof LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA
      | typeof LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA;
  }
>;

/** The line recorded as it stands, or nothing where its words are what was recorded last. */
function recorded(line: Line): readonly [Line, readonly VoiceOutput[]] {
  const text = line.text.trim();

  if (text === "" || text === line.recorded) return [line, []];

  return [
    { ...line, recorded: text },
    [
      {
        kind: VOICE_OUTPUT.RECORD,
        speaker: line.speaker,
        id: line.id,
        text,
        fromMs: line.startMs,
        toMs: line.endMs,
        eventId: line.eventId,
      },
    ],
  ];
}

/** The speaker's line that grows: the caller's last one no delegation took, or the voice's latest. */
function growingLine(state: VoiceState, speaker: VoiceSpeaker): Line | undefined {
  return speaker === VOICE_SPEAKER.CALLER ? state.heard.at(-1) : state.voiced;
}

/** The state with the speaker's growing line put in place. */
function withLine(state: VoiceState, line: Line, opened: boolean): VoiceState {
  if (line.speaker === VOICE_SPEAKER.VOICE) return { ...state, voiced: line };

  return { ...state, heard: opened ? [...state.heard, line] : [...state.heard.slice(0, -1), line] };
}

/** The state as it stands, answering nothing. */
function stood(state: VoiceState): Step {
  return [state, []];
}

/** The open line closed and recorded as it stands, where one is open. */
function closedOpen(state: VoiceState): Step {
  const line = state.open === null ? undefined : growingLine(state, state.open);

  if (line === undefined) return [{ ...state, open: null }, []];
  const [kept, outputs] = recorded(line);

  return [{ ...withLine(state, kept, false), open: null }, outputs];
}

/**
 * Whether a fragment is one the speaker's stored line took already, as the
 * session replays its last few seconds to a holder taking the call over:
 * every fragment of the speaker's before the event that line took last, and
 * that event itself. Note that event ids say nothing of order, so a fragment
 * that ends after the stored line did is new however it came, because the
 * line's end is the latest end of every fragment it took; that is what lets
 * a holder go on where the stored event was said before the replay began.
 */
function replayed(resume: Resume, eventId: string, endMs: number | undefined): boolean {
  if (eventId === resume.eventId) return true;

  return endMs !== undefined && resume.endMs !== undefined && endMs <= resume.endMs;
}

/** The later of two ends, or whichever is known. */
function laterEnd(standing: number | undefined, given: number | undefined): number | undefined {
  return standing === undefined || given === undefined
    ? (standing ?? given)
    : Math.max(standing, given);
}

/**
 * Where a fragment goes: nowhere where its speaker's stored line took it
 * already (`replayed`); onto its speaker's growing line where no long
 * silence came before the fragment, while that line is open or where the
 * other speaker's line is open and began after the fragment did, as a late
 * one; or a new line otherwise, which closes the other speaker's open line
 * unless the fragment is late. Every line it grows or opens is recorded.
 */
function heardFragment(state: VoiceState, delta: TranscriptDelta): Step {
  const speaker = SPEAKER_OF_DELTA[delta.type];
  const endMs = delta.end_ms ?? delta.start_ms;
  const resume = state.resuming[speaker];

  if (resume !== undefined) {
    const passedBy = replayed(resume, delta.event_id, endMs);

    // The stored line's own event, or the first fragment past it, ends the replay for this speaker.
    const resuming = {
      ...state.resuming,
      [speaker]: passedBy && delta.event_id !== resume.eventId ? resume : undefined,
    };

    if (passedBy) return [{ ...state, resuming }, []];

    return heardFragment({ ...state, resuming }, delta);
  }

  const own = growingLine(state, speaker);

  const other =
    state.open !== null && state.open !== speaker ? growingLine(state, state.open) : undefined;

  const late =
    other?.startMs !== undefined && delta.start_ms !== undefined && delta.start_ms < other.startMs;

  const silent =
    own?.endMs !== undefined &&
    delta.start_ms !== undefined &&
    delta.start_ms - own.endMs > SILENCE_SPLIT_MS;

  const grows = own !== undefined && !silent && (state.open === speaker || late);

  if (grows) {
    const [kept, outputs] = recorded({
      ...own,
      text: own.text + delta.delta,
      startMs: own.startMs ?? delta.start_ms,
      endMs: laterEnd(own.endMs, endMs),
      eventId: delta.event_id,
    });

    return [withLine(state, kept, false), outputs];
  }

  const [closed, closing] = late ? stood(state) : closedOpen(state);

  const [kept, opening] = recorded({
    speaker,
    id: state.lineId(delta.event_id),
    text: delta.delta,
    recorded: "",
    startMs: delta.start_ms,
    endMs,
    eventId: delta.event_id,
  });

  const opened = withLine(closed, kept, true);

  return [late ? opened : { ...opened, open: speaker }, [...closing, ...opening]];
}

/**
 * A delegation takes the caller's lines since the one before, their open
 * one closed: sent to an idle agent by their ids and words, which opens its
 * turn, or queued behind a running one.
 */
function delegated(state: VoiceState, delegationId: string): Step {
  // A delegation handed on before this holder took the call is one the session replayed.
  if (state.handedOn.has(delegationId)) return stood(state);
  const [closed, closing] = state.open === VOICE_SPEAKER.CALLER ? closedOpen(state) : stood(state);

  const lines = closed.heard.filter((line) => line.recorded !== "");
  const text = lines.map((line) => line.recorded).join(" ");

  // Note that a delegation raised before any of its words were transcribed
  // hands nothing on, and its words go with the next one, because the
  // service refuses a message with no words.
  if (text === "") {
    return [
      closed,
      [
        ...closing,
        ...tell(
          LIVE_CLIENT_EVENT.THINKING_APPEND,
          delegationId,
          "Nothing was transcribed for this request yet, so it was not passed to the agent.",
        ),
      ],
    ];
  }

  const message = { text, delegationId, lines: lines.map((line) => line.id) };
  const taken = { ...closed, heard: [] };

  if (state.working) {
    return [taken, [...closing, { kind: VOICE_OUTPUT.QUEUE, ...message }]];
  }

  return [
    { ...taken, working: true, answering: delegationId },
    [...closing, { kind: VOICE_OUTPUT.SEND, ...message }],
  ];
}

function heardLive(state: VoiceState, event: LiveServerEvent): Step {
  switch (event.type) {
    case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
    case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA:
      return heardFragment(state, event);
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

/** An input read: GPT-Live's event decoded, or nothing for an event the loop passes by. */
function readInput(input: VoiceInput): ReadInput | undefined {
  if (input.from !== VOICE_INPUT.LIVE) return input;
  const event = Result.getOrUndefined(readLiveEvent(unparsedWire(input.body)));

  return event === undefined ? undefined : { from: VOICE_INPUT.LIVE, event };
}

function stepped(state: VoiceState, input: ReadInput): Step {
  switch (input.from) {
    case VOICE_INPUT.LIVE:
      return heardLive(state, input.event);
    case VOICE_INPUT.AGENT:
      return followedAgent(state, input.event);
  }
}

/** A stored line as the loop holds it, its words recorded as they stand. */
function storedLine(line: StoredVoiceLine, eventId: string): Line {
  return {
    speaker: line.speaker,
    id: line.id,
    text: line.text,
    recorded: line.text,
    startMs: line.fromMs,
    endMs: line.toMs,
    eventId,
  };
}

/** Where a speaker's newest stored line stood, which a replay of its fragments is passed by up to. */
function resumeOf(lines: readonly StoredVoiceLine[], speaker: VoiceSpeaker): Resume | undefined {
  const newest = lines.findLast((line) => line.speaker === speaker);

  return newest?.eventId === undefined
    ? undefined
    : { eventId: newest.eventId, endMs: newest.toMs };
}

/**
 * The loop's state at the call's start, or as a holder taking the call over
 * finds it in the stored lines: the caller's lines no delegation took, the
 * voice's newest line, and the speaker of the newest line open, unless a
 * delegation took it.
 */
function startedVoiceLoop(start: VoiceCallStart): VoiceState {
  const named = start.lines.flatMap((line) =>
    line.eventId === undefined ? [] : [storedLine(line, line.eventId)],
  );

  const newest = start.lines.at(-1);
  const voiced = named.findLast((line) => line.speaker === VOICE_SPEAKER.VOICE);

  return {
    lineId: start.lineId,
    resuming: {
      [VOICE_SPEAKER.CALLER]: resumeOf(start.lines, VOICE_SPEAKER.CALLER),
      [VOICE_SPEAKER.VOICE]: resumeOf(start.lines, VOICE_SPEAKER.VOICE),
    },
    handedOn: start.delegations,
    heard: named.filter(
      (line) =>
        line.speaker === VOICE_SPEAKER.CALLER &&
        start.lines.some((stored) => stored.id === line.id && !stored.delegated),
    ),
    voiced,
    open: newest === undefined || newest.delegated ? null : newest.speaker,
    working: start.agentWorking,
    answering: start.answering,
  };
}

/**
 * The delegation loop over a call's inputs, merged into one stream by the
 * caller, answering what to send the agent and what to tell the voice, in
 * order; it ends once GPT-Live closes the session or the input ends, with
 * the line open then recorded.
 */
export function voiceDelegations<E, R>(
  inputs: Stream.Stream<VoiceInput, E, R>,
  start: VoiceCallStart,
): Stream.Stream<VoiceOutput, E, R> {
  return inputs.pipe(
    Stream.map(readInput),
    Stream.filter((input): input is ReadInput => input !== undefined),
    Stream.takeUntil(
      (input) => input.from === VOICE_INPUT.LIVE && input.event.type === LIVE_SERVER_EVENT.CLOSED,
      { excludeLast: true },
    ),
    // The line open as the call ends is recorded as it stands.
    Stream.mapAccum(() => startedVoiceLoop(start), stepped, {
      onHalt: (state) => closedOpen(state)[1],
    }),
  );
}
