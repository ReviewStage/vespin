/**
 * use-agent-composer.ts -- an agent's composer as its page holds and sends it: the words and the pictures attached, a send that steers or queues as the member's Follow-up behavior says, Stop while the agent works, and the queue's Steer and Delete.
 *
 * Each send is the act the panel's box sends on the host's act port. While
 * no turn runs, Send opens one (`AGENTS_MESSAGE`); while one runs, it steers
 * that turn, or, where the member's Follow-up behavior is Queue, waits
 * behind it (`AGENTS_QUEUE`'s `add`), as the panel's Enter does. The queue
 * rides on the agent's own transcript (`AppTranscript.word.queue`), which
 * the host draws each change over at once and takes back where the service
 * refused it. A message on its way stands in the transcript as the member's
 * own line, as the host draws it from the moment it is sent
 * (`AppTranscript.sending`), and one queued in the queue over the field, so
 * the phone draws the one record every window draws. One refused hands its
 * words and pictures back to the field, the refusal said over it in the
 * panel's words, its line let go (`AGENTS_UNSEND`), and the phone buzzes as
 * a refusal does.
 * Stop is offered while the agent may still write (`agentStillWriting`),
 * starting or awaiting its turn included, as the panel offers it. A `/`
 * offers the skills of the agent's task's repository (`use-skill-offer.ts`).
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
import {
  type AgentAttachment,
  type AgentQueueChange,
  type AgentStatus,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { type SuggestionSendResult, suggestedWords } from "@repo/features/suggestion-model";
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
import { sentLineId } from "@repo/wire/host-ids";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { type HeldPicture, useAttachedPictures } from "../use-attached-pictures.js";
import { type SkillsOffered, useSkillOffer } from "../use-skill-offer.js";
import { useWrite } from "../use-write.js";

/** What the field says before anything is typed, as the panel's box says it to a started agent. */
const PLACEHOLDER = "Send a follow-up";

/** A send out on the act port: what it carries, so a refusal hands it back. */
interface Sent {
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
  /** Attaches pictures dropped on the composer, on an iPad, by the files the drop kept. */
  readonly dropPictures: (uris: readonly string[], unreadable: number) => void;
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
  /** The skills a `/` being typed offers; none while no `/` word ends the words. */
  readonly skills: SkillsOffered | undefined;
}

/** A message suggestion a box was opened on: its button, by which its words are laid in once, the words, and the send that goes through it in place of a message. */
export interface SuggestedSend {
  readonly key: string;
  readonly words: string;
  readonly send: (
    text: string,
    attachments: readonly AgentAttachment[],
  ) => Promise<SuggestionSendResult>;
}

/**
 * The composer of the agent `agentId` names, whose followed row is `agent`
 * and whose transcript the page holds as `transcript`. Only the agent's
 * starter may change its queue, as the service holds, so a teammate's
 * Send never queues and their queue offers no Steer or Delete. `onMessage`
 * hears each message sent straight to the agent, and whether it was taken.
 * Opened on a message suggestion (`suggested`), the box lays its words in
 * under anything typed, offers no queue, and its Send goes through the
 * suggestion, once, as the panel's box filled in from one does: while that
 * send is out, a second Send waits with its words in the field, and once it
 * lands the box sends as any other.
 */
