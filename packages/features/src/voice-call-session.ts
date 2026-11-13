/**
 * voice-call-session.ts -- one client's voice call into an agent, held apart from its platform: where the call stands, its mutes, and the events its channel takes and tells, over a peer the client makes.
 *
 * A client carries only the call's audio (`voice-wire.ts`): it makes a
 * WebRTC peer with the microphone's track and the `oai-events` data
 * channel, has the service open the session on its offer (`voice.open`),
 * and sets the answer. The service holds the rest of the call over its own
 * connection to the session. What stays the same on every client is held
 * here, DOM-free, so the iPhone's call and any other run one machine: one
 * call at a time, a second start ending the first; connecting until the
 * session says it started, then live and timed from then; a microphone
 * muted before the session started told the moment it does, since the
 * session takes no command before, while the silenced track sends nothing
 * meanwhile; End telling the session `session.close` and closing the
 * channel, which sends what it holds first, the call dropped once the
 * channel has closed, and an End pressed before the channel opened closing
 * whatever session the service still answers with once it does; and a
 * `session.closed`, a failed peer, or a refusal dropping it at once and
 * saying why. The platform's half, the microphone,
 * the peer, and the speaker, is the `VoiceCallPeer` its client makes.
 *
 * Each start is a generation of its own, because a microphone or an answer
 * arriving after its call was ended must find it gone and let go of what it
 * opened.
 */

import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { VOICE_CALL_STAGE, type VoiceCallStage } from "./voice-wire.js";

/** The channel GPT-Live's events ride on, by the name the client opens it under. */
export const VOICE_EVENTS_CHANNEL = "oai-events";

/** The client events the session's allowlist takes from a client, and the server events it is told. */
export const LIVE_EVENT = {
  MUTE: "session.input_audio.mute",
  UNMUTE: "session.input_audio.unmute",
  CLOSE: "session.close",
  STARTED: "session.started",
  CLOSED: "session.closed",
} as const;

/** The client events a client may send: mute, unmute, and close, and nothing else. */
export type LiveClientEvent = (typeof LIVE_EVENT)["MUTE" | "UNMUTE" | "CLOSE"];

/** Why a call stopped short, which each client says in its own words. */
export const VOICE_CALL_FAILURE = {
  /** The platform refused the microphone to the app. */
  MICROPHONE_DENIED: "microphone-denied",
  /** The microphone could not be opened. */
  MICROPHONE_FAILED: "microphone-failed",
  /** The account saved no OpenAI API key to speak on. */
  OPENAI_KEY_MISSING: "openai-key-missing",
  /** The service, or the peer, could not open the call. */
  NOT_STARTED: "not-started",
  /** The peer failed while the call stood. */
  DROPPED: "dropped",
} as const;

export type VoiceCallFailure = (typeof VOICE_CALL_FAILURE)[keyof typeof VOICE_CALL_FAILURE];

/** The call standing, as a surface draws it. */
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

/** The agent a call speaks to, and the task it works on. */
export interface VoiceCallInto {
  readonly agentId: string;
  readonly taskId: string;
}

/** What the platform's peer hears and tells the session about: a server event's text, its channel opening and closing, and the peer failing. */
export interface VoiceCallPeerEvents {
  readonly onMessage: (text: string) => void;
  readonly onChannelOpen: () => void;
  readonly onChannelClosed: () => void;
  readonly onFailed: () => void;
}

/**
 * The platform's half of one call: the microphone opened, its track on a
 * peer with the events channel, and the voice played as it arrives.
 */
export interface VoiceCallPeer {
  /** The peer's SDP offer, set as its local description. */
  readonly offer: () => Promise<string>;
  /** Sets the service's SDP answer as the peer's remote description. */
  readonly answer: (sdp: string) => Promise<void>;
  /** Whether the events channel is open to take an event. */
  readonly channelOpen: () => boolean;
  /** Sends one client event on the channel. */
  readonly send: (text: string) => void;
  /** Closes the channel, which sends what it holds first; `onChannelClosed` follows. */
  readonly closeChannel: () => void;
  /** Silences the microphone's track, or sounds it again. */
  readonly silenceMicrophone: (muted: boolean) => void;
  /** Silences the voice on this device alone, or sounds it again. */
  readonly silenceSpeaker: (muted: boolean) => void;
  /** Lets everything go: the peer closed, the microphone's light out, the voice stopped. */
  readonly release: () => void;
}

/** The microphone and peer the platform made, or why the microphone did not open. */
export type VoiceCallConnected =
  | { readonly peer: VoiceCallPeer }
  | {
      readonly refused:
        | typeof VOICE_CALL_FAILURE.MICROPHONE_DENIED
        | typeof VOICE_CALL_FAILURE.MICROPHONE_FAILED;
    };

