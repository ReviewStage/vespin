import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { VOICE_SPEAKER, type VoiceSpeaker } from "./agent-wire.js";
import {
  AGENT_TURN,
  type AgentTurnEvent,
  LIVE_CLIENT_EVENT,
  type StoredVoiceLine,
  VOICE_INPUT,
  VOICE_OUTPUT,
  type VoiceCallStart,
  type VoiceInput,
  type VoiceOutput,
  voiceDelegations,
} from "./voice-delegation.js";

/** How many events the session has said, so each is given an id of its own. */
let eventCount = 0;

/** A fragment of the transcript, at the interval on the session's timeline given, under the event id given or one of its own. */
function fragment(
  type: string,
  delta: string,
  startMs: number,
  endMs: number,
  eventId?: string,
): VoiceInput {
  eventCount += 1;

  return {
    from: VOICE_INPUT.LIVE,
    body: {
      type,
      event_id: eventId ?? `event_${eventCount}`,
      delta,
      start_ms: startMs,
      end_ms: endMs,
    },
  };
}

function said(delta: string, startMs = 0, endMs = 100, eventId?: string): VoiceInput {
  return fragment("session.input_transcript.delta", delta, startMs, endMs, eventId);
}

function voiced(delta: string, startMs: number, endMs: number, eventId?: string): VoiceInput {
  return fragment("session.output_transcript.delta", delta, startMs, endMs, eventId);
}

function record(speaker: VoiceSpeaker, id: string, text: string) {
  return { kind: VOICE_OUTPUT.RECORD, speaker, id, text };
}

function delegation(id: string): VoiceInput {
  return {
    from: VOICE_INPUT.LIVE,
    body: {
      type: "session.delegation.created",
      event_id: `event_${id}`,
      offset_ms: 1000,
      delegation: { id, type: "delegation", target: "client" },
    },
  };
}

function agent(event: AgentTurnEvent): VoiceInput {
  return { from: VOICE_INPUT.AGENT, event };
}

/** A record as these cases read it: its line and words, without the span and event a case on those reads. */
function wordsOf(output: VoiceOutput) {
  if (output.kind !== VOICE_OUTPUT.RECORD) return output;
  const { speaker, id, text } = output;

  return { kind: output.kind, speaker, id, text };
}

/**
 * The loop's outputs over the inputs, a line's id derived from its first
 * fragment's event as `line_1`, `line_2`, and so on, in the order those
 * events first come, from where the call stands.
 */
const outputsOf = (
  inputs: readonly VoiceInput[],
  start: Partial<Omit<VoiceCallStart, "lineId">> = {},
) => {
  const derived = new Map<string, string>();

  const lineId = (eventId: string) => {
    const id = derived.get(eventId) ?? `line_${derived.size + 1}`;
    derived.set(eventId, id);

    return id;
  };

  return Stream.runCollect(
    voiceDelegations(Stream.fromIterable(inputs), {
      agentWorking: false,
      answering: null,
      lines: [],
      delegations: new Set(),
      ...start,
      lineId,
    }),
  );
};

/** The outputs as most cases read them (`wordsOf`). */
const wordsOutOf = (...args: Parameters<typeof outputsOf>) =>
  Effect.map(outputsOf(...args), (outputs) => outputs.map(wordsOf));

it.effect("a delegation sends exactly what was said since the one before it", () =>
  Effect.gen(function* () {
    const outputs = yield* wordsOutOf([
      said("Run the"),
      said(" tests."),
      delegation("item_1"),
      agent({ kind: AGENT_TURN.STARTED }),
      agent({ kind: AGENT_TURN.ENDED }),
      said(" Then open"),
      said(" a pull request."),
      delegation("item_2"),
    ]);

    assert.deepEqual(outputs, [
      record(VOICE_SPEAKER.CALLER, "line_1", "Run the"),
      record(VOICE_SPEAKER.CALLER, "line_1", "Run the tests."),
      {
        kind: VOICE_OUTPUT.SEND,
        text: "Run the tests.",
        delegationId: "item_1",
        lines: ["line_1"],
      },
      record(VOICE_SPEAKER.CALLER, "line_2", "Then open"),
      record(VOICE_SPEAKER.CALLER, "line_2", "Then open a pull request."),
      {
        kind: VOICE_OUTPUT.SEND,
        text: "Then open a pull request.",
        delegationId: "item_2",
        lines: ["line_2"],
      },
    ]);
  }),
);

