/**
 * voice-call.tsx -- a voice call into an agent from the phone: the microphone out and the voice back over WebRTC, held at the app's root so it outlives every screen.
 *
 * The call's machine is `@repo/features/voice-call-session`'s, the one every
 * client runs; this holds the phone's half of it. A start opens the
 * microphone through react-native-webrtc, which asks the system the first
 * time (`NSMicrophoneUsageDescription` in `app.config.ts`), makes the peer's
 * SDP offer with its track and the `oai-events` data channel, and has the
 * service open the GPT-Live session on the account's own OpenAI key
 * (`voice.open` on the host's act port), in the voice the account chose
 * (Settings › Agents) or the default. The voice plays as its track arrives,
 * through WebRTC's own audio session, which it sets for voice chat while
 * the call stands, so the call keeps on with the screen locked
 * (`UIBackgroundModes: audio`). The service holds the rest of the call over
 * its own connection to the session: the phone carries audio and nothing
 * of the call's logic, and the data channel takes only mute, unmute, and
 * `session.close`.
 *
 * Whatever stops a call short says why in the app's failure notice, the
 * error buzz with it, and lets the microphone go. While a call stands the
 * agent's transcript is held followed, so the way back to it says what the
 * agent does from any screen, and the call stands in a Live Activity of its
 * own (`live-activity/call-activity.ts`), whose mutes and End call act on it
 * from the Lock Screen and the Dynamic Island. Nothing here starts while
 * signed out or behind the update screen, and either ends a call under way, since no End call stands then. No audio
 * leaves the phone but to the session, and none is stored or counted.
 */

import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE, TRANSCRIPT_KIND } from "@repo/features/agent-view";
import { type CallAgentLine, callAgentLine } from "@repo/features/call-agent-line";
import { LIVE_READ } from "@repo/features/live-wire";
import { agentName, providerOf } from "@repo/features/model-label";
import type { ModelProvider } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { savesOpenAiKey } from "@repo/features/provider-key-wire";
import {
  VOICE_CALL_FAILURE,
  VOICE_EVENTS_CHANNEL,
  type VoiceCallConnected,
  type VoiceCallFailure,
  type VoiceCallInto,
  type VoiceCallPeer,
  type VoiceCallPeerEvents,
  type VoiceCallSession,
  type VoiceCallState,
  voiceCallSession,
} from "@repo/features/voice-call-session";
import { callLineWords } from "@repo/features/voice-call-words";
import { DEFAULT_LIVE_VOICE } from "@repo/features/voices";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectAppSettingsView, selectTranscript } from "@repo/host/app-state-reads";
import {
  BUZZ,
  buzz,
  COMPOSER_CALL,
  type ComposerCall,
  NOTICE_KIND,
  type StandingCallCard,
  useFailureNotices,
} from "@repo/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type MediaStream, mediaDevices, RTCPeerConnection } from "react-native-webrtc";
import { appStateQuery } from "./host/app-state-query.js";
import {
  useHostActs,
  useHostFollow,
  useTaskListCollections,
  useTaskListRow,
} from "./host/host-provider.js";
import { useLiveFollow } from "./host/live-follow.js";
import { useCallLiveActivity } from "./live-activity/call-activity.js";
import { voiceAudioModule } from "./voice-audio-module.js";

/** Why a call stopped short, in the words the notice says, as the panel's toast says them but where the phone's settings differ. */
const VOICE_CALL_NOTE = {
  [VOICE_CALL_FAILURE.MICROPHONE_DENIED]: `The microphone is not allowed. Allow it in Settings › ${PRODUCT_NAME} › Microphone.`,
  [VOICE_CALL_FAILURE.MICROPHONE_FAILED]: "The microphone could not be opened.",
  [VOICE_CALL_FAILURE.OPENAI_KEY_MISSING]:
    "Add an OpenAI key in Settings › Agents on vespin.dev to talk with an agent.",
  [VOICE_CALL_FAILURE.NOT_STARTED]: "The call could not be started.",
  [VOICE_CALL_FAILURE.DROPPED]: "The call dropped.",
} as const satisfies Record<VoiceCallFailure, string>;

/** The names react-native-webrtc gives a microphone the system refused: its own, and the platform's. */
const MICROPHONE_DENIED_NAMES: ReadonlySet<string> = new Set(["SecurityError", "NotAllowedError"]);

/** The agent's name while the task list holds no row for it. */
const UNNAMED_AGENT = "Agent";

/** The call standing, as its way back draws it: the call, and its agent and task by name, with what the agent is doing. */
interface StandingVoiceCall extends VoiceCallState {
  readonly agentName: string;
  readonly provider: ModelProvider | undefined;
  readonly taskName: string | undefined;
  /** What the agent does: absent while it is idle, and its command while it runs one. */
  readonly agent: CallAgentLine | undefined;
}