/** The service's answer to an offer: the call opened, or why not. */
export type VoiceCallOpened =
  | { readonly callId: string; readonly sdp: string }
  | {
      readonly failure:
        | typeof VOICE_CALL_FAILURE.OPENAI_KEY_MISSING
        | typeof VOICE_CALL_FAILURE.NOT_STARTED;
    };

/** What a call session is made over: the platform's peer, the service's open, the clock, and where it reports. */
export interface VoiceCallSessionSeams {
  /** Opens the microphone and makes the peer over it, hearing `events`. */
  readonly connect: (events: VoiceCallPeerEvents) => Promise<VoiceCallConnected>;
  /** Has the service open the session on the offer. */
  readonly open: (offer: {
    readonly agentId: string;
    readonly sdp: string;
  }) => Promise<VoiceCallOpened>;
  readonly now: () => number;
  /** Hears the call each time it changes; nothing once none stands. */
  readonly onChange: (call: VoiceCallState | undefined) => void;
  /** Hears why a call stopped short. */
  readonly onFailure: (failure: VoiceCallFailure, cause: unknown) => void;
}

/** A client's call and what a surface may do with it. */
export interface VoiceCallSession {
  readonly current: () => VoiceCallState | undefined;
  /** Calls the agent, ending a call already standing first. */
  readonly start: (into: VoiceCallInto) => void;
  /** Tells the session the call ends and closes its channel; a call with no channel yet is let go at once. */
  readonly end: () => void;
  /** Tells the session the call ends and drops it at once, as a client going away does. */
  readonly hangUp: () => void;
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
}

/** The one field of a server event the call reads: its type, every other key let go. */
const readServerEvent = readEither(EffectSchema.Struct({ type: EffectSchema.String }), {
  excess: EXCESS_KEYS.DROP,
});

/** The type a server event names; nothing for a message that is not one. */
export function liveEventType(text: string): string | undefined {
  try {
    return Result.getOrUndefined(readServerEvent(unparsedWire(JSON.parse(text))))?.type;
  } catch {
    return undefined;
  }
}

/** The text of one client event, as the channel carries it. */
export function liveClientEvent(type: LiveClientEvent): string {
  return JSON.stringify({ type });
}

/**
 * One start's machinery: the peer once it stands, and whether the call was
 * ended before its channel opened, which leaves the session it may already
 * hold for this attempt to close.
 */
interface Attempt {
  readonly asked: number;
  made: VoiceCallPeer | undefined;
  abandoned: boolean;
}

/**
 * A call session over `seams`, holding one call at a time. Note that what a
 * surface draws is handed out through `onChange` while the machinery stays
 * here, because the peer's handlers outlive whatever drew the call: each
 * checks that the call it was made for still stands before it acts.
 *
 * A call ended before its channel opened is let go at once, but its peer is
 * kept until whatever session the service opened for it is closed: an
 * answer that lands after End is set all the same, and the channel it opens
 * is told `session.close` at once and closed, so no session outlives the
 * press that ended it. One ended before its offer reached the service asks
 * for none.
 */