export function useAgentComposer(
  agentId: string,
  agent: FollowedAgent | undefined,
  transcript: AppTranscript | undefined,
  status: AgentStatus | undefined,
  onMessage?: (taken: Promise<boolean>) => void,
  suggested?: SuggestedSend | undefined,
): AgentComposer {
  const acts = useHostActs();
  const write = useWrite();

  const { data: enterQueues = false } = useQuery({
    ...appStateQuery,
    select: (state) => selectAppSettingsView(state)?.agentEnter === AGENT_ENTER.QUEUE,
  });

  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const [words, setWords] = useState("");
  // The suggestion whose words the box last laid in, so each is laid in once.
  const [laidFor, setLaidFor] = useState<string | undefined>(undefined);

  if (suggested !== undefined && suggested.key !== laidFor) {
    setLaidFor(suggested.key);
    setWords((typed) => suggestedWords(typed, suggested.words));
  }

  // Whether a send through the suggestion is out, so a second never goes through its one press.
  const [suggestionOut, setSuggestionOut] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);
  const [stopping, setStopping] = useState(false);
  const writing = status !== undefined && agentStillWriting(status);
  // Note that an agent on the retired runtime keeps no queue, and only its starter changes one.
  const starter = agent?.startedBy;

  const controlsQueue =
    agent?.runtime !== undefined && (starter === undefined || starter.userId === readerId);

  // Note that a message sent to the agent now denies a call it holds for an answer, while one queued waits behind it.
  const sendQueues = suggested === undefined && writing && enterQueues && controlsQueue;
  const planId = agent?.planId;
  const skills = useSkillOffer(words, setWords, planId === undefined ? undefined : { planId });

  // Whether the screen still stands, since a refusal may land after it was left.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  // A Stop stands pressed until the agent stops writing.
  useEffect(() => {
    if (!writing) setStopping(false);
  }, [writing]);

  // A send refused: its words and pictures back in the field, ahead of anything typed since, and the refusal said.
  const handBack = (sent: Sent, refusal: string) => {
    setWords((typed) => (typed.trim() === "" ? sent.words : `${sent.words}\n${typed}`));
    pictures.putBack(sent.pictures);
    setNote(refusal);
  };

  // The lines this screen sent, whose refusal its own send hands back.
  const ownSends = useRef(new Set<string>());

  // A message refused while no screen of the agent stood, or sent from one since left, waits in the host's record,
  // which the phone draws no line of: its words come back to the field as this screen opens, the refusal said, and
  // the line is let go. Note that one carrying files is left in the record, where the desktop and the web draw it
  // with Retry, Edit, and Delete, because the phone holds none of their bytes and would let them go.
  const sending = transcript?.sending;
  useEffect(() => {
    for (const message of sending ?? []) {
      if (message.refused === undefined || ownSends.current.has(message.id)) continue;

      if ((message.files ?? []).length > 0) continue;
      ownSends.current.add(message.id);
      handBack(
        { id: message.clientKey, words: message.text, pictures: [] },
        messageFailureWords(message.refused.failure),
      );
      void acts[ACT_KIND.AGENTS_UNSEND]({ agentId, lineId: message.id }).catch(() => undefined);
    }
  }, [sending, acts, agentId]);

  const send = () => {
    const text = words.trim();

    if (text === "" && pictures.files === undefined) return;

    if (suggested !== undefined && suggestionOut) return;

    if (pictures.refusal !== undefined) {
      setNote(pictures.refusal);
      buzz(BUZZ.WARNING);

      return;
    }

    const attachments =
      pictures.files === undefined ? undefined : { attachments: [...pictures.files] };

    const sent: Sent = { id: randomUUID(), words: text, pictures: pictures.take() };
    ownSends.current.add(sentLineId(sent.id));
    setWords("");
    setNote(undefined);

    // A send refused says why in the composer, where its words go back, rather than in the notice.
    const saying = {
      inPlace: (words: string) => handBack(sent, words),
      went: BUZZ.SUCCESS,
    } as const;

    if (suggested !== undefined) {
      setSuggestionOut(true);
      write(() => suggested.send(text, attachments?.attachments ?? []), {
        ...saying,
        refused: (result) => ("failure" in result ? result.failure.text : undefined),
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      }).then(() => {
        setSuggestionOut(false);
      });

      return;
    }

    if (sendQueues) {
      const change = { change: QUEUE_CHANGE.ADD, id: sent.id, text, ...attachments } as const;
      write(() => acts[ACT_KIND.AGENTS_QUEUE]({ agentId, change }), {
        ...saying,
        refused: (answer) =>
          "failure" in answer ? queueRefusalWords(change.change, answer.failure) : undefined,
        unanswered: queueRefusalWords(change.change, AGENT_CALL_FAILURE.UNANSWERED),
      });

      return;
    }

    const message = acts[ACT_KIND.AGENTS_MESSAGE]({
      agentId,
      text,
      clientKey: sent.id,
      ...attachments,
      steers: writing,
      ...(planId === undefined ? undefined : { taskId: planId }),
    });

    onMessage?.(
      message.then(
        (answer) => !("failure" in answer),
        () => false,
      ),
    );
    write(() => message, {
      ...saying,
      // A refused message's words come back to the field, so its line in the host's record is let
      // go; a screen left meanwhile has no field to take them, so the line stands until a screen
      // of the agent opens again and takes them back.
      inPlace: (words: string) => {
        if (!mounted.current) return;
        handBack(sent, words);
        void acts[ACT_KIND.AGENTS_UNSEND]({ agentId, lineId: sentLineId(sent.id) }).catch(
          () => undefined,
        );
      },
      refused: (answer) => ("failure" in answer ? messageFailureWords(answer.failure) : undefined),
      unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
    });
  };

  const stop = () => {
    setStopping(true);
    setNote(undefined);
    // Note that a Stop taken while the agent still writes is no refusal: the agent stops at its next step, and the composer says so.
    write(
      () =>
        acts[ACT_KIND.AGENTS_STOP]({ agentId }).then((answer) => {
          if (!("failure" in answer) && agentStillWriting(answer.agent.status)) {
            setStopping(false);
            setNote(STOP_NOTHING_YET);
          }

          return answer;
        }),
      {
        refused: (answer) => ("failure" in answer ? STOP_FAILED : undefined),
        unanswered: STOP_FAILED,
        inPlace: (words) => {
          setStopping(false);
          setNote(words);
        },
      },
    );
  };

  const change = (next: AgentQueueChange) => {
    setNote(undefined);
    write(() => acts[ACT_KIND.AGENTS_QUEUE]({ agentId, change: next }), {
      refused: (answer) =>
        "failure" in answer ? queueRefusalWords(next.change, answer.failure) : undefined,
      unanswered: queueRefusalWords(next.change, AGENT_CALL_FAILURE.UNANSWERED),
      inPlace: setNote,
    });
  };

  const queue = transcript?.word?.queue;
  const held = queue?.messages ?? [];

  const queued: readonly QueuedLine[] = held.map((message) => ({
    id: message.id,
    words:
      message.text === ""
        ? (message.files ?? []).map((file) => file.name).join(", ")
        : message.text,
  }));

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
    dropPictures: pictures.drop,
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
    skills,
  };
}
