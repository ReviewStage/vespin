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
 * Where the call stands, its mutes, and what its channel takes and tells
 * are the shared call session's (`@repo/features/voice-call-session`), the
 * iPhone's call running the same machine: live once the session says it
 * started, a mute pressed while it connects told the moment it does, End
 * closing the session before the peer goes, and an End pressed before the
 * channel opened closing whatever session the service still answers with.
 * This file is the panel's half of it, the `VoiceCallPeer`: the microphone
 * opened, the peer over it, the voice played through an audio element of the
 * window's own, and the speaker's mute silencing that element on this device
 * alone. Whatever fails says why in a toast and lets the microphone go. A
 * call runs on the account's own OpenAI key, so with none saved a start
 * opens Settings › Agents instead. Nothing here starts while the Voice
 * experiment is off, and turning it off ends a call under way.
 *
 * The call's levels, how loud the caller and the voice each are, which the
 * mutes ring with (`CallMute`), are measured here: an analyzer on the
 * microphone and one on the voice, in an audio context of the call's own,
 * made in the press that starts it. One loop reads both each frame while a
 * mute draws them and none while no mute does. No audio or level leaves the
 * window, and none is stored or counted.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  VOICE_CALL_FAILURE,
  VOICE_EVENTS_CHANNEL,
  type VoiceCallConnected,
  type VoiceCallFailure,
  type VoiceCallPeerEvents,
  type VoiceCallSession,
  type VoiceCallState,
  voiceCallSession,
} from "@repo/features/voice-call-session";
import { DEFAULT_LIVE_VOICE } from "@repo/features/voices";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { type CallLevel, type CallLevels, STATUS_TONE } from "@repo/ui";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { sendAct } from "./act.js";
import { useOpenAiKeyMissing, useOpenApiKeys } from "./openai-key.js";
import { frameLevel } from "./tasks/frame-level.js";
import {
  MICROPHONE_REFUSAL,
  type OpenedMicrophone,
  useOpenMicrophone,
} from "./tasks/use-open-microphone.js";
import { showToast } from "./toast.js";
import { appStateQuery, selectAppSettingsView, selectExperiment } from "./use-app-state.js";

/** The window's call and what a surface may do with it. */
export interface VoiceCall {
  /** The call standing; nothing when none does. */
  readonly call: VoiceCallState | undefined;
  /** Calls the agent, ending a call already standing first. */
  readonly start: (into: { readonly agentId: string; readonly taskId: string }) => void;
  readonly end: () => void;
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
  /** How loud the caller and the voice are, frame by frame, while a call stands; nothing but silence otherwise. */
  readonly levels: CallLevels;
}

/** Why a call stopped short, in the words its toast says. */
const VOICE_CALL_NOTE: Record<VoiceCallFailure, string> = {
  [VOICE_CALL_FAILURE.MICROPHONE_DENIED]:
    "The microphone is not allowed. Allow it in System Settings › Privacy & Security › Microphone.",
  [VOICE_CALL_FAILURE.MICROPHONE_FAILED]: "The microphone could not be opened.",
  [VOICE_CALL_FAILURE.OPENAI_KEY_MISSING]: OPENAI_KEY_MISSING_NOTE,
  [VOICE_CALL_FAILURE.NOT_STARTED]: "The call could not be started.",
  [VOICE_CALL_FAILURE.DROPPED]: "The call dropped.",
};

/** The analyzers' window: enough samples for a steady level at a frame's rate, as dictation's meter reads. */
const ANALYZER_FFT_SIZE = 1_024;

/** How much of a level a frame keeps from the last: a meter's quick rise and slower fall, so a ring eases off between words. */
const LEVEL_FALL = 0.86;

const SILENCE: CallLevel = { you: 0, voice: 0 };

/** The call's two meters, in the audio context of its own its press made: the microphone's, and the voice's once its track arrives. */
interface Meters {
  readonly context: AudioContext;
  readonly you: AnalyserNode;
  voice: AnalyserNode | undefined;
}

