/**
 * voice-call.tsx -- a voice call into an agent, carried in this window: the microphone out and the voice back over WebRTC, held at the window's root.
 *
 * The call is the window's, not a screen's: the provider sits at the panel's
 * root, so it outlives switching tabs and tasks, and holds one call at a
 * time, a second start ending the first. A start opens the microphone
 * (`tasks/use-open-microphone.ts`), makes the peer's SDP offer with an audio
 * track and the `oai-events` data channel, and has the service open the
 * GPT-Live session on the account's own OpenAI key (`voice.open`), in the
 * voice the account chose (Settings › Agents) or the default; the answer's
 * SDP connects the peer, and the voice plays through an audio element of the
 * window's own. The service holds the rest of the call over its own
 * connection to the session: the panel carries audio and nothing of the
 * call's logic, and the data channel takes only mute, unmute, and
 * `session.close`.
 *
 * The call is live once the session says it started, and timed from then.
 * Muting the microphone tells the session to stop hearing it; muting the
 * speaker silences the voice on this device alone. End sends
 * `session.close` and closes the channel, which sends what it holds first,
 * and the peer is dropped once the channel has closed; a `session.closed`
 * from the service, a peer that failed, or the window going away drops it
 * at once. Whatever fails says why in a toast and lets the microphone go.
 * A call runs on the account's own OpenAI key, so with none saved a start
 * opens Settings › Agents instead. Nothing here starts while the Voice
 * experiment is off, and turning it off ends a call under way.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { DEFAULT_LIVE_VOICE } from "@repo/features/voices";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { STATUS_TONE } from "@repo/ui";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema as EffectSchema, Result } from "effect";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { sendAct } from "./act.js";
import { useOpenAiKeyMissing, useOpenApiKeys } from "./openai-key.js";
import { MICROPHONE_REFUSAL, useOpenMicrophone } from "./tasks/use-open-microphone.js";
import { showToast } from "./toast.js";
import { appStateQuery, selectAppSettingsView, selectExperiment } from "./use-app-state.js";

/** Where a call stands: connecting until the session says it started, live, then ending until its channel has closed. */
export const VOICE_CALL_STAGE = {
  CONNECTING: "connecting",
  LIVE: "live",
  ENDING: "ending",
} as const;

export type VoiceCallStage = (typeof VOICE_CALL_STAGE)[keyof typeof VOICE_CALL_STAGE];

/** The call standing in this window, as a surface draws it. */
export interface VoiceCallState {
  readonly stage: VoiceCallStage;
  /** The agent the call speaks to, and the task it works on. */
  readonly agentId: string;
  readonly taskId: string;
  /** The call's id as the service answered it, which its transcript lines name; nothing until it answers. */
  readonly callId: string | undefined;
  /** When the session started, on the epoch's clock; nothing while it connects. */
  readonly startedAt: number | undefined;
  readonly microphoneMuted: boolean;
  /** Whether the voice is silenced on this device alone. */
  readonly speakerMuted: boolean;
}

/** The window's call and what a surface may do with it. */
export interface VoiceCall {
  /** The call standing; nothing when none does. */
  readonly call: VoiceCallState | undefined;
  /** Calls the agent, ending a call already standing first. */
  readonly start: (into: { readonly agentId: string; readonly taskId: string }) => void;
  readonly end: () => void;
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
}

/** The channel GPT-Live's events ride on, by the name it opens it under. */
const EVENTS_CHANNEL = "oai-events";

/** The client events the session's allowlist takes from the panel, and the server events it is told. */
const LIVE_EVENT = {
  MUTE: "session.input_audio.mute",
  UNMUTE: "session.input_audio.unmute",
  CLOSE: "session.close",
  STARTED: "session.started",
  CLOSED: "session.closed",
} as const;

/** Why a call stopped short, in the words its toast says. */
const VOICE_CALL_NOTE = {
  MICROPHONE_DENIED:
    "The microphone is not allowed. Allow it in System Settings › Privacy & Security › Microphone.",
  MICROPHONE_FAILED: "The microphone could not be opened.",
  OPENAI_KEY_MISSING: OPENAI_KEY_MISSING_NOTE,
  NOT_STARTED: "The call could not be started.",
  DROPPED: "The call dropped.",
} as const;

