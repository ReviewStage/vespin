// @vitest-environment jsdom
/**
 * voice-call.test.ts -- the window's voice call over a fake peer and data channel, in place of the browser's WebRTC.
 */

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "./testing/app-bridge.js";
import { handState, withExperiments, writeExperiments } from "./testing/app-state.js";
import { settleQueries } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";
import { useVoiceCall, type VoiceCall, VoiceCallProvider } from "./voice-call.js";

const AGENT_ID = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const TASK_ID = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
const CALL_ID = "3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d";

/** A client event as GPT-Live takes it on the channel. */
function said(type: string): string {
  return JSON.stringify({ type });
}

/** A data channel as the call uses one: what it sent, and the session's events delivered into it. */
class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  readonly sent: string[] = [];
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
  /** The channel opening and the session saying it started, as GPT-Live does once the peer connects. */
  started() {
    this.readyState = "open";
    this.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  }
  /** What the call told the session, each event as it was sent. */
  told(): string[] {
    return this.sent;
  }
}

/** A peer as the call uses one, each made kept for the case to read. */
class FakePeer {
  static made: FakePeer[] = [];
  readonly channel = new FakeChannel();
  connectionState: RTCPeerConnectionState = "new";
  remote: RTCSessionDescriptionInit | undefined;
  closed = false;
  ontrack = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    FakePeer.made.push(this);
  }
  addTrack() {
    return {};
  }
  createDataChannel() {
    return this.channel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0 offer" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remote = description;

    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
}

/** The microphone's one track, whose light a stop puts out. */
const microphone = { stopped: false };

/** What the call asked the service to open. */
let opened: unknown[];

let root: Root | undefined;
let call: VoiceCall;

/** Hands the case the window's call as a surface reads it. */
function Caller(): null {
  call = useVoiceCall();

  return null;
}

/** The call's provider, as the window's root holds it, with the Voice experiment as given. */
async function mounted(voiceOn = true): Promise<void> {
  const experiments = voiceOn ? experimentsOn(EXPERIMENT.VOICE) : {};
  handState(experiments);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      withExperiments(
        experiments,
        createElement(
          Fragment,
          null,
          createElement(VoiceCallProvider, null, createElement(Caller)),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  await settleQueries();
}

/** Presses Call on the agent and lets the microphone and the service answer. */
async function called(): Promise<FakePeer> {
  act(() => call.start({ agentId: AGENT_ID, taskId: TASK_ID }));
  await settleQueries();
  const peer = FakePeer.made.at(-1);
  assert.ok(peer, "a peer was made");

  return peer;
}

beforeEach(() => {
  FakePeer.made = [];
  opened = [];
  microphone.stopped = false;

  const track = {
    stop: () => {
      microphone.stopped = true;
    },
  };

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => Promise.resolve({ getTracks: () => [track] }),
      enumerateDevices: () => Promise.resolve([]),
    },
  });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  fakeActPort({
    [ACT_KIND.VOICE_OPEN]: (payload) => {
      opened.push(payload);

      return Promise.resolve({ callId: CALL_ID, sdp: "v=0 answer" });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("a call connects in the default voice, goes live as the session starts, and End closes the session before the peer goes", async () => {
  await mounted();
  const peer = await called();

  assert.deepEqual(opened, [{ agentId: AGENT_ID, voice: "marin", sdp: "v=0 offer" }]);
  assert.deepEqual(peer.remote, { type: "answer", sdp: "v=0 answer" });
  assert.equal(call.call?.stage, "connecting");
  assert.equal(call.call?.callId, CALL_ID);
  assert.equal(call.call?.startedAt, undefined);

  act(() => peer.channel.started());
  assert.equal(call.call?.stage, "live");
  assert.equal(call.call?.agentId, AGENT_ID);
  assert.equal(call.call?.taskId, TASK_ID);
  assert.ok(call.call?.startedAt !== undefined, "the call is timed from the session's start");

  act(() => call.end());
  assert.deepEqual(peer.channel.told(), [said("session.close")]);
  assert.equal(call.call, undefined);
  assert.ok(peer.closed, "the peer is dropped");
  assert.ok(microphone.stopped, "the microphone is let go");
});

test("muting the microphone tells the session, and muting the speaker tells it nothing", async () => {
  await mounted();
  const peer = await called();
  act(() => peer.channel.started());

  act(() => call.setMicrophoneMuted(true));
  act(() => call.setSpeakerMuted(true));
  act(() => call.setMicrophoneMuted(false));

  assert.deepEqual(peer.channel.told(), [
    said("session.input_audio.mute"),
    said("session.input_audio.unmute"),
  ]);
  assert.equal(call.call?.microphoneMuted, false);
  assert.equal(call.call?.speakerMuted, true);
});

test("a call refused for want of an OpenAI key says to add one and lets the microphone go", async () => {
  fakeActPort({
    [ACT_KIND.VOICE_OPEN]: () =>
      Promise.resolve({ failure: AGENT_CALL_FAILURE.OPENAI_KEY_MISSING }),
  });
  await mounted();
  const peer = await called();

  assert.equal(call.call, undefined);
  assert.ok(peer.closed, "the peer is dropped");
  assert.ok(microphone.stopped, "the microphone is let go");
  assert.ok(document.body.textContent?.includes(OPENAI_KEY_MISSING_NOTE));
});

test("the session closing from its side ends the call", async () => {
  await mounted();
  const peer = await called();
  act(() => peer.channel.started());

  act(() => peer.channel.onmessage?.({ data: JSON.stringify({ type: "session.closed" }) }));

  assert.equal(call.call, undefined);
  assert.ok(peer.closed, "the peer is dropped");
});

test("a second call ends the first", async () => {
  await mounted();
  const first = await called();
  act(() => first.channel.started());

  const second = await called();

  assert.deepEqual(first.channel.told(), [said("session.close")]);
  assert.ok(first.closed, "the first call's peer is dropped");
  assert.notEqual(first, second);
  assert.equal(call.call?.stage, "connecting");
});

test("turning the Voice experiment off ends a call under way, its session closed and the microphone let go", async () => {
  await mounted();
  const peer = await called();
  act(() => peer.channel.started());

  writeExperiments({});
  await settleQueries();

  assert.deepEqual(peer.channel.told(), [said("session.close")]);
  assert.equal(call.call, undefined);
  assert.ok(peer.closed, "the peer is dropped");
  assert.ok(microphone.stopped, "the microphone is let go");
});

test("nothing calls while the Voice experiment is off", async () => {
  await mounted(false);
  act(() => call.start({ agentId: AGENT_ID, taskId: TASK_ID }));
  await settleQueries();

  assert.equal(FakePeer.made.length, 0);
  assert.equal(call.call, undefined);
});
