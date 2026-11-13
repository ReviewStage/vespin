import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { VOICE_SPEAKER, type VoiceSpeaker } from "./agent-wire.js";
import {
  AGENT_TURN,
  type AgentTurnEvent,
  LIVE_CLIENT_EVENT,
  VOICE_INPUT,
  VOICE_OUTPUT,
  type VoiceInput,
  voiceDelegations,
} from "./voice-delegation.js";

/** A fragment of the transcript, at the interval on the session's timeline given. */
function fragment(type: string, delta: string, startMs: number, endMs: number): VoiceInput {
  return {
    from: VOICE_INPUT.LIVE,
    text: JSON.stringify({ type, delta, start_ms: startMs, end_ms: endMs }),
  };
}

function said(delta: string, startMs = 0, endMs = 100): VoiceInput {
  return fragment("session.input_transcript.delta", delta, startMs, endMs);
}

function voiced(delta: string, startMs: number, endMs: number): VoiceInput {
  return fragment("session.output_transcript.delta", delta, startMs, endMs);
}

function record(speaker: VoiceSpeaker, id: string, text: string) {
  return { kind: VOICE_OUTPUT.RECORD, speaker, id, text };
}

function delegation(id: string): VoiceInput {
  return {
    from: VOICE_INPUT.LIVE,
    text: JSON.stringify({
      type: "session.delegation.created",
      offset_ms: 1000,
      delegation: { id, type: "delegation", target: "client" },
    }),
  };
}

function agent(event: AgentTurnEvent): VoiceInput {
  return { from: VOICE_INPUT.AGENT, event };
}

/** The loop's outputs over the inputs, its lines minted `line_1`, `line_2`, and so on. */
const outputsOf = (inputs: readonly VoiceInput[], agentWorking = false) => {
  let minted = 0;

  const mintId = () => {
    minted += 1;

    return `line_${minted}`;
  };

  return Stream.runCollect(voiceDelegations(Stream.fromIterable(inputs), { agentWorking, mintId }));
};

it.effect("a delegation sends exactly what was said since the one before it", () =>
  Effect.gen(function* () {
    const outputs = yield* outputsOf([
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
    const outputs = yield* outputsOf(
      [
        said("Also check the docs."),
        delegation("item_1"),
        agent({ kind: AGENT_TURN.ENDED }),
        said("And the changelog."),
        delegation("item_2"),
      ],
      true,
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
  "both sides are recorded once each in spoken order, and a delegation sends the caller's lines since the one before",
  () =>
    Effect.gen(function* () {
      const outputs = yield* outputsOf([
        said("What's left", 0, 400),
        said(" on the task?", 400, 900),
        voiced("Only the", 1200, 1500),
        voiced(" docs.", 1500, 1800),
        said("Then write them.", 2400, 3000),
        delegation("item_1"),
      ]);

      assert.deepEqual(outputs, [
        record(VOICE_SPEAKER.CALLER, "line_1", "What's left"),
        record(VOICE_SPEAKER.CALLER, "line_1", "What's left on the task?"),
        record(VOICE_SPEAKER.VOICE, "line_2", "Only the"),
        record(VOICE_SPEAKER.VOICE, "line_2", "Only the docs."),
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

it.effect("a caller's fragment that started before the voice's line grows the caller's line", () =>
  Effect.gen(function* () {
    const outputs = yield* outputsOf([
      said("Is the build", 0, 500),
      voiced("It is", 1200, 1500),
      said(" green?", 500, 900),
      voiced(" green.", 1500, 1800),
    ]);

    assert.deepEqual(outputs, [
      record(VOICE_SPEAKER.CALLER, "line_1", "Is the build"),
      record(VOICE_SPEAKER.VOICE, "line_2", "It is"),
      record(VOICE_SPEAKER.CALLER, "line_1", "Is the build green?"),
      record(VOICE_SPEAKER.VOICE, "line_2", "It is green."),
    ]);
  }),
);

it.effect("a late fragment after a long silence opens a line of its own", () =>
  Effect.gen(function* () {
    const outputs = yield* outputsOf([
      said("Hold on.", 0, 100),
      voiced("Sure.", 10_000, 10_400),
      said("Ship it.", 4_000, 4_600),
    ]);

    assert.deepEqual(outputs, [
      record(VOICE_SPEAKER.CALLER, "line_1", "Hold on."),
      record(VOICE_SPEAKER.VOICE, "line_2", "Sure."),
      record(VOICE_SPEAKER.CALLER, "line_3", "Ship it."),
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

      const outputs = yield* outputsOf([
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
