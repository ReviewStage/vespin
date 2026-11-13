/**
 * standing-call.tsx -- the window's voice call as its card draws it: told to the Mac for the floating window, and docked where the window is not on the call's agent.
 *
 * One card, drawn in whichever one place the call is not otherwise on
 * screen: at the foot of the column at the window's left (the tasks'
 * sidebar, Settings' page list) while the window shows anything but the
 * call's agent, in the window's bottom-left corner while the sidebar is
 * folded, and alone in the floating window while no window of the app has
 * the keyboard. The window's root reads the call once (`StandingCallProvider`):
 * its task's name, its agent's line from the agent's live transcript, and
 * its mutes, which every dock below draws, and which the shell tells the
 * Mac (`AppPlatform.voiceCall`). A press on the floating card comes back as
 * a push and is answered here as a press on the window's own card.
 */

import { TRANSCRIPT_KIND } from "@repo/features/agent-view";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { type StandingCall, VOICE_BOUNDS, VOICE_CALL_PRESS } from "@repo/features/voice-wire";
import { CallCard, type CallCardSurface } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { appBridge } from "../app-bridge.js";
import { appPlatform } from "../app-platform.js";
import { transcriptQuery } from "../live-reads.js";
import { appStateQuery, selectListedTasks } from "../use-app-state.js";
import { useVoiceCall } from "../voice-call.js";
import { callAgentLine } from "./call-agent-line.js";
import { type CallCardOf, type CallCardPresses, callCardOf } from "./call-card-of.js";

/** The card's name while neither the call's task nor its agent is listed. */
const UNNAMED_CALL = "Call";

const NO_MESSAGES: readonly AgentTranscriptMessage[] = [];

/** The card the window draws, while a call stands, with the agent it is about. */
interface StandingCard {
  readonly agentId: string;
  readonly card: CallCardOf;
}

const StandingCardContext = createContext<StandingCard | undefined>(undefined);

/** The agent the window shows in its work, the call's agent's card giving way to it there; none on a page that shows no agent. */
const CallAgentShownContext = createContext<string | undefined>(undefined);

/** Says which agent the window shows, to every dock beneath. */
export const CallAgentShown = CallAgentShownContext.Provider;

/** Cuts words to what the Mac takes of a card's line. */
function bounded(words: string): string {
  return words.slice(0, VOICE_BOUNDS.MAX_CARD_CHARS);
}

/** The call's name and its agent's status, as the task list holds them. */
function useListedFacts(taskId: string | undefined, agentId: string | undefined) {
  return useQuery({
    ...appStateQuery,
    select: (state) => {
      const tasks = selectListedTasks(state);
      const task = tasks.tasks.find((each) => each.id === taskId);
      const agent = tasks.taskAgents?.find((each) => each.id === agentId);

      return { name: task?.name ?? agent?.title ?? UNNAMED_CALL, status: agent?.status };
    },
  }).data;
}

/**
 * The window's call as its card draws it, told to the Mac each time it
 * changes and handed to every dock below. Note that the agent's transcript
 * is held for as long as the call stands, because the card says what the
 * agent does while its own tab is not on screen.
 */
export function StandingCallProvider({
  onShowAgent,
  children,
}: {
  /** Opens an agent on its task, as the window's way to it. */
  onShowAgent: (taskId: string, agentId: string) => void;
  children: ReactNode;
}): React.JSX.Element {
  const voice = useVoiceCall();
  const { call } = voice;
  const facts = useListedFacts(call?.taskId, call?.agentId);

  const messages = useQuery({
    ...transcriptQuery(
      call === undefined ? undefined : { kind: TRANSCRIPT_KIND.AGENT, agentId: call.agentId },
    ),
  }).data?.messages;

  const line = callAgentLine(facts?.status, messages ?? NO_MESSAGES);
  const action = line?.action;
  const working = line !== undefined;

  const standing = useMemo<StandingCall | null>(() => {
    if (call === undefined) return null;
    const agent = working ? { agent: action === undefined ? {} : { action: bounded(action) } } : {};

    return {
      agentId: call.agentId,
      taskId: call.taskId,
      name: bounded(facts?.name ?? UNNAMED_CALL),
      stage: call.stage,
      microphoneMuted: call.microphoneMuted,
      speakerMuted: call.speakerMuted,
      ...agent,
    };
  }, [call, facts?.name, working, action]);

  useEffect(() => appPlatform().voiceCall?.(standing), [standing]);

  // Note that the presses read the call through a ref, because a press from the floating window lands outside any render.
  const latest = useRef({ voice, onShowAgent });
  latest.current = { voice, onShowAgent };

  const [presses] = useState<CallCardPresses>(() => ({
    setMicrophoneMuted: (muted) => latest.current.voice.setMicrophoneMuted(muted),
    setSpeakerMuted: (muted) => latest.current.voice.setSpeakerMuted(muted),
    end: () => latest.current.voice.end(),
    open: () => {
      const { voice: now, onShowAgent: show } = latest.current;

      if (now.call !== undefined) show(now.call.taskId, now.call.agentId);
    },
  }));

  useEffect(
    () =>
      appBridge().onVoiceCallPress((press) => {
        if (press.press === VOICE_CALL_PRESS.MICROPHONE) presses.setMicrophoneMuted(press.muted);
        else if (press.press === VOICE_CALL_PRESS.SPEAKER) presses.setSpeakerMuted(press.muted);
        else if (press.press === VOICE_CALL_PRESS.END) presses.end();
      }),
    [presses],
  );

  const value = useMemo<StandingCard | undefined>(
    () =>
      standing === null
        ? undefined
        : { agentId: standing.agentId, card: callCardOf(standing, presses) },
    [standing, presses],
  );

  return <StandingCardContext.Provider value={value}>{children}</StandingCardContext.Provider>;
}

/**
 * The window's card, docked here while `docked` and the window is not on
 * the call's agent, and kept through its slide out once it is not, from the
 * last card it drew, until that slide has ended. Its name is the task's, a
 * person's words, so it is masked in a recording whatever stands around it.
 */
export function CallCardDock({
  docked,
  surface,
}: {
  docked: boolean;
  surface: CallCardSurface;
}): React.JSX.Element | null {
  const standing = useContext(StandingCardContext);
  const agentShown = useContext(CallAgentShownContext);

  const card =
    docked && standing !== undefined && standing.agentId !== agentShown ? standing.card : undefined;

  const last = useRef(card);

  if (card !== undefined) last.current = card;

  const [gone, setGone] = useState(card === undefined);

  if (card !== undefined && gone) setGone(false);
  const drawn = card ?? (gone ? undefined : last.current);

  if (drawn === undefined) return null;

  return (
    <ReplayMask>
      <CallCard
        {...drawn}
        surface={surface}
        leaving={card === undefined}
        onLeft={() => setGone(true)}
      />
    </ReplayMask>
  );
}