/** The phone's call and what a screen may do with it. */
interface PhoneVoiceCall {
  /** Whether calls are offered at all: signed in, with no update screen in front of every other. */
  readonly offered: boolean;
  /** The call standing; nothing when none does. */
  readonly call: StandingVoiceCall | undefined;
  /** Calls the agent, ending a call already standing first. */
  readonly start: (into: VoiceCallInto) => void;
  /** Takes a press now for a call into an agent still starting, readying the microphone at once and answering what calls it once it lands; a press made since wins, so a late one calls no one. */
  readonly startWhenStarted: () => (into: VoiceCallInto | undefined) => void;
  readonly end: () => void;
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
}

const NO_CALL: PhoneVoiceCall = {
  offered: false,
  call: undefined,
  start: () => undefined,
  startWhenStarted: () => () => undefined,
  end: () => undefined,
  setMicrophoneMuted: () => undefined,
  setSpeakerMuted: () => undefined,
};

const VoiceCallContext = createContext<PhoneVoiceCall>(NO_CALL);

/** The microphone opened, or why the system did not let it open. */
async function openMicrophone(): Promise<
  { readonly stream: MediaStream } | Extract<VoiceCallConnected, { refused: unknown }>
> {
  try {
    return { stream: await mediaDevices.getUserMedia({ audio: true, video: false }) };
  } catch (cause) {
    const name = cause instanceof Object && "name" in cause ? String(cause.name) : "";

    return {
      refused: MICROPHONE_DENIED_NAMES.has(name)
        ? VOICE_CALL_FAILURE.MICROPHONE_DENIED
        : VOICE_CALL_FAILURE.MICROPHONE_FAILED,
    };
  }
}

/**
 * The phone's peer over the microphone: its track out, the voice played as
 * its track arrives, and the events channel, heard by `events`. Note that
 * react-native-webrtc plays a remote audio track by itself, so the speaker's
 * mute silences that track on this phone alone, and the voice plays from the
 * speaker, as ChatGPT's voice mode does, rather than the earpiece WebRTC's
 * own audio session picks, or from headphones while any are connected.
 */
async function connect(events: VoiceCallPeerEvents): Promise<VoiceCallConnected> {
  voiceAudioModule.preferSpeaker();
  const opened = await openMicrophone();

  if ("refused" in opened) return opened;
  const microphone = opened.stream;
  const peer = new RTCPeerConnection();
  let speakerMuted = false;
  const voices: { enabled: boolean }[] = [];

  peer.addEventListener("track", (event) => {
    const track = event.track;

    if (track === undefined || track === null) return;
    track.enabled = !speakerMuted;
    voices.push(track);
  });

  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed") events.onFailed();
  });

  for (const track of microphone.getTracks()) peer.addTrack(track, microphone);
  const channel = peer.createDataChannel(VOICE_EVENTS_CHANNEL);
  channel.addEventListener("message", (message) => events.onMessage(String(message.data)));
  channel.addEventListener("open", () => events.onChannelOpen());
  channel.addEventListener("close", () => events.onChannelClosed());

  const peerOf: VoiceCallPeer = {
    offer: async () => {
      const offer = await peer.createOffer({});
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
      speakerMuted = muted;

      for (const voice of voices) voice.enabled = !muted;
    },
    release: () => {
      peer.close();

      for (const track of microphone.getTracks()) track.stop();
      microphone.release();
    },
  };

  return { peer: peerOf };
}

/** The call's agent and task by name, and what the agent does, as the task list and its transcript hold them. */
function useStandingFacts(call: VoiceCallState | undefined) {
  const agentId = call?.agentId ?? "";
  const collections = useTaskListCollections();
  const agent = useTaskListRow(collections.agents, call?.agentId);
  const taskName = useTaskListRow(collections.tasks, call?.taskId ?? undefined)?.name;

  const selectRows = useMemo(
    () => selectTranscript({ kind: TRANSCRIPT_KIND.AGENT, agentId }),
    [agentId],
  );

  const messages = useQuery({ ...appStateQuery, select: selectRows, enabled: call !== undefined })
    .data?.rows?.messages;

  return {
    agentName: agent === undefined ? UNNAMED_AGENT : agentName(agent),
    provider: agent === undefined ? undefined : providerOf(agent.model),
    taskName,
    agent: callAgentLine(agent?.status, messages ?? []),
  };
}

/**
 * The phone's call, held for every screen beneath. Note that the session
 * is made once, over the host's acts, the query client, and the notice,
 * each of which its provider holds for the app's life, because the peer's
 * handlers outlive the render that made them.
 */