it.effect("a delegation while the agent is mid-turn is queued, and sent once it stands idle", () =>
  Effect.gen(function* () {
    const outputs = yield* wordsOutOf(
      [
        said("Also check the docs."),
        delegation("item_1"),
        agent({ kind: AGENT_TURN.ENDED }),
        said("And the changelog."),
        delegation("item_2"),
      ],
      { agentWorking: true },
    );

    assert.deepEqual(
      outputs.filter((output) => output.kind !== VOICE_OUTPUT.RECORD),
      [
        {
          kind: VOICE_OUTPUT.QUEUE,
          text: "Also check the docs.",
          delegationId: "item_1",
          lines: ["line_1"],
        },
        {
          kind: VOICE_OUTPUT.TELL,
          event: {
            type: LIVE_CLIENT_EVENT.THINKING_APPEND,
            delegation_id: "item_1",
            content:
              "The agent is still working on the earlier request. Your request is queued for when it finishes.",
          },
        },
        {
          kind: VOICE_OUTPUT.SEND,
          text: "And the changelog.",
          delegationId: "item_2",
          lines: ["line_2"],
        },
      ],
    );
  }),
);

it.effect(
  "the agent's steps tell the voice nothing by themselves, a request made while it works is told its newest step, and only its reply is spoken",
  () =>
    Effect.gen(function* () {
      const outputs = yield* wordsOutOf([
        said("List the tasks."),
        delegation("item_1"),
        agent({ kind: AGENT_TURN.STARTED, delegationId: "item_1" }),
        agent({ kind: AGENT_TURN.PROGRESS, step: "Listed the tasks" }),
        agent({ kind: AGENT_TURN.PROGRESS, step: "Read the task Drop old answers" }),
        said("How's it going?"),
        delegation("item_2"),
        agent({ kind: AGENT_TURN.REPLY, text: "Two cleanup tasks are ready." }),
        agent({ kind: AGENT_TURN.ENDED }),
      ]);

      assert.deepEqual(
        outputs.filter((output) => output.kind === VOICE_OUTPUT.TELL),
        [
          {
            kind: VOICE_OUTPUT.TELL,
            event: {
              type: LIVE_CLIENT_EVENT.THINKING_APPEND,
              delegation_id: "item_2",
              content:
                "The agent is still working on the earlier request; its latest step: Read the task Drop old answers. Your request is queued for when it finishes.",
            },
          },
          {
            kind: VOICE_OUTPUT.TELL,
            event: {
              type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
              delegation_id: "item_1",
              content: "Two cleanup tasks are ready.",
            },
          },
        ],
      );
    }),
);

it.effect(
  "both sides are recorded once each in spoken order, and a delegation sends the caller's lines since the one before",
  () =>
    Effect.gen(function* () {
      const outputs = yield* wordsOutOf([
        said("What's left", 0, 400),
        said(" on the task?", 400, 900),
        voiced("Only the docs", 1200, 1500),
        voiced(" are left on it.", 1500, 1800),
        said("Then write them.", 2400, 3000),
        delegation("item_1"),
      ]);

      assert.deepEqual(outputs, [
        record(VOICE_SPEAKER.CALLER, "line_1", "What's left"),
        record(VOICE_SPEAKER.CALLER, "line_1", "What's left on the task?"),
        record(VOICE_SPEAKER.VOICE, "line_2", "Only the docs are left on it."),
        record(VOICE_SPEAKER.CALLER, "line_3", "Then write them."),
        {
          kind: VOICE_OUTPUT.SEND,
          text: "What's left on the task? Then write them.",
          delegationId: "item_1",
          lines: ["line_1", "line_3"],
        },
      ]);
    }),
);

