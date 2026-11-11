/**
 * use-agent-composer.ts -- an agent's composer as its page holds and sends it: the words and the pictures attached, a send that steers or queues as the member's Follow-up behavior says, Stop while the agent works, and the queue's Steer and Delete.
 *
 * Each send is the act the panel's box sends on the host's act port. While
 * no turn runs, Send opens one (`AGENTS_MESSAGE`); while one runs, it steers
 * that turn, or, where the member's Follow-up behavior is Queue, waits
 * behind it (`AGENTS_QUEUE`'s `add`), as the panel's Enter does. The queue
 * rides on the agent's own transcript (`AppTranscript.word.queue`), which
 * the host draws each change over at once and takes back where the service
 * refused it. A send not yet answered stands over the field as Sending, and
 * one refused hands its words and pictures back to the field, the refusal
 * said over it in the panel's words, and the phone buzzes as a refusal does.
 * Stop is offered while the agent may still write (`agentStillWriting`),
 * starting or awaiting its turn included, as the panel offers it.
 */

import {
  pausedWords,
  QUEUE_LEFT_WORDS,
  QUEUE_REFUSED_WORDS,
} from "@repo/features/agent-queue-words";
import {
  messageFailureWords,
  STOP_FAILED,
  STOP_NOTHING_YET,
} from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import { type AgentQueueChange, type AgentStatus, QUEUE_CHANGE } from "@repo/features/agent-wire";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { ACT_KIND } from "@repo/host/acts";
import type { AppTranscript } from "@repo/host/app-state";
import {
  type FollowedAgent,
  selectAppSettingsView,
  selectInboxReader,
} from "@repo/host/app-state-reads";
import { AGENT_ENTER } from "@repo/settings";
import { type AttachedPicture, BUZZ, buzz, type QueuedLine } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { type HeldPicture, useAttachedPictures } from "../use-attached-pictures.js";

/** What the field says before anything is typed, as the panel's box says it to a started agent. */
const PLACEHOLDER = "Send a follow-up";

/** A send out on the act port, not yet answered: what it carries, so a refusal hands it back. */
interface Sending {
  readonly id: string;
  readonly words: string;
  readonly pictures: readonly HeldPicture[];
}

/** What a queue change the host took back says, with where the message went where the service said it left the queue. */
function queueRefusalWords(change: AgentQueueChange["change"], failure: AgentCallFailure): string {
  const words = QUEUE_REFUSED_WORDS[change] ?? messageFailureWords(failure);
  return failure === AGENT_CALL_FAILURE.NOT_FOUND ? `${words} ${QUEUE_LEFT_WORDS}` : words;
}

/** The composer as the agent's page draws and presses it. */
export interface AgentComposer {
  readonly placeholder: string;
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** Whether Send stands lit with no words typed: a picture is attached. */
  readonly sendable: boolean;
  readonly send: () => void;
  /** Whether Send queues the message behind the turn rather than sending it to the agent now. */
  readonly sendQueues: boolean;
  readonly attached: readonly AttachedPicture[];
  readonly attach: () => void;
  readonly detach: (id: string) => void;
  /** Stops the turn under way; none while the agent rests. */
  readonly stop: (() => void) | undefined;
  readonly stopping: boolean;
  /** The messages queued behind the turn and the sends out, oldest first. */
  readonly queued: readonly QueuedLine[];
  /** Why the queue stands paused; none while it hands its messages on. */
  readonly paused: string | undefined;
  /** Sends a queued message now; none for a reader who did not start the agent, whose queue they read only. */
  readonly steer: ((id: string) => void) | undefined;
  readonly remove: ((id: string) => void) | undefined;
  /** What the last send, pick, Stop, or queue change that did not go said. */
  readonly note: string | undefined;
}

/**
 * The composer of the agent `agentId` names, whose followed row is `agent`
 * and whose transcript the page holds as `transcript`. Only the agent's
 * starter may change its queue, as the service holds, so a teammate's
 * Send never queues and their queue offers no Steer or Delete. `onMessage`
 * hears each message sent straight to the agent, and whether it was taken.
 */