/** One call's machinery: what its start opened, which its end lets go. */
interface Standing {
  readonly peer: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  readonly microphone: MediaStream;
  readonly speaker: HTMLAudioElement;
}

const NO_CALL: VoiceCall = {
  call: undefined,
  start: () => undefined,
  end: () => undefined,
  setMicrophoneMuted: () => undefined,
  setSpeakerMuted: () => undefined,
};

const VoiceCallContext = createContext<VoiceCall>(NO_CALL);

/** Says why a call stopped short, as a failure the toast reports. */
function toastCallFailure(words: string, cause: unknown): void {
  showToast({
    words,
    tone: STATUS_TONE.DANGER,
    failure: { surface: FAILURE_SURFACE.VOICE_CALL, cause },
    replayUnmasked: true,
  });
}

/** Sends one client event on the call's channel, where it is open to take it. */
function tell(standing: Standing, type: string): void {
  if (standing.channel.readyState === "open") standing.channel.send(JSON.stringify({ type }));
}

/** The one field of a server event the call reads: its type, every other key let go. */
const readServerEvent = readEither(EffectSchema.Struct({ type: EffectSchema.String }), {
  excess: EXCESS_KEYS.DROP,
});

/** The type a server event names; nothing for a message that is not one. */
function eventType(text: string): string | undefined {
  try {
    return Result.getOrUndefined(readServerEvent(unparsedWire(JSON.parse(text))))?.type;
  } catch {
    return undefined;
  }
}

/** Everything a call opened, let go: the peer closed, the microphone's light out, the voice stopped. */
function release(standing: Standing): void {
  standing.peer.close();

  for (const track of standing.microphone.getTracks()) track.stop();
  standing.speaker.srcObject = null;
}

/** The peer a call speaks over: the microphone's track out, the voice into the speaker, and the events channel. */
function connect(microphone: MediaStream): Standing {
  const peer = new RTCPeerConnection();
  const speaker = new Audio();
  speaker.autoplay = true;
  peer.ontrack = (event) => {
    speaker.srcObject = event.streams[0] ?? new MediaStream([event.track]);
  };

  for (const track of microphone.getTracks()) peer.addTrack(track, microphone);
  const channel = peer.createDataChannel(EVENTS_CHANNEL);

  return { peer, channel, microphone, speaker };
}

/**
 * The window's call, held for every surface beneath it. Note that the
 * machinery is a ref and what a surface draws is state, because the
 * peer's handlers outlive the render that made them: each checks that the
 * call it was made for still stands before it acts.
 */