const NO_CALL: VoiceCall = {
  call: undefined,
  start: () => undefined,
  end: () => undefined,
  setMicrophoneMuted: () => undefined,
  setSpeakerMuted: () => undefined,
  levels: () => () => undefined,
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

/**
 * The meters' context, made and resumed in the press that starts the call,
 * because Safari runs a context only from a gesture, as dictation's does;
 * nothing where the page can make none, which leaves the rings still.
 */
function pressedContext(): AudioContext | undefined {
  try {
    const context = new AudioContext();
    context.resume().catch(() => undefined);

    return context;
  } catch {
    return undefined;
  }
}

/** An analyzer hearing `stream` in `context`, connected to nothing else, so it measures and never plays. */
function analyzerOf(context: AudioContext, stream: MediaStream): AnalyserNode {
  const analyzer = context.createAnalyser();
  analyzer.fftSize = ANALYZER_FFT_SIZE;
  context.createMediaStreamSource(stream).connect(analyzer);

  return analyzer;
}

/**
 * The window's peer over the microphone `open` opens, heard by `events`: its
 * track out, the voice into an audio element of its own and the voice's
 * meter, and the events channel. The meters are made in `context`, which the
 * press made, and `onMeters` is handed them while the peer stands and none
 * once it is let go. Note that the context is closed where the microphone is
 * refused, because the press made it before the microphone was asked for.
 */
async function connectWindow(
  open: () => Promise<OpenedMicrophone>,
  context: AudioContext | undefined,
  onMeters: (meters: Meters | undefined) => void,
  events: VoiceCallPeerEvents,
): Promise<VoiceCallConnected> {
  const opened = await open();

  if ("refused" in opened) {
    context?.close().catch(() => undefined);

    return {
      refused:
        opened.refused === MICROPHONE_REFUSAL.DENIED
          ? VOICE_CALL_FAILURE.MICROPHONE_DENIED
          : VOICE_CALL_FAILURE.MICROPHONE_FAILED,
    };
  }

  const microphone = opened.stream;
  const peer = new RTCPeerConnection();
  const speaker = new Audio();
  speaker.autoplay = true;

  const meters: Meters | undefined =
    context === undefined
      ? undefined
      : { context, you: analyzerOf(context, microphone), voice: undefined };

  // Note that the voice is measured from its stream while the speaker plays it, so muting the speaker leaves its ring moving.
  peer.ontrack = (event) => {
    const voice = event.streams[0] ?? new MediaStream([event.track]);
    speaker.srcObject = voice;

    if (meters !== undefined) meters.voice = analyzerOf(meters.context, voice);
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed") events.onFailed();
  };

  for (const track of microphone.getTracks()) peer.addTrack(track, microphone);
  const channel = peer.createDataChannel(VOICE_EVENTS_CHANNEL);
  channel.onmessage = (message) => events.onMessage(String(message.data));
  channel.onopen = () => events.onChannelOpen();
  channel.onclose = () => events.onChannelClosed();
  onMeters(meters);

  return {
    peer: {
      offer: async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        return offer.sdp ?? "";
      },
      answer: (sdp) => peer.setRemoteDescription({ type: "answer", sdp }),
      channelOpen: () => channel.readyState === "open",
      send: (text) => channel.send(text),
      closeChannel: () => channel.close(),
      silenceMicrophone: (muted) => {
        for (const track of microphone.getTracks()) track.enabled = !muted;
      },
      silenceSpeaker: (muted) => {
        speaker.muted = muted;
      },
      release: () => {
        peer.close();

        for (const track of microphone.getTracks()) track.stop();
        speaker.srcObject = null;
        meters?.context.close().catch(() => undefined);
        onMeters(undefined);
      },
    },
  };
}

/** How loud an analyzer hears its stream this frame, in the unit interval; silence where there is none yet. */
function heard(analyzer: AnalyserNode | undefined, samples: Uint8Array<ArrayBuffer>): number {
  if (analyzer === undefined) return 0;
  analyzer.getByteTimeDomainData(samples);

  return frameLevel(samples);
}

/**
 * The call's levels for every mute that draws them: one loop on the
 * window's frames, run while any mute listens and stopped once none does,
 * reading the standing call's meters each frame, silence while none stands.
 */