export function VoiceCallProvider({ children }: { readonly children: ReactNode }) {
  const acts = useHostActs();
  const follow = useHostFollow();
  const notices = useFailureNotices();
  const queryClient = useQueryClient();

  // Note that a call is offered only where its presses can stand: signed in, and with no update screen in front of every other.
  const { data: callable = false } = useQuery({
    ...appStateQuery,
    select: (state) =>
      state.account.status === ACCOUNT_STATUS.SIGNED_IN && state.network.updateNeeded !== true,
  });

  const [call, setCall] = useState<VoiceCallState | undefined>(undefined);

  const [session] = useState<VoiceCallSession>(() =>
    voiceCallSession({
      connect,
      open: async ({ agentId, sdp }) => {
        const state = queryClient.getQueryData(appStateQuery.queryKey);

        const voice =
          (state === undefined ? undefined : selectAppSettingsView(state)?.voice) ??
          DEFAULT_LIVE_VOICE;

        const answer = await acts[ACT_KIND.VOICE_OPEN]({ agentId, voice, sdp });

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
      onFailure: (failure, cause) => {
        console.warn(`The voice call stopped short: ${failure}`, cause);
        buzz(BUZZ.ERROR);
        notices.say({ kind: NOTICE_KIND.REFUSED, words: VOICE_CALL_NOTE[failure] });
      },
    }),
  );

  // Note that a sign-out or the update screen ends a call under way, because no screen draws its End call then; the provider going away hangs up too.
  useEffect(() => {
    if (!callable) session.hangUp();
  }, [callable, session]);
  useEffect(() => () => session.hangUp(), [session]);

  // The call's agent's transcript is held followed while the call stands, so its way back says what the agent does from any screen.
  const followedAgent = call?.agentId;
  useEffect(() => {
    if (followedAgent === undefined) return undefined;

    return follow(
      () =>
        acts[ACT_KIND.AGENTS_TRANSCRIPT]({ kind: TRANSCRIPT_KIND.AGENT, agentId: followedAgent }),
      () => undefined,
    );
  }, [acts, follow, followedAgent]);

  const facts = useStandingFacts(call);

  const standing = call === undefined ? undefined : { ...call, ...facts };
  useCallLiveActivity(standing, session);

  const value: PhoneVoiceCall = {
    offered: callable,
    call: standing,
    start: (into) => {
      if (callable) session.start(into);
    },
    // Note that the microphone and the peer's offer are readied in the press, while the agent starts, so the call opens the moment it lands; a press made since asks for the newer call, and the session lets this one go.
    startWhenStarted: () => {
      let land: (into: VoiceCallInto | undefined) => void = () => undefined;

      if (!callable) return land;
      session.startLanding(
        new Promise((resolve) => {
          land = resolve;
        }),
      );

      return land;
    },
    end: session.end,
    setMicrophoneMuted: session.setMicrophoneMuted,
    setSpeakerMuted: session.setSpeakerMuted,
  };

  return <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>;
}

/** The phone's voice call, and what a screen may do with it. */
function useVoiceCall(): PhoneVoiceCall {
  return useContext(VoiceCallContext);
}

/**
 * The call standing as its way back draws it, with the press that opens its
 * agent's page on the Tasks tab; none while no call stands, or where the
 * call is into `shown`, the agent whose page is in front, whose composer
 * holds the call's presses itself.
 */
export function useStandingCallCard(
  shown?: string | undefined,
): { readonly card: StandingCallCard; readonly open: () => void } | undefined {
  const voice = useVoiceCall();
  const router = useRouter();
  const { call } = voice;

  if (call === undefined || call.agentId === shown) return undefined;

  return {
    card: {
      agentName: call.agentName,
      harness: call.provider,
      taskName: call.taskName,
      line: callLineWords(call.stage, call.agent),
      presses: {
        microphoneMuted: call.microphoneMuted,
        speakerMuted: call.speakerMuted,
        onMicrophone: () => voice.setMicrophoneMuted(!call.microphoneMuted),
        onSpeaker: () => voice.setSpeakerMuted(!call.speakerMuted),
        onEnd: voice.end,
      },
    },
    open: () => router.push({ pathname: "/tasks/agent/[id]", params: { id: call.agentId } }),
  };
}

/** What Talk asks while a call into another agent stands, in the panel's words. */
const SWITCH_QUESTION = {
  TITLE: "End your other call?",
  MESSAGE: "You are on a call with another agent. Talking to this one ends that call.",
  ACT: "End and talk",
} as const;

/** An agent's composer taking calls: what it draws of them, and the question Talk asks first while a call into another agent stands. */
export interface AgentTalk {
  readonly call: ComposerCall | undefined;
  readonly switching: {
    readonly title: string;
    readonly message: string;
    readonly act: string;
    readonly presented: boolean;
    readonly onAct: () => void;
    readonly onDismiss: () => void;
  };
}

/**
 * The composer of the agent `agentId`, on the task `taskId`, taking calls,
 * as the panel's box does: Talk at rest, which asks first while a call into
 * another agent stands, since that call ends, and the call's presses while
 * the call is into this agent. None while calls are not offered or the
 * agent's task is not known.
 */
export function useAgentTalk(agentId: string, taskId: string | undefined): AgentTalk {
  const voice = useVoiceCall();
  const [asking, setAsking] = useState(false);
  const { call } = voice;

  const start = () => {
    setAsking(false);

    if (taskId !== undefined) voice.start({ agentId, taskId });
  };

  const switching = {
    title: SWITCH_QUESTION.TITLE,
    message: SWITCH_QUESTION.MESSAGE,
    act: SWITCH_QUESTION.ACT,
    presented: asking,
    onAct: start,
    onDismiss: () => setAsking(false),
  };

  if (!voice.offered || taskId === undefined) return { call: undefined, switching };

  if (call !== undefined && call.agentId === agentId) {
    return {
      call: {
        kind: COMPOSER_CALL.ON_CALL,
        presses: {
          microphoneMuted: call.microphoneMuted,
          speakerMuted: call.speakerMuted,
          onMicrophone: () => voice.setMicrophoneMuted(!call.microphoneMuted),
          onSpeaker: () => voice.setSpeakerMuted(!call.speakerMuted),
          onEnd: voice.end,
        },
      },
      switching,
    };
  }

  return {
    call: {
      kind: COMPOSER_CALL.TALK,
      onTalk: () => (call === undefined ? start() : setAsking(true)),
    },
    switching,
  };
}

/** The host's read of the account's saved keys, as a `select`: unread, failed, or its rows. */
function heldKeys(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.PROVIDER_KEYS][accountId];
}

