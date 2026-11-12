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

it.effect("a reply over 500 tokens goes to the voice cut to its opening sentences", () =>
  Effect.gen(function* () {
    // Forty sentences of 49 characters, each followed by a space. The bound
    // counts 3 characters a token, so 1,500 characters: 30 sentences spell
    // 30 * 50 - 1 = 1,499 and fit, and a 31st would spell 1,549.
    const sentences = Array.from(
      { length: 40 },
      (_, at) =>
        `Fact ${String(at + 1).padStart(2, "0")} is settled, and the voice may say it now.`,
    );

    assert.equal(sentences[0]?.length, 49);

    const outputs = yield* outputsOf([
      said("What did you find?"),
      delegation("item_1"),
      agent({ kind: AGENT_TURN.STARTED }),
      agent({ kind: AGENT_TURN.REPLY, text: sentences.join(" ") }),
    ]);

    assert.deepEqual(outputs.at(-1), {
      kind: VOICE_OUTPUT.TELL,
      event: {
        type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
        delegation_id: "item_1",
        content: sentences.slice(0, 30).join(" "),
      },
    });
  }),
);