function levelsOf(standing: { readonly current: Meters | undefined }): CallLevels {
  const draws = new Set<(level: CallLevel) => void>();
  const samples = new Uint8Array(ANALYZER_FFT_SIZE);
  let level = SILENCE;
  let frame = 0;

  const read = () => {
    const meters = standing.current;
    level = {
      you: Math.max(heard(meters?.you, samples), level.you * LEVEL_FALL),
      voice: Math.max(heard(meters?.voice, samples), level.voice * LEVEL_FALL),
    };

    for (const draw of draws) draw(level);
    frame = requestAnimationFrame(read);
  };

  return (draw) => {
    draws.add(draw);

    if (draws.size === 1) frame = requestAnimationFrame(read);

    return () => {
      draws.delete(draw);

      if (draws.size > 0) return;
      cancelAnimationFrame(frame);
      level = SILENCE;
    };
  };
}

/**
 * The window's call, held for every surface beneath it. Note that the
 * session is made once and reads what changes through refs, because the
 * peer's handlers outlive the render that made them.
 */
export function VoiceCallProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const on = useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.VOICE) }).data;
  const queryClient = useQueryClient();
  const keyMissing = useOpenAiKeyMissing();
  const openApiKeys = useOpenApiKeys();
  const openMicrophone = useOpenMicrophone();
  const [call, setCall] = useState<VoiceCallState | undefined>(undefined);
  const meters = useRef<Meters | undefined>(undefined);
  const [levels] = useState(() => levelsOf(meters));
  // Note that the microphone's opener and the press's audio context are refs, because the session reads them when a start connects, outside any render.
  const opener = useRef(openMicrophone);
  const pressed = useRef<AudioContext | undefined>(undefined);

  useEffect(() => {
    opener.current = openMicrophone;
  }, [openMicrophone]);

  const [session] = useState<VoiceCallSession>(() =>
    voiceCallSession({
      connect: (events) => {
        const context = pressed.current;
        pressed.current = undefined;

        return connectWindow(
          opener.current,
          context,
          (made) => {
            // Note that a peer let go clears the meters only where they are still its own, since a second call's may stand by then.
            if (made !== undefined || meters.current?.context === context) meters.current = made;
          },
          events,
        );
      },
      open: async ({ agentId, sdp }) => {
        const state = queryClient.getQueryData(appStateQuery.queryKey);

        const voice =
          (state === undefined ? undefined : selectAppSettingsView(state)?.voice) ??
          DEFAULT_LIVE_VOICE;

        const answer = await sendAct(ACT_KIND.VOICE_OPEN, { agentId, voice, sdp });

        if (!("failure" in answer)) return answer;

        return {
          failure:
            answer.failure === AGENT_CALL_FAILURE.OPENAI_KEY_MISSING
              ? VOICE_CALL_FAILURE.OPENAI_KEY_MISSING
              : VOICE_CALL_FAILURE.NOT_STARTED,
        };
      },
      now: () => Date.now(),
      onChange: setCall,
      onFailure: (failure, cause) => toastCallFailure(VOICE_CALL_NOTE[failure], cause),
    }),
  );

  const start = (into: { readonly agentId: string; readonly taskId: string }) => {
    if (on !== true) return;

    if (keyMissing) return openApiKeys();
    // Note that the meters' context is made here, in the press, since Safari runs one only from a gesture; the session's connect takes it at once.
    pressed.current = pressedContext();
    session.start(into);
  };

  // Note that the Voice experiment turned off ends a call under way, because no surface draws its End call once the feature stands nowhere.
  useEffect(() => {
    if (on === false) session.hangUp();
  }, [on, session]);

  // The window going away, or the provider with it, closes the session and drops the call.
  useEffect(() => {
    const hangUp = () => session.hangUp();
    window.addEventListener("pagehide", hangUp);

    return () => {
      window.removeEventListener("pagehide", hangUp);
      hangUp();
    };
  }, [session]);

  const value: VoiceCall = {
    call,
    start,
    end: session.end,
    setMicrophoneMuted: session.setMicrophoneMuted,
    setSpeakerMuted: session.setSpeakerMuted,
    levels,
  };

  return <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>;
}

/** The window's voice call, and what a surface may do with it. */
export function useVoiceCall(): VoiceCall {
  return useContext(VoiceCallContext);
}