it.effect(
  "the voice's interjections leave the caller's words one line, and stand as one line after it",
  () =>
    Effect.gen(function* () {
      const outputs = yield* wordsOutOf([
        said("Mintlify", 0, 600),
        voiced("mm.", 700, 900),
        said(" though", 1000, 1400),
        voiced(" Yes,", 1500, 1700),
        said(" Mintlify, right", 1800, 2600),
        voiced(" that's right.", 2700, 3200),
        said(" 'Kay", 3300, 3500),
        delegation("item_1"),
      ]);

      assert.deepEqual(outputs, [
        record(VOICE_SPEAKER.CALLER, "line_1", "Mintlify"),
        record(VOICE_SPEAKER.CALLER, "line_1", "Mintlify though"),
        record(VOICE_SPEAKER.CALLER, "line_1", "Mintlify though Mintlify, right"),
        record(VOICE_SPEAKER.CALLER, "line_1", "Mintlify though Mintlify, right 'Kay"),
        record(VOICE_SPEAKER.VOICE, "line_2", "mm. Yes, that's right."),
        {
          kind: VOICE_OUTPUT.SEND,
          text: "Mintlify though Mintlify, right 'Kay",
          delegationId: "item_1",
          lines: ["line_1"],
        },
      ]);
    }),
);

it.effect(
  "an interjection of substance ends the caller's line and stands as its own, the backchannels before it folded in",
  () =>
    Effect.gen(function* () {
      const outputs = yield* wordsOutOf([
        said("Mintlify", 0, 600),
        voiced("mm.", 700, 900),
        said(" though", 1000, 1400),
        voiced(" Yeah, Mintlify's building", 1500, 2000),
        voiced(" the docs preview.", 2000, 2600),
        said("Okay.", 2700, 3000),
      ]);

      assert.deepEqual(outputs, [
        record(VOICE_SPEAKER.CALLER, "line_1", "Mintlify"),
        record(VOICE_SPEAKER.CALLER, "line_1", "Mintlify though"),
        record(VOICE_SPEAKER.VOICE, "line_2", "mm. Yeah, Mintlify's building the docs preview."),
        record(VOICE_SPEAKER.CALLER, "line_3", "Okay."),
      ]);
    }),
);

it.effect("a lease about to hand over records the voice's held line and holds none after it", () =>
  Effect.gen(function* () {
    const outputs = yield* wordsOutOf([
      said("Run the tests", 0, 900),
      voiced("mm.", 1000, 1200),
      { from: VOICE_INPUT.LEASE },
      said(" and the lint.", 1300, 2000),
      voiced("Sure.", 2100, 2400),
    ]);

    assert.deepEqual(outputs, [
      record(VOICE_SPEAKER.CALLER, "line_1", "Run the tests"),
      record(VOICE_SPEAKER.VOICE, "line_2", "mm."),
      { kind: VOICE_OUTPUT.SETTLED },
      record(VOICE_SPEAKER.CALLER, "line_3", "and the lint."),
      record(VOICE_SPEAKER.VOICE, "line_4", "Sure."),
    ]);
  }),
);

it.effect("a caller's fragment that started before the voice's line grows the caller's line", () =>
  Effect.gen(function* () {
    const outputs = yield* wordsOutOf([
      said("Is the build", 0, 500),
      voiced("It is green, and every check passed.", 1200, 1800),
      said(" green?", 500, 900),
    ]);

    assert.deepEqual(outputs, [
      record(VOICE_SPEAKER.CALLER, "line_1", "Is the build"),
      record(VOICE_SPEAKER.VOICE, "line_2", "It is green, and every check passed."),
      record(VOICE_SPEAKER.CALLER, "line_1", "Is the build green?"),
    ]);
  }),
);

it.effect(
  "the session going idle ends the caller's line, the voice's held line recorded after it, and the next words open a line",
  () =>
    Effect.gen(function* () {
      const outputs = yield* wordsOutOf([
        said("Run the tests.", 0, 900),
        voiced("Sure.", 1000, 1300),
        { from: VOICE_INPUT.LIVE, body: { type: "session.paused", event_id: "event_paused" } },
        said("Also the lint.", 15_000, 15_800),
      ]);

      assert.deepEqual(outputs, [
        record(VOICE_SPEAKER.CALLER, "line_1", "Run the tests."),
        record(VOICE_SPEAKER.VOICE, "line_2", "Sure."),
        record(VOICE_SPEAKER.CALLER, "line_3", "Also the lint."),
      ]);
    }),
);