export function voiceCallSession(seams: VoiceCallSessionSeams): VoiceCallSession {
  let call: VoiceCallState | undefined;
  let attempt: Attempt | undefined;
  let generation = 0;
  let sessionStarted = false;

  const change = (next: VoiceCallState | undefined) => {
    call = next;
    seams.onChange(next);
  };

  const tell = (held: VoiceCallPeer, type: LiveClientEvent) => {
    if (held.channelOpen()) held.send(liveClientEvent(type));
  };

  /** The peer of the call standing; none while its microphone opens or none stands. */
  const peerNow = () => attempt?.made;

  /**
   * Lets the call go, where it is still the one standing: its peer released,
   * or, where its channel is not open yet, kept to close the session it may
   * hold once it is (`abandon`).
   */
  const drop = (asked: number, abandon = false) => {
    if (generation !== asked) return;
    generation += 1;
    const held = attempt;
    attempt = undefined;

    if (held !== undefined && abandon) held.abandoned = true;
    else held?.made?.release();
    change(undefined);
  };

  const fail = (asked: number, failure: VoiceCallFailure, cause: unknown) => {
    if (generation !== asked) return;
    drop(asked);
    seams.onFailure(failure, cause);
  };

  /** Lets an attempt's peer go, where its call was ended before its channel opened. */
  const releaseAbandoned = (held: Attempt) => {
    if (held.abandoned) held.made?.release();
  };

  /** Hears the session's start and close, the channel opening and closing, and a peer that failed. */
  const eventsOf = (held: Attempt): VoiceCallPeerEvents => ({
    onMessage: (text) => {
      const type = liveEventType(text);

      if (type === LIVE_EVENT.CLOSED) {
        releaseAbandoned(held);

        return drop(held.asked);
      }

      if (type !== LIVE_EVENT.STARTED || generation !== held.asked || call === undefined) return;
      sessionStarted = true;

      if (held.made !== undefined && call.microphoneMuted) tell(held.made, LIVE_EVENT.MUTE);

      if (call.stage === VOICE_CALL_STAGE.CONNECTING) {
        change({ ...call, stage: VOICE_CALL_STAGE.LIVE, startedAt: seams.now() });
      }
    },
    // Note that a call ended before its channel opened closes the session the channel reaches, the moment it does.
    onChannelOpen: () => {
      if (!held.abandoned || held.made === undefined) return;
      tell(held.made, LIVE_EVENT.CLOSE);
      held.made.closeChannel();
    },
    // Note that a call ended by a second start is no longer the one standing, so its channel closing lets go of its own machinery alone.
    onChannelClosed: () => {
      held.made?.release();
      drop(held.asked);
    },
    onFailed: () => {
      releaseAbandoned(held);
      fail(held.asked, VOICE_CALL_FAILURE.DROPPED, "failed");
    },
  });

  /** Opens the call the start asked for: the microphone and the peer, then the session. */
  const open = async (held: Attempt, agentId: string) => {
    const connected = await seams.connect(eventsOf(held));

    if ("refused" in connected) return fail(held.asked, connected.refused, connected.refused);
    const made = connected.peer;
    held.made = made;

    if (generation !== held.asked) return made.release();
    // Note that a mute pressed while the microphone opened is kept on the call, and set on its peer here.
    made.silenceMicrophone(call?.microphoneMuted === true);
    made.silenceSpeaker(call?.speakerMuted === true);
    const sdp = await made.offer();

    // Note that a call ended while its offer was made asks the service for nothing, since no session should open for it.
    if (generation !== held.asked) return made.release();
    const answer = await seams.open({ agentId, sdp });

    if ("failure" in answer) {
      releaseAbandoned(held);

      return fail(held.asked, answer.failure, answer.failure);
    }

    if (generation === held.asked && call !== undefined) change({ ...call, callId: answer.callId });
    await made.answer(answer.sdp);
  };

  const end = () => {
    const held = peerNow();

    // Note that a call whose channel is not open yet is let go at once, its peer kept to close what the service opened for it.
    if (held === undefined || !held.channelOpen()) return drop(generation, true);
    tell(held, LIVE_EVENT.CLOSE);
    held.closeChannel();

    if (call !== undefined) change({ ...call, stage: VOICE_CALL_STAGE.ENDING });
  };

  const start = (into: VoiceCallInto) => {
    if (call !== undefined) end();
    generation += 1;
    const held: Attempt = { asked: generation, made: undefined, abandoned: false };
    // Note that the last call's peer is let go by its own channel, so no press on the new call reaches it meanwhile.
    attempt = held;
    sessionStarted = false;
    change({
      stage: VOICE_CALL_STAGE.CONNECTING,
      agentId: into.agentId,
      taskId: into.taskId,
      callId: undefined,
      startedAt: undefined,
      microphoneMuted: false,
      speakerMuted: false,
    });
    open(held, into.agentId).catch((cause: unknown) => {
      releaseAbandoned(held);
      fail(held.asked, VOICE_CALL_FAILURE.NOT_STARTED, cause);
    });
  };

  const hangUp = () => {
    const held = peerNow();

    if (held !== undefined && held.channelOpen()) {
      tell(held, LIVE_EVENT.CLOSE);

      return drop(generation);
    }

    drop(generation, true);
  };

  // A mute pressed before the session started is kept, and told as it starts.
  const setMicrophoneMuted = (muted: boolean) => {
    if (call === undefined) return;
    const held = peerNow();
    held?.silenceMicrophone(muted);

    if (held !== undefined && sessionStarted)
      tell(held, muted ? LIVE_EVENT.MUTE : LIVE_EVENT.UNMUTE);
    change({ ...call, microphoneMuted: muted });
  };

  // A speaker muted before the peer stands is kept, and set on the peer as it does.
  const setSpeakerMuted = (muted: boolean) => {
    if (call === undefined) return;
    peerNow()?.silenceSpeaker(muted);
    change({ ...call, speakerMuted: muted });
  };

  return {
    current: () => call,
    start,
    end,
    hangUp,
    setMicrophoneMuted,
    setSpeakerMuted,
  };
}