/** Talk in a sheet that starts a new agent: its press, whether it may be pressed yet, and the question it asks first while another call stands. */
export interface NewAgentTalk {
  readonly onTalk: () => void;
  /** False while the account's keys are read, so a press never goes unanswered. */
  readonly ready: boolean;
  readonly switching: AgentTalk["switching"];
}

/**
 * Talk in a sheet that starts a new agent, as the panel's New task and
 * draft offer it: `start` starts the agent blank, handed nothing, and
 * answers it once it lands, or nothing where it was refused, and the call
 * opens on it, so the caller's first words are its first message. Note that
 * the account's keys are followed so that Talk with no OpenAI key starts
 * nothing and says to add one, rather than leaving an agent no call can
 * open on, and Talk stands disabled until they are read; a press while
 * another call stands asks first, as an agent's own Talk does. None while
 * calls are not offered.
 */
export function useNewAgentTalk(
  start: () => Promise<VoiceCallInto | undefined>,
): NewAgentTalk | undefined {
  const voice = useVoiceCall();
  const acts = useHostActs();
  const notices = useFailureNotices();
  const [asking, setAsking] = useState(false);
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const key = accountId ?? "";
  useLiveFollow(accountId, () => acts[ACT_KIND.PROVIDER_KEYS_FOLLOW]());
  const read = useQuery({ ...appStateQuery, select: useCallback(heldKeys(key), [key]) }).data;
  const keys = read?.rows?.keys;

  const go = () => {
    setAsking(false);
    // Note that the press is taken now, so a call pressed for while the agent starts stands over this one.
    void start().then(voice.startWhenStarted());
  };

  if (!voice.offered) return undefined;

  // Note that Talk waits on the keys' read, standing disabled meanwhile, since an agent started with no key could take no call; a read that failed leaves the key to the service, which refuses a call with none.
  const onTalk = () => {
    if (keys !== undefined && !savesOpenAiKey(keys)) {
      buzz(BUZZ.ERROR);
      notices.say({
        kind: NOTICE_KIND.REFUSED,
        words: VOICE_CALL_NOTE[VOICE_CALL_FAILURE.OPENAI_KEY_MISSING],
      });

      return;
    }

    if (voice.call === undefined) return go();
    setAsking(true);
  };

  return {
    onTalk,
    ready: keys !== undefined || read?.failed === true,
    switching: {
      title: SWITCH_QUESTION.TITLE,
      message: SWITCH_QUESTION.MESSAGE,
      act: SWITCH_QUESTION.ACT,
      presented: asking,
      onAct: go,
      onDismiss: () => setAsking(false),
    },
  };
}
