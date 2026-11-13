import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import {
  AGENT_TURN,
  type AgentTurnEvent,
  LIVE_CLIENT_EVENT,
  VOICE_INPUT,
  VOICE_OUTPUT,
  type VoiceInput,
  voiceDelegations,
} from "./voice-delegation.js";

function said(delta: string): VoiceInput {
  return {
    from: VOICE_INPUT.LIVE,
    text: JSON.stringify({
      type: "session.input_transcript.delta",
      delta,
      start_ms: 0,
      end_ms: 100,
    }),
  };
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

const outputsOf = (inputs: readonly VoiceInput[], agentWorking = false) =>
  Stream.runCollect(voiceDelegations(Stream.fromIterable(inputs), { agentWorking }));

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
      { kind: VOICE_OUTPUT.SEND, text: "Run the tests.", delegationId: "item_1" },
      { kind: VOICE_OUTPUT.SEND, text: "Then open a pull request.", delegationId: "item_2" },
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

    assert.deepEqual(outputs, [
      { kind: VOICE_OUTPUT.QUEUE, text: "Also check the docs.", delegationId: "item_1" },
      { kind: VOICE_OUTPUT.SEND, text: "And the changelog.", delegationId: "item_2" },
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
        outputs.slice(1),
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