export function VoiceCallProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const on = useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.VOICE) }).data;
  const queryClient = useQueryClient();
  const keyMissing = useOpenAiKeyMissing();
  const openApiKeys = useOpenApiKeys();
  const openMicrophone = useOpenMicrophone();
  const [call, setCall] = useState<VoiceCallState | undefined>(undefined);
  // Note that each start is a generation of its own, because a microphone or
  // an answer arriving after the call was ended must find it gone.
  const generation = useRef(0);
  const standing = useRef<Standing | undefined>(undefined);

  /** Lets the call go, where it is still the one standing. */
  const drop = (asked: number) => {
    if (generation.current !== asked) return;
    generation.current += 1;
    const held = standing.current;
    standing.current = undefined;

    if (held !== undefined) release(held);
    setCall(undefined);
  };

  const fail = (asked: number, words: string, cause: unknown) => {
    if (generation.current !== asked) return;
    drop(asked);
    toastCallFailure(words, cause);
  };

  /** Hears the call's channel and peer: the session's start and close, the channel closing, and a peer that failed. */
  const listen = (asked: number, held: Standing) => {
    held.channel.onmessage = (message) => {
      const type = eventType(String(message.data));

      if (type === LIVE_EVENT.CLOSED) return drop(asked);

      if (type !== LIVE_EVENT.STARTED || generation.current !== asked) return;
      setCall((last) =>
        last === undefined || last.stage !== VOICE_CALL_STAGE.CONNECTING
          ? last
          : { ...last, stage: VOICE_CALL_STAGE.LIVE, startedAt: Date.now() },
      );
    };

    // Note that a call ended by a second start is no longer the one standing, so its channel closing lets go of its own machinery alone.
    held.channel.onclose = () => {
      release(held);
      drop(asked);
    };

    held.peer.onconnectionstatechange = () => {
      if (held.peer.connectionState === "failed") fail(asked, VOICE_CALL_NOTE.DROPPED, "failed");
    };
  };

  /** Opens the call the start asked for: the microphone, the peer, and the session. */
  const open = async (asked: number, agentId: string) => {
    const opened = await openMicrophone();

    if ("refused" in opened) {
      return fail(
        asked,
        opened.refused === MICROPHONE_REFUSAL.DENIED
          ? VOICE_CALL_NOTE.MICROPHONE_DENIED
          : VOICE_CALL_NOTE.MICROPHONE_FAILED,
        opened.refused,
      );
    }

    if (generation.current !== asked) {
      for (const track of opened.stream.getTracks()) track.stop();

      return;
    }

    const held = connect(opened.stream);
    standing.current = held;
    listen(asked, held);
    const offer = await held.peer.createOffer();
    await held.peer.setLocalDescription(offer);
    const state = queryClient.getQueryData(appStateQuery.queryKey);

    const voice =
      (state === undefined ? undefined : selectAppSettingsView(state)?.voice) ?? DEFAULT_LIVE_VOICE;

    const answer = await sendAct(ACT_KIND.VOICE_OPEN, { agentId, voice, sdp: offer.sdp ?? "" });

    if (generation.current !== asked) return;

    if ("failure" in answer) {
      return fail(
        asked,
        answer.failure === AGENT_CALL_FAILURE.OPENAI_KEY_MISSING
          ? VOICE_CALL_NOTE.OPENAI_KEY_MISSING
          : VOICE_CALL_NOTE.NOT_STARTED,
        answer.failure,
      );
    }

    setCall((last) => last && { ...last, callId: answer.callId });
    await held.peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  };

  const end = () => {
    const held = standing.current;

    // Note that a call still opening its microphone has no channel to close, so it is let go at once.
    if (held === undefined || held.channel.readyState !== "open") return drop(generation.current);
    tell(held, LIVE_EVENT.CLOSE);
    held.channel.close();
    setCall((last) => last && { ...last, stage: VOICE_CALL_STAGE.ENDING });
  };

  const start = (into: { readonly agentId: string; readonly taskId: string }) => {
    if (on !== true) return;

    if (keyMissing) return openApiKeys();
    end();
    generation.current += 1;
    const asked = generation.current;
    setCall({
      stage: VOICE_CALL_STAGE.CONNECTING,
      agentId: into.agentId,
      taskId: into.taskId,
      callId: undefined,
      startedAt: undefined,
      microphoneMuted: false,
      speakerMuted: false,
    });
    open(asked, into.agentId).catch((cause: unknown) =>
      fail(asked, VOICE_CALL_NOTE.NOT_STARTED, cause),
    );
  };

  const setMicrophoneMuted = (muted: boolean) => {
    const held = standing.current;

    if (held === undefined || held.channel.readyState !== "open") return;
    tell(held, muted ? LIVE_EVENT.MUTE : LIVE_EVENT.UNMUTE);
    setCall((last) => last && { ...last, microphoneMuted: muted });
  };

  const setSpeakerMuted = (muted: boolean) => {
    const held = standing.current;

    if (held === undefined) return;
    held.speaker.muted = muted;
    setCall((last) => last && { ...last, speakerMuted: muted });
  };

  // The window going away, or the provider with it, closes the session and drops the call.
  const hangUpNow = useRef<() => void>(() => undefined);
  hangUpNow.current = () => {
    const held = standing.current;

    if (held !== undefined) tell(held, LIVE_EVENT.CLOSE);
    drop(generation.current);
  };

  // Note that the Voice experiment turned off ends a call under way, because no surface draws its End call once the feature stands nowhere.
  useEffect(() => {
    if (on === false) hangUpNow.current();
  }, [on]);

  useEffect(() => {
    const hangUp = () => hangUpNow.current();
    window.addEventListener("pagehide", hangUp);

    return () => {
      window.removeEventListener("pagehide", hangUp);
      hangUp();
    };
  }, []);

  const value: VoiceCall = { call, start, end, setMicrophoneMuted, setSpeakerMuted };

  return <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>;
}

/** The window's voice call, and what a surface may do with it. */
export function useVoiceCall(): VoiceCall {
  return useContext(VoiceCallContext);
}