export function useAgentComposer(
  agentId: string,
  agent: FollowedAgent | undefined,
  transcript: AppTranscript | undefined,
  status: AgentStatus | undefined,
  onMessage?: (taken: Promise<boolean>) => void,
): AgentComposer {
  const acts = useHostActs();
  const { data: enterQueues = false } = useQuery({
    ...appStateQuery,
    select: (state) => selectAppSettingsView(state)?.agentEnter === AGENT_ENTER.QUEUE,
  });
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const [words, setWords] = useState("");
  const [sending, setSending] = useState<readonly Sending[]>([]);
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);
  const [stopping, setStopping] = useState(false);
  const writing = status !== undefined && agentStillWriting(status);
  // Note that an agent on the retired runtime keeps no queue, and only its starter changes one.
  const starter = agent?.startedBy;
  const controlsQueue =
    agent?.runtime !== undefined && (starter === undefined || starter.userId === readerId);
  // Note that a message sent to the agent now denies a call it holds for an answer, while one queued waits behind it.
  const sendQueues = writing && enterQueues && controlsQueue;
  // A Stop stands pressed until the agent stops writing.
  useEffect(() => {
    if (!writing) setStopping(false);
  }, [writing]);
  // A send refused: its words and pictures back in the field, ahead of anything typed since, and the refusal said.
  const handBack = (sent: Sending, refusal: string) => {
    setSending((out) => out.filter(({ id }) => id !== sent.id));
    setWords((typed) => (typed.trim() === "" ? sent.words : `${sent.words}\n${typed}`));
    pictures.putBack(sent.pictures);
    setNote(refusal);
    buzz(BUZZ.ERROR);
  };
  const settled = (sent: Sending) => {
    setSending((out) => out.filter(({ id }) => id !== sent.id));
    buzz(BUZZ.SUCCESS);
  };
  const send = () => {
    const text = words.trim();
    if (text === "" && pictures.files === undefined) return;
    if (pictures.refusal !== undefined) {
      setNote(pictures.refusal);
      buzz(BUZZ.WARNING);
      return;
    }
    const attachments =
      pictures.files === undefined ? undefined : { attachments: [...pictures.files] };
    const sent: Sending = { id: randomUUID(), words: text, pictures: pictures.take() };
    setSending((out) => [...out, sent]);
    setWords("");
    setNote(undefined);
    if (sendQueues) {
      const change = { change: QUEUE_CHANGE.ADD, id: sent.id, text, ...attachments } as const;
      acts[ACT_KIND.AGENTS_QUEUE]({ agentId, change })
        .then((answer) => {
          if ("failure" in answer) handBack(sent, queueRefusalWords(change.change, answer.failure));
          else settled(sent);
        })
        .catch((error: unknown) => {
          console.error("The queued message did not go.", error);
          handBack(sent, queueRefusalWords(change.change, AGENT_CALL_FAILURE.UNANSWERED));
        });
      return;
    }
    const message = acts[ACT_KIND.AGENTS_MESSAGE]({
      agentId,
      text,
      clientKey: sent.id,
      ...attachments,
    });
    onMessage?.(
      message.then(
        (answer) => !("failure" in answer),
        () => false,
      ),
    );
    message
      .then((answer) => {
        if ("failure" in answer) handBack(sent, messageFailureWords(answer.failure));
        else settled(sent);
      })
      .catch((error: unknown) => {
        console.error("The message did not go.", error);
        handBack(sent, messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED));
      });
  };
  const stop = () => {
    setStopping(true);
    setNote(undefined);
    acts[ACT_KIND.AGENTS_STOP]({ agentId })
      .then((answer) => {
        if ("failure" in answer) throw new Error(`The stop was refused: ${answer.failure}.`);
        if (agentStillWriting(answer.agent.status)) {
          setStopping(false);
          setNote(STOP_NOTHING_YET);
        }
      })
      .catch((error: unknown) => {
        console.error("The stop did not go.", error);
        setStopping(false);
        setNote(STOP_FAILED);
        buzz(BUZZ.ERROR);
      });
  };
  const change = (next: AgentQueueChange) => {
    setNote(undefined);
    acts[ACT_KIND.AGENTS_QUEUE]({ agentId, change: next })
      .then((answer) => {
        if ("failure" in answer) setNote(queueRefusalWords(next.change, answer.failure));
      })
      .catch((error: unknown) => {
        console.error("The queue change did not go.", error);
        setNote(queueRefusalWords(next.change, AGENT_CALL_FAILURE.UNANSWERED));
      });
  };
  const queue = transcript?.word?.queue;
  const held = queue?.messages ?? [];
  const queued: readonly QueuedLine[] = [
    ...held.map((message) => ({
      id: message.id,
      words: message.text,
      sending: false,
    })),
    // A queued send the queue already carries stands once, as queued.
    ...sending
      .filter(({ id }) => !held.some((message) => message.id === id))
      .map(({ id, words: sent, pictures: carried }) => ({
        id,
        words: sent === "" ? carried.map(({ file }) => file.name).join(", ") : sent,
        sending: true,
      })),
  ];
  return {
    placeholder: PLACEHOLDER,
    sendQueues,
    words,
    onWords: (typed) => {
      setWords(typed);
      setNote(undefined);
    },
    sendable: pictures.files !== undefined,
    send,
    attached: pictures.attached,
    attach: pictures.attach,
    detach: pictures.detach,
    stop: writing ? stop : undefined,
    stopping,
    queued,
    paused: queue?.paused === undefined ? undefined : pausedWords(queue.paused),
    steer: controlsQueue
      ? (messageId) => change({ change: QUEUE_CHANGE.STEER, messageId })
      : undefined,
    remove: controlsQueue
      ? (messageId) => change({ change: QUEUE_CHANGE.DELETE, messageId })
      : undefined,
    note,
  };
}
