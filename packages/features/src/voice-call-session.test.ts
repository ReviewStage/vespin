import { describe, expect, it } from "vitest";
import {
  VOICE_CALL_FAILURE,
  type VoiceCallFailure,
  type VoiceCallOpened,
  type VoiceCallPeerEvents,
  type VoiceCallState,
  voiceCallSession,
} from "./voice-call-session.js";
import { VOICE_CALL_STAGE } from "./voice-wire.js";

const INTO = { agentId: "agent-1", taskId: "task-1" };

/** A promise and the hand that settles it, so a test says when the service answers. */
function held<T>() {
  let settle: (value: T) => void = () => undefined;

  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

/** A call session over a fake peer, recording what it was told and what it sent. */
function harness() {
  const sent: string[] = [];
  const answer = held<VoiceCallOpened>();
  const failures: VoiceCallFailure[] = [];
  let events: VoiceCallPeerEvents | undefined;
  let channelOpen = false;
  let released = 0;
  let speakerSilenced = false;
  let call: VoiceCallState | undefined;

  const session = voiceCallSession({
    connect: async (heard) => {
      events = heard;

      return {
        peer: {
          offer: async () => "offer",
          answer: async () => {
            channelOpen = true;
          },
          channelOpen: () => channelOpen,
          send: (text) => sent.push(JSON.parse(text).type),
          closeChannel: () => {
            channelOpen = false;
          },
          silenceMicrophone: () => undefined,
          silenceSpeaker: (muted) => {
            speakerSilenced = muted;
          },
          release: () => {
            released += 1;
          },
        },
      };
    },
    open: () => answer.promise,
    now: () => 1_000,
    onChange: (next) => {
      call = next;
    },
    onFailure: (failure) => failures.push(failure),
  });

  // Note that the session awaits a few steps of its own between a press and the next, so a test lets every promise queued settle first.
  const settled = async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
  };

  return {
    session,
    sent,
    failures,
    answer,
    settled,
    events: () => events,
    call: () => call,
    released: () => released,
    speakerSilenced: () => speakerSilenced,
  };
}

describe("a voice call session", () => {
  it("tells the session a mute pressed while it connected the moment it starts", async () => {
    const test = harness();
    test.session.start(INTO);
    test.session.setMicrophoneMuted(true);
    await test.settled();
    test.answer.settle({ callId: "call-1", sdp: "answer" });
    await test.settled();
    test.events()?.onMessage(JSON.stringify({ type: "session.started" }));

    expect(test.sent).toEqual(["session.input_audio.mute"]);
    expect(test.call()).toMatchObject({
      stage: VOICE_CALL_STAGE.LIVE,
      callId: "call-1",
      startedAt: 1_000,
      microphoneMuted: true,
    });
  });

  it("keeps a speaker muted while the microphone opened, and silences the voice once the peer stands", async () => {
    const test = harness();
    test.session.start(INTO);
    test.session.setSpeakerMuted(true);
    await test.settled();

    expect(test.call()?.speakerMuted).toBe(true);
    expect(test.speakerSilenced()).toBe(true);
  });

  it("ends by telling the session to close, and lets the call go once its channel closes", async () => {
    const test = harness();
    test.session.start(INTO);
    await test.settled();
    test.answer.settle({ callId: "call-1", sdp: "answer" });
    await test.settled();
    test.session.end();

    expect(test.sent).toEqual(["session.close"]);
    expect(test.call()?.stage).toBe(VOICE_CALL_STAGE.ENDING);
    test.events()?.onChannelClosed();
    expect(test.call()).toBeUndefined();
    expect(test.released()).toBeGreaterThan(0);
  });

  it("lets a call ended while the service answered go, its answer finding it gone", async () => {
    const test = harness();
    test.session.start(INTO);
    await test.settled();
    test.session.end();
    test.answer.settle({ callId: "call-1", sdp: "answer" });
    await test.settled();

    expect(test.call()).toBeUndefined();
    expect(test.released()).toBe(1);
    expect(test.failures).toEqual([]);
  });

  it("drops the call and says why where the service refused it", async () => {
    const test = harness();
    test.session.start(INTO);
    await test.settled();
    test.answer.settle({ failure: VOICE_CALL_FAILURE.OPENAI_KEY_MISSING });
    await test.settled();

    expect(test.call()).toBeUndefined();
    expect(test.failures).toEqual([VOICE_CALL_FAILURE.OPENAI_KEY_MISSING]);
  });
});