it.effect(
  "a reply over 500 tokens goes to the voice as its opening sentences in four appends",
  () =>
    Effect.gen(function* () {
      // A hundred and twenty sentences of 48 characters, one of them the euro
      // sign, which UTF-8 spells in 3 bytes: 50 bytes a sentence and 51 with
      // the space after it. An append holds 500 bytes, so 9 sentences and
      // their spaces spell 459 and fit, and a 10th would spell 510; a bound
      // counted in characters would hold more than it may. Four appends tell
      // the first 36 sentences, and the rest is dropped.
      const sentences = Array.from(
        { length: 120 },
        (_, at) =>
          `Fact ${String(at + 1).padStart(2, "0")} costs 9 € now, and the voice may say it.`,
      );

      assert.equal(sentences[0]?.length, 48);

      const outputs = yield* wordsOutOf([
        said("What did you find?"),
        delegation("item_1"),
        agent({ kind: AGENT_TURN.STARTED }),
        agent({ kind: AGENT_TURN.REPLY, text: sentences.join(" ") }),
      ]);

      assert.deepEqual(
        outputs.filter((output) => output.kind === VOICE_OUTPUT.TELL),
        [0, 9, 18, 27].map((from) => ({
          kind: VOICE_OUTPUT.TELL,
          event: {
            type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
            delegation_id: "item_1",
            content: sentences.slice(from, from + 9).join(" "),
          },
        })),
      );
    }),
);

it.effect(
  "a line is recorded as each fragment grows it, with its span and the event it took last",
  () =>
    Effect.gen(function* () {
      const outputs = yield* outputsOf([said("Run", 0, 400, "e1"), said(" it.", 400, 900, "e2")]);

      assert.deepEqual(outputs, [
        { ...record(VOICE_SPEAKER.CALLER, "line_1", "Run"), fromMs: 0, toMs: 400, eventId: "e1" },
        {
          ...record(VOICE_SPEAKER.CALLER, "line_1", "Run it."),
          fromMs: 0,
          toMs: 900,
          eventId: "e2",
        },
      ]);
    }),
);

it.effect(
  "a holder taking the call over mid-line passes by what the stored lines took and grows the open line with the rest",
  () =>
    Effect.gen(function* () {
      const stored = (line: Omit<StoredVoiceLine, "speaker">): StoredVoiceLine => ({
        speaker: VOICE_SPEAKER.CALLER,
        ...line,
      });

      const lines = [
        {
          ...stored({
            id: "voice_line",
            text: "Sure.",
            fromMs: 0,
            toMs: 800,
            eventId: "v1",
            delegated: false,
          }),
          speaker: VOICE_SPEAKER.VOICE,
        },
        stored({
          id: "shipped",
          text: "Ship it.",
          fromMs: 900,
          toMs: 1000,
          eventId: "e1",
          delegated: true,
        }),
        stored({
          id: "open",
          text: "Run the",
          fromMs: 1100,
          toMs: 1500,
          eventId: "e3",
          delegated: false,
        }),
      ];

      // The session replays its last few seconds: the voice's stored event is older than them.
      const outputs = yield* outputsOf(
        [
          said("Ship it.", 900, 1000, "e1"),
          delegation("item_0"),
          said("Run", 1100, 1200, "e2"),
          said(" the", 1200, 1500, "e3"),
          said(" tests.", 1500, 1900, "e4"),
          delegation("item_1"),
          voiced("On it.", 2000, 2300, "v2"),
        ],
        { lines, delegations: new Set(["item_0"]) },
      );

      assert.deepEqual(outputs, [
        {
          ...record(VOICE_SPEAKER.CALLER, "open", "Run the tests."),
          fromMs: 1100,
          toMs: 1900,
          eventId: "e4",
        },
        {
          kind: VOICE_OUTPUT.SEND,
          text: "Run the tests.",
          delegationId: "item_1",
          lines: ["open"],
        },
        {
          ...record(VOICE_SPEAKER.VOICE, "line_1", "On it."),
          fromMs: 2000,
          toMs: 2300,
          eventId: "v2",
        },
      ]);
    }),
);
