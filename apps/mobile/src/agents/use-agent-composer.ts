/**
 * use-agent-composer.ts -- an agent's composer as its page holds and sends it: the words and the pictures attached, a send that steers or queues as the member's Follow-up behavior says, Stop while the agent works, and the queue's Steer and Delete.
 *
 * Each send is the act the panel's box sends on the host's act port. A
 * Manager's message is its chat's own row (`AGENTS_CHAT_SEND`), which the
 * host draws on its way on the chat and keeps there marked Not delivered
 * where the service refused it, its Retry sending it again under its key
 * and its Edit and Delete letting it go (`AGENTS_CHAT_UNSEND`); it never
 * queues, since the Manager takes each line as it stands, and a sent
 * message's Edit saves its words in place, as a channel's edit does
 * (`AGENTS_CHAT_EDIT`): the message is marked edited and the Manager told,
 * and nothing is rewound or dropped. To any other
 * agent, while no turn runs, Send opens one (`AGENTS_MESSAGE`); while one runs, it steers
 * that turn, or, where the member's Follow-up behavior is Queue, waits
 * behind it (`AGENTS_QUEUE`'s `add`), as the panel's Enter does. The queue
 * rides on the agent's own transcript (`AppTranscript.word.queue`), which
 * the host draws each change over at once and takes back where the service
 * refused it. A message on its way stands in the transcript as the member's
 * own line, as the host draws it from the moment it is sent
 * (`AppTranscript.sending`), and one queued in the queue over the field, so
 * the phone draws the one record every window draws. One refused stays in
 * the transcript where it went, marked Not delivered, as the panel keeps it
 * rather than handing its words back to the field: Retry sends it again
 * under its key, Edit lays its words and pictures back in the field, ahead
 * of anything typed since, and Delete lets it go (`AGENTS_UNSEND`); the
 * refusal is said over the field in the panel's words, and the phone buzzes
 * as a refusal does. A queued message or a suggestion's send refused still
 * hands its words back, since the host keeps no line of it. A paste long
 * enough to bury the message is attached as a text file beside the
 * pictures (`useAttachedPictures`' `pasteText`). The field draws each
 * mention and each file attached as its pill, a file's marker placed where
 * the caret stands as it is attached, as the panel's box lays in its chip,
 * and a file whose pill is taken out of the words taken off.
 * Stop is offered while the agent may still write (`agentStillWriting`),
 * starting or awaiting its turn included, as the panel offers it. A `/`
 * offers the skills of the agent's task's repository (`use-skill-offer.ts`).
 * Edit on one of the member's sent lines lays its words in the field, the
 * field's own kept aside, and takes the keyboard; Send then sends them in
 * that line's place (`AGENTS_MESSAGE`'s `rewinds`), stopping the turn under
 * way rather than steering it, and asks first where anything follows the
 * line, in the panel's words (`editSendAsk`), since what it drops is gone.
 */

import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import {
  pausedWords,
  QUEUE_DELETE_QUESTION,
  QUEUE_LEFT_WORDS,
  QUEUE_REFUSED_WORDS,
} from "@repo/features/agent-queue-words";
import {
  messageFailureWords,
  STOP_FAILED,
  STOP_NOTHING_YET,
} from "@repo/features/agent-refusal-words";
import { editSendAsk } from "@repo/features/agent-rewind-model";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type ManagerChatSending,
  type SendingMessage,
} from "@repo/features/agent-view";
import {
  AGENT_KIND,
  type AgentAttachment,
  type AgentQueueChange,
  type AgentStatus,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { CHAT_THREAD_WORDS } from "@repo/features/manager-chat-view";
import {
  QUEUE_EDIT_SEND,
  type QueueEditSend,
  queueEditChange,
  queueEditLeft,
} from "@repo/features/queue-edit-model";
import { type SuggestionSendResult, suggestedWords } from "@repo/features/suggestion-model";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { ACT_KIND } from "@repo/host/acts";
import type { AppTranscript } from "@repo/host/app-state";
import {
  type FollowedAgent,
  selectAppSettingsView,
  selectInboxReader,
  selectManagerChat,
} from "@repo/host/app-state-reads";
import { AGENT_ENTER } from "@repo/settings";
import {
  BUZZ,
  buzz,
  type ComposerPills,
  type ComposerSaving,
  type ComposerSend,
  type QueuedLine,
  wordsHandedBack,
} from "@repo/ui-native";
import { sentLineId } from "@repo/wire/host-ids";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { type HeldPicture, useAttachedPictures } from "../use-attached-pictures.js";
import { type MentionsOffered, useMentionOffer } from "../use-mention-offer.js";
import { usePillField } from "../use-pill-field.js";
import { type SkillsOffered, useSkillOffer } from "../use-skill-offer.js";
import { useWrite } from "../use-write.js";
import { keepDraft, keptDraft } from "./composer-drafts.js";

/** What the field says before anything is typed, as the panel's box says it to a started agent. */
const PLACEHOLDER = "Send a follow-up";

/** A send out on the act port: what it carries, so a refusal hands it back. */
interface Sent {
  readonly id: string;
  readonly words: string;
  readonly pictures: readonly HeldPicture[];
}

/**
 * The words as typed and the pictures of each message this phone sent to an
 * agent, by the id its line is drawn under, until it went or was let go, so
 * a line the service refused is sent again or taken back with them. Note that
 * they are held beside the screens, so a refusal that lands once the page
 * was left still finds them, and in memory alone, since pictures may run to
 * megabytes: a relaunch, or a line sent from another device, keeps its line
 * and words but none of its pictures' bytes (`undeliveredWhole`).
 */
const heldSends = new Map<string, Sent>();

/** A file a chat message went with as the field holds it again: its picture drawn from its own bytes, a text file with no thumbnail. */
function heldPictureOf(file: AgentAttachment): HeldPicture {
  const address = file.mediaType.startsWith("image/")
    ? `data:${file.mediaType};base64,${file.data}`
    : undefined;

  return { id: randomUUID(), file, address };
}

/** Whether this phone holds every file a refused line went with, so its Retry sends it as it went. */
export function undeliveredWhole(line: SendingMessage): boolean {
  const files = (line.files ?? []).length;

  return files === 0 || heldSends.get(line.id)?.pictures.length === files;
}

/** What a line of the member's that the service refused offers, by the id it is drawn under. */
export interface UndeliveredActs {
  /** Sends it again under its key, as it went. */
  readonly retry: (lineId: string) => void;
  /** Lays its words and pictures back in the field, ahead of anything typed since, its line let go. */
  readonly edit: (lineId: string) => void;
  /** Lets it go, sending nothing. */
  readonly drop: (lineId: string) => void;
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
  /** Whether Send stands lit with no words typed: a picture or a pasted file is attached. */
  readonly sendable: boolean;
  /** Sends the words Send took out of the field (`ComposerSend`). */
  readonly send: ComposerSend;
  /** Whether Send queues the message behind the turn rather than sending it to the agent now. */
  readonly sendQueues: boolean;
  /** Opens Photos to attach pictures; none while the field holds a Manager chat message's words to save, since an edit writes words alone. */
  readonly attach: (() => void) | undefined;
  /** Attaches pictures dropped on the composer, on an iPad, by the files the drop kept; none while an edit writes words alone. */
  readonly dropPictures: ((uris: readonly string[], unreadable: number) => void) | undefined;
  /** Takes a long paste as a text file beside the pictures, answering whether it did; none while an edit writes words alone, so a long paste stays words. */
  readonly pasteText: ((words: string) => boolean) | undefined;
  /** Stops the turn under way; none while the agent rests. */
  readonly stop: (() => void) | undefined;
  readonly stopping: boolean;
  /** The messages queued behind the turn and the sends out, oldest first. */
  readonly queued: readonly QueuedLine[];
  /** Why the queue stands paused; none while it hands its messages on. */
  readonly paused: string | undefined;
  /** Sends a queued message now; none for a reader who did not start the agent, whose queue they read only. */
  readonly steer: ((id: string) => void) | undefined;
  /** Asks whether to delete a queued message, which `removing` then asks; none for a reader who did not start the agent. */
  readonly remove: ((id: string) => void) | undefined;
  /** The question a queued message's Delete asks first, as the panel's queue asks it, since its words and files go for good. */
  readonly removing: QueuedDeleteAsk;
  /** Puts the queued message at `from` at `to`, as the panel's drag drops it; none for a reader who did not start the agent. */
  readonly move: ((from: number, to: number) => void) | undefined;
  /** Lets a paused queue hand its messages on again; none for a reader who did not start the agent. */
  readonly resume: (() => void) | undefined;
  /** Takes a queued message's words into the field to edit, the field's own kept aside; none for a reader who did not start the agent. */
  readonly edit: ((id: string) => void) | undefined;
  /** Gives up the edit of a queued message, this field's or one another window left standing, the field given back what it held. */
  readonly cancelEdit: ((id: string) => void) | undefined;
  /** What Send does while the field holds a queued message's words; none while it holds its own. */
  readonly saving: ComposerSaving | undefined;
  /** What the last send, pick, Stop, or queue change that did not go said. */
  readonly note: string | undefined;
  /** The skills a `/` being typed offers; none while no `/` word ends the words. */
  readonly skills: SkillsOffered | undefined;
  /** The agents, tasks and people an `@` being typed offers; none while no `@` word ends the words, or while a `/` offers its skills. */
  readonly mentions: MentionsOffered | undefined;
  /** The field's pills: its door, which a pick of the `@` offer puts the mention's pill through, and the `@` word its caret stands in. */
  readonly pills: ComposerPills;
  /** Lays one of the member's sent lines' words in the field to send again in its place, the field's own kept aside, and has it take the keyboard. */
  readonly editMessage: (line: MessageEdit) => void;
  /** Gives up the edit of a sent line, the field given back what it held; none while the field holds no sent line's words. */
  readonly cancelMessageEdit: (() => void) | undefined;
  /** The question the send of a line written again asks first where anything follows it, as the panel's asks it. */
  readonly sendingEdit: QueuedDeleteAsk;
  /** Counts each time the field is asked to take the keyboard, as Edit asks it. */
  readonly focusAsk: number;
  /** Retry, Edit, and Delete on a line of the member's the service refused. */
  readonly undelivered: UndeliveredActs;
}

/** One of the member's sent lines opened to write again in its place: its id, its words, and what its send drops. */
interface MessageEdit {
  readonly messageId: string;
  readonly words: string;
  /** Whether anything follows the line, which the send drops, so it asks first. */
  readonly cuts: boolean;
  /** Another member's messages among those it drops, as "2 messages from Sam"; none where it drops none of theirs. */
  readonly takes: string | undefined;
}

/** A sent line open to write again, and the field's own words and pictures kept aside meanwhile. */
interface Rewriting {
  readonly line: MessageEdit;
  readonly words: string;
  readonly pictures: readonly HeldPicture[];
}

/** A queued message's Delete as `ConfirmAsk` asks it: the panel's words, whether it stands, and its answers. */
interface QueuedDeleteAsk {
  readonly title: string;
  readonly message: string;
  readonly act: string;
  readonly presented: boolean;
  readonly onAct: () => void;
  readonly onDismiss: () => void;
}

/** The field's own words and pictures kept aside while it holds the words of the queued message `id` names, in the edit `session` counts. */
interface EditStash {
  readonly id: string;
  readonly session: number;
  readonly words: string;
  readonly pictures: readonly HeldPicture[];
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
  /** The message of a Manager's chat whose thread the box replies in, by its id; none for the agent's own box. */
  thread?: string | undefined,
): AgentComposer {
  const acts = useHostActs();
  const write = useWrite();

  const { data: enterQueues = false } = useQuery({
    ...appStateQuery,
    select: (state) => selectAppSettingsView(state)?.agentEnter === AGENT_ENTER.QUEUE,
  });

  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const [words, setWords] = useState(() => keptDraft(agentId, thread)?.words ?? "");
  // The suggestion whose words the box last laid in, so each is laid in once.
  const [laidFor, setLaidFor] = useState(() => keptDraft(agentId, thread)?.laidFor);

  // The queued message whose words the field holds, and the field's own words and pictures kept aside meanwhile; none while it holds its own.
  const [editing, setEditing] = useState<EditStash | undefined>(undefined);
  // The sent line whose words the field holds to send in its place, and what it held before; none while it holds its own.
  const [rewriting, setRewriting] = useState<Rewriting | undefined>(undefined);
  // Whether the send of a line written again asks first.
  const [askingEdit, setAskingEdit] = useState(false);
  const [focusAsk, setFocusAsk] = useState(0);
  // Note that the field's own words are kept while it holds a queued message's or a sent line's, so a page drawn anew opens on the member's draft, not the message.
  const ownWords = editing?.words ?? rewriting?.words ?? words;

  // Note that the words and the suggestion laid in are kept beside the agent as they change, so a page drawn anew for it opens on them.
  useEffect(() => {
    keepDraft(
      agentId,
      thread,
      ownWords === "" && laidFor === undefined ? undefined : { words: ownWords, laidFor },
    );
  }, [agentId, thread, ownWords, laidFor]);

  if (suggested !== undefined && suggested.key !== laidFor) {
    setLaidFor(suggested.key);
    setWords((typed) => suggestedWords(typed, suggested.words));
  }

  // Whether a send through the suggestion is out, so a second never goes through its one press.
  const [suggestionOut, setSuggestionOut] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  // The queued message whose Delete asks, by its id; none while none asks.
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  // The edit standing, as an answer that lands later reads it.
  const editingNow = useRef<EditStash | undefined>(undefined);
  // How many edits this composer has opened, which numbers each edit's session.
  const sessions = useRef(0);
  // The edit whose Save or Steer is on its way, by its message's id, which the queue may send on before it answers.
  const [settling, setSettling] = useState<string | undefined>(undefined);
  // Whether the queue has listed the edited message since its edit opened, which its leaving the queue is read against.
  const [seenEdited, setSeenEdited] = useState(false);

  useEffect(() => {
    editingNow.current = editing;
  }, [editing]);
  const pictures = useAttachedPictures(setNote);
  const [stopping, setStopping] = useState(false);
  const writing = status !== undefined && agentStillWriting(status);
  // Note that an agent on the retired runtime keeps no queue, and only its starter changes one.
  const starter = agent?.startedBy;

  const controlsQueue =
    agent?.runtime !== undefined && (starter === undefined || starter.userId === readerId);

  // Note that a message sent to the agent now denies a call it holds for an answer, while one queued waits behind it.
  const sendQueues = suggested === undefined && writing && enterQueues && controlsQueue;

  // Whether the agent is a Manager, whose messages are its chat's rows (`AGENTS_CHAT_SEND`), drawn on their way on its chat as the host holds it. Note that a thread's box is a Manager chat's whatever the task list holds, so a reply never goes as a message to the agent.
  const chat =
    suggested === undefined && (thread !== undefined || agent?.kind === AGENT_KIND.MANAGER);

  const chatSelect = useMemo(() => selectManagerChat(agentId), [agentId]);
  const { data: chatHeld } = useQuery({ ...appStateQuery, select: chatSelect });
  const chatSending = chatHeld?.rows?.sending;
  const taskId = agent?.taskId ?? undefined;
  const skills = useSkillOffer(words, setWords, taskId === undefined ? undefined : { taskId });
  // The field, which draws each mention and each file attached as its pill.
  const pillField = usePillField(words, setWords, pictures);

  const mentions = useMentionOffer(
    { workspaceId: agent?.workspaceId, taskId, agentId },
    pillField.mentions,
  );

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

  // A send refused: its words and pictures back in the field, ahead of anything typed since, and the refusal said; while the field holds a queued message's words, they go to the draft kept aside, which the edit's end gives back.
  const handBack = (sent: Sent, refusal: string | undefined) => {
    setNote(refusal);

    if (editingNow.current !== undefined) {
      return setEditing((stash) =>
        stash === undefined
          ? stash
          : {
              ...stash,
              words: wordsHandedBack(sent.words, stash.words),
              pictures: [...sent.pictures, ...stash.pictures],
            },
      );
    }

    setWords((typed) => wordsHandedBack(sent.words, typed));
    pictures.putBack(sent.pictures);
  };

  /**
   * Sends the words Send took out of the field, answering whether it took
   * them. Note that the words and pictures it sends are those it took, never
   * a copy held by the render it was pressed in, so a press that reaches it
   * with a second one, before any render, sends once.
   */
  const send = (typed: string): boolean => {
    // Note that a send while the field holds a queued message's words saves them back in its place, as Save does.
    if (editing !== undefined) return sendEdit(QUEUE_EDIT_SEND.SAVE, typed);

    // Note that a line written again asks first where anything follows it, since its send drops that for good, its words and pictures left in the field while it asks, and taken out of it again once it is answered.
    if (rewriting !== undefined) {
      if (rewriting.line.cuts && typed.trim() !== "") {
        setAskingEdit(true);

        return false;
      }

      return sendRewritten(rewriting, typed);
    }

    // Note that the field holds each picked mention as its link already, so its words go as they stand.
    const text = typed.trim();

    if (suggested !== undefined && suggestionOut) return false;

    if (pictures.refusal !== undefined) {
      setNote(pictures.refusal);
      buzz(BUZZ.WARNING);

      return false;
    }

    const held = pictures.take();

    if (text === "" && held.length === 0) return false;

    const attachments =
      held.length === 0 ? undefined : { attachments: held.map(({ file }) => file) };

    const sent: Sent = { id: randomUUID(), words: text, pictures: held };
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

      return true;
    }

    // Note that a Manager's chat takes every message as a row of its own, the Manager taking it in as a turn's line or a steer as it stands, so it neither queues nor steers here; the host draws it on its way on the chat, and keeps one refused there marked Not delivered.
    if (chat) {
      sendChat(sent, attachments?.attachments);

      return true;
    }

    if (sendQueues) {
      const change = { change: QUEUE_CHANGE.ADD, id: sent.id, text, ...attachments } as const;
      write(() => acts[ACT_KIND.AGENTS_QUEUE]({ agentId, change }), {
        ...saying,
        refused: (answer) =>
          "failure" in answer ? queueRefusalWords(change.change, answer.failure) : undefined,
        unanswered: queueRefusalWords(change.change, AGENT_CALL_FAILURE.UNANSWERED),
      });

      return true;
    }

    const message = acts[ACT_KIND.AGENTS_MESSAGE]({
      agentId,
      text,
      clientKey: sent.id,
      ...attachments,
      steers: writing,
      ...(taskId === undefined ? undefined : { taskId: taskId }),
    });

    onMessage?.(
      message.then(
        (answer) => !("failure" in answer),
        () => false,
      ),
    );
    heldSends.set(sentLineId(sent.id), sent);
    write(() => message, {
      ...saying,
      // A refused message stays in the transcript marked Not delivered, the host keeping its line, so only the refusal is said over the field.
      inPlace: (words: string) => {
        if (mounted.current) setNote(words);
      },
      done: () => heldSends.delete(sentLineId(sent.id)),
      refused: (answer) => ("failure" in answer ? messageFailureWords(answer.failure) : undefined),
      unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
    });

    return true;
  };

  /** A message to a Manager's chat, which the host draws on its way and keeps marked Not delivered where the service refused it, with the pictures it went with held for its Retry and Edit. */
  const sendChat = (sent: Sent, attachments: readonly AgentAttachment[] | undefined) => {
    heldSends.set(sent.id, sent);
    write(
      () =>
        acts[ACT_KIND.AGENTS_CHAT_SEND]({
          agentId,
          text: sent.words,
          clientKey: sent.id,
          ...(attachments === undefined ? undefined : { attachments: [...attachments] }),
          ...(thread === undefined ? undefined : { threadRoot: thread }),
        }),
      {
        went: BUZZ.SUCCESS,
        inPlace: (refusal: string) => {
          if (mounted.current) setNote(refusal);
        },
        done: () => heldSends.delete(sent.id),
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    );
  };

  /** The field given back the words and pictures it held before a sent line's edit, the edit's own let go. */
  const giveBackRewritten = (stash: Rewriting) => {
    pictures.take();
    pictures.putBack(stash.pictures);
    setWords(stash.words);
    setRewriting(undefined);
  };

  /**
   * The words in the field saved in place of a Manager chat message's, as
   * the panel's Edit saves them, the field given back what it held; words as
   * they stand change nothing, and an edit refused says so over the field,
   * the message standing as it was for Edit to open again.
   */
  const saveChatEdit = (stash: Rewriting, text: string): boolean => {
    giveBackRewritten(stash);
    setNote(undefined);

    if (text === stash.line.words.trim()) return true;

    write(
      () =>
        acts[ACT_KIND.AGENTS_CHAT_EDIT]({
          agentId,
          messageId: stash.line.messageId,
          text,
          clientKey: randomUUID(),
        }),
      {
        went: BUZZ.SUCCESS,
        inPlace: (refusal: string) => {
          if (mounted.current) setNote(refusal);
        },
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    );

    return true;
  };

  /**
   * The words in the field sent in place of the sent line, the agent taken
   * back to just before it first, as the panel's Edit sends them; the field
   * given back what it held, and the words handed back where it was refused.
   * Note that it stops the turn under way rather than steering it. A
   * Manager's chat message is saved in place instead (`saveChatEdit`).
   */
  const sendRewritten = (stash: Rewriting, typed: string): boolean => {
    const text = typed.trim();

    if (text === "") return false;

    if (chat) return saveChatEdit(stash, text);

    // Note that pictures attached while the line was written again go with it, as the panel's Edit takes files.
    const held = pictures.take();

    const attachments =
      held.length === 0 ? undefined : { attachments: held.map(({ file }) => file) };

    const sent: Sent = { id: randomUUID(), words: text, pictures: held };
    setNote(undefined);
    giveBackRewritten(stash);

    heldSends.set(sentLineId(sent.id), sent);
    write(
      () =>
        acts[ACT_KIND.AGENTS_MESSAGE]({
          agentId,
          text,
          clientKey: sent.id,
          ...attachments,
          steers: false,
          rewinds: { messageId: stash.line.messageId },
          ...(taskId === undefined ? undefined : { taskId }),
        }),
      {
        went: BUZZ.SUCCESS,
        // Note that a line written again and refused stays marked Not delivered, as any send does, its Retry taking the agent back first.
        inPlace: (refusal: string) => {
          if (mounted.current) setNote(refusal);
        },
        done: () => heldSends.delete(sentLineId(sent.id)),
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    );

    return true;
  };

  /** The line of the member's under `lineId` the service refused; none for any other. */
  const refusedLine = (lineId: string): SendingMessage | undefined =>
    transcript?.sending?.find((line) => line.id === lineId && line.refused !== undefined);

  /** The message of the member's to a Manager's chat the service refused, by the key it went under; none for any other. */
  const refusedChat = (clientKey: string): ManagerChatSending | undefined =>
    chatSending?.find((line) => line.clientKey === clientKey && line.refused !== undefined);

  // Note that a refused chat message goes again under its key with the files it carried, so one whose answer was lost lands in the chat once; the host draws it on its way again in the refusal's place.
  const retryChat = (clientKey: string) => {
    const line = refusedChat(clientKey);

    if (line === undefined) return;
    setNote(undefined);
    write(
      () =>
        acts[ACT_KIND.AGENTS_CHAT_SEND]({
          agentId,
          text: line.text,
          clientKey,
          ...(line.attachments === undefined ? undefined : { attachments: line.attachments }),
          ...(line.threadRoot === undefined ? undefined : { threadRoot: line.threadRoot }),
          retry: true,
        }),
      {
        went: BUZZ.SUCCESS,
        inPlace: (refusal: string) => {
          if (mounted.current) setNote(refusal);
        },
        done: () => heldSends.delete(clientKey),
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    );
  };

  /** A refused chat message let go, its words and pictures laid back in the field where `edits`. */
  const unsendChat = (clientKey: string, edits: boolean) => {
    const line = refusedChat(clientKey);

    if (line === undefined) return;
    const held = heldSends.get(clientKey);
    heldSends.delete(clientKey);
    void acts[ACT_KIND.AGENTS_CHAT_UNSEND]({ agentId, clientKey }).catch(() => undefined);

    // Note that the host keeps every file the message went with, so one this phone no longer holds, as after a relaunch, comes back into the field from those, each picture drawn from its bytes.
    if (edits) {
      handBack(
        {
          id: clientKey,
          words: held?.words ?? line.text,
          pictures: held?.pictures ?? (line.attachments ?? []).map(heldPictureOf),
        },
        undefined,
      );
    }
  };

  // Note that a refused line goes again under its key, so one whose answer was lost reaches the agent once, taking the agent back first where it was a line written again; the host draws it on its way in the refusal's place, and a refusal again marks it again.
  const retryLine = (lineId: string) => {
    if (chat) return retryChat(lineId);
    const line = refusedLine(lineId);

    if (line === undefined || !undeliveredWhole(line)) return;
    const files = heldSends.get(lineId)?.pictures.map(({ file }) => file) ?? [];
    setNote(undefined);
    write(
      () =>
        acts[ACT_KIND.AGENTS_MESSAGE]({
          agentId,
          text: line.text,
          clientKey: line.clientKey,
          ...(files.length === 0 ? undefined : { attachments: files }),
          steers: line.rewinds === undefined && writing,
          ...(line.rewinds === undefined
            ? undefined
            : {
                rewinds: {
                  messageId: line.rewinds,
                  ...(line.restoresFiles === true ? { restoreFiles: true } : undefined),
                },
              }),
          ...(taskId === undefined ? undefined : { taskId }),
        }),
      {
        went: BUZZ.SUCCESS,
        inPlace: (refusal: string) => {
          if (mounted.current) setNote(refusal);
        },
        done: () => heldSends.delete(lineId),
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    );
  };

  // Note that the words go back as typed, their files' markers among them, and the pictures this phone still holds with them, so each stands as the pill it was.
  const editLine = (lineId: string) => {
    if (chat) return unsendChat(lineId, true);
    const line = refusedLine(lineId);

    if (line === undefined) return;
    const held = heldSends.get(lineId);
    heldSends.delete(lineId);
    void acts[ACT_KIND.AGENTS_UNSEND]({ agentId, lineId }).catch(() => undefined);
    handBack(
      { id: line.clientKey, words: held?.words ?? line.text, pictures: held?.pictures ?? [] },
      undefined,
    );
  };

  const dropLine = (lineId: string) => {
    if (chat) return unsendChat(lineId, false);

    if (refusedLine(lineId) === undefined) return;
    heldSends.delete(lineId);
    void acts[ACT_KIND.AGENTS_UNSEND]({ agentId, lineId }).catch(() => undefined);
  };

  /** What the field holds of its own, kept aside while it holds another message's words: what an edit standing kept aside, or else what it holds now, its pictures taken off. */
  const ownDraft = (): { readonly words: string; readonly pictures: readonly HeldPicture[] } => {
    const attached = pictures.take();
    const kept = editing ?? rewriting;

    return kept === undefined
      ? { words, pictures: attached }
      : { words: kept.words, pictures: kept.pictures };
  };

  const editMessage = (line: MessageEdit) => {
    // Note that a queued message's edit gives way, its mark cleared, so the field holds one message's words at a time.
    if (editing !== undefined) {
      void change({ change: QUEUE_CHANGE.HOLD, messageId: editing.id, held: false });
      setEditing(undefined);
    }

    setRewriting({ line, ...ownDraft() });
    setWords(line.words);
    setNote(undefined);
    setFocusAsk((count) => count + 1);
  };

  const editAsk = editSendAsk(rewriting?.line.takes, false, rewriting?.line.cuts ?? true);

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

  /** One change of the queue, answering whether it went; what one that did not go said stands over the field. */
  const change = (next: AgentQueueChange): Promise<boolean> => {
    setNote(undefined);

    return write(() => acts[ACT_KIND.AGENTS_QUEUE]({ agentId, change: next }), {
      refused: (answer) =>
        "failure" in answer ? queueRefusalWords(next.change, answer.failure) : undefined,
      unanswered: queueRefusalWords(next.change, AGENT_CALL_FAILURE.UNANSWERED),
      inPlace: setNote,
    });
  };

  const queue = transcript?.word?.queue;
  const held = queue?.messages ?? [];

  // Note that a pause until the machine starts is said by the empty transcript, whose Retry lifts it, as the panel's dock leaves it out.
  const paused =
    queue?.paused === undefined || queue.paused.because === QUEUE_PAUSE.BOOT_FAILED
      ? undefined
      : queue.paused;

  // Note that a message the queue no longer lists, sent on as the turn ended, asks nothing more, so its Delete never goes for a message already gone.
  const deletingListed = deleting !== undefined && held.some((message) => message.id === deleting);

  useEffect(() => {
    if (deleting !== undefined && !deletingListed) setDeleting(undefined);
  }, [deleting, deletingListed]);

  const move = (from: number, to: number) => {
    const order = held.map((message) => message.id);
    const [taken] = order.splice(from, 1);

    if (taken === undefined) return;
    order.splice(to, 0, taken);
    void change({ change: QUEUE_CHANGE.REORDER, order });
  };

  // A message that left the queue while its edit stood open, sent or deleted elsewhere, is no longer the field's to edit: the edit closes, its words left in the field.
  const editedListed = editing !== undefined && held.some((message) => message.id === editing.id);

  useEffect(() => {
    if (editing === undefined) return setSeenEdited(false);

    if (editedListed) return setSeenEdited(true);
    const stash = { id: editing.id, text: editing.words, attachments: [] };

    if (queueEditLeft(stash, seenEdited, editedListed, settling)) setEditing(undefined);
  }, [editing, editedListed, seenEdited, settling]);

  /** The field given back the words and pictures it held before the edit, the edit's own pictures let go. */
  const giveBack = (stash: EditStash) => {
    pictures.take();
    pictures.putBack(stash.pictures);
    setWords(stash.words);
    setEditing(undefined);
  };

  /** The edit given up: the message's mark cleared, and the field given back what it held. */
  const cancelEditOf = (stash: EditStash) => {
    void change({ change: QUEUE_CHANGE.HOLD, messageId: stash.id, held: false });
    giveBack(stash);
  };

  const edit = (id: string) => {
    const message = held.find((each) => each.id === id);

    // Note that only a message of words alone is edited here, since an edit's files replace the message's and the field does not read a queued message's pictures back.
    if (message === undefined || (message.files ?? []).length > 0) return;

    if (editing !== undefined)
      void change({ change: QUEUE_CHANGE.HOLD, messageId: editing.id, held: false });

    sessions.current += 1;
    const session = sessions.current;

    // Note that a sent line's edit gives way to the queued message's, the field's own kept aside as it was.
    const stash: EditStash =
      editing === undefined ? { id, session, ...ownDraft() } : { ...editing, id, session };

    setRewriting(undefined);
    setEditing(stash);
    setWords(message.text);
    // A message the queue would not mark, already on its way, is no longer the field's to edit.
    void change({ change: QUEUE_CHANGE.HOLD, messageId: id, held: true }).then((went) => {
      const now = editingNow.current;

      if (!went && now?.session === session) giveBack(now);
    });
  };

  /** The edit saved or steered with the words Save or Steer took out of the field and its pictures, closed once the queue took it; given up where the field was emptied. */
  const sendEdit = (way: QueueEditSend, typed: string): boolean => {
    if (editing === undefined) return false;
    const stash = editing;
    const next = queueEditChange(way, stash.id, { text: typed, attachments: pictures.files ?? [] });

    if (next === undefined) {
      cancelEditOf(stash);

      return true;
    }

    setSettling(stash.id);
    void change(next).then((went) => {
      setSettling((was) => (was === stash.id ? undefined : was));

      // Note that only the edit that sent it closes, so a Save landing after its edit was given up and the message opened again leaves the new edit standing.
      const now = editingNow.current;

      if (now?.session !== stash.session) return;

      // Note that words a Save or Steer refused took out of the field go back in it, ahead of anything typed since, as the edit still stands.
      if (went) giveBack(now);
      else setWords((typedSince) => wordsHandedBack(typed, typedSince));
    });

    return true;
  };

  const queued: readonly QueuedLine[] = held.map((message) => ({
    id: message.id,
    words:
      message.text === ""
        ? (message.files ?? []).map((file) => file.name).join(", ")
        : message.text,
    editing: message.id === editing?.id || message.editing === true,
    editable: (message.files ?? []).length === 0,
  }));

  // Note that an edit of a Manager chat message saves its words alone, so the field takes no file while it holds them.
  const takesFiles = !(chat && rewriting !== undefined);

  return {
    placeholder: thread === undefined ? PLACEHOLDER : CHAT_THREAD_WORDS.BOX,
    sendQueues,
    words,
    onWords: (typed) => {
      setWords(typed);
      setNote(undefined);
    },
    sendable: pictures.files !== undefined,
    send,
    attach: takesFiles ? pictures.attach : undefined,
    dropPictures: takesFiles ? pictures.drop : undefined,
    pasteText: takesFiles ? pictures.pasteText : undefined,
    // Note that a thread's reply is no turn of its own, so its box offers no Stop, as the panel's thread box stands none.
    stop: writing && thread === undefined ? stop : undefined,
    stopping,
    queued,
    paused: paused === undefined ? undefined : pausedWords(paused),
    steer: controlsQueue
      ? (messageId) => void change({ change: QUEUE_CHANGE.STEER, messageId })
      : undefined,
    remove: controlsQueue ? setDeleting : undefined,
    removing: {
      title: QUEUE_DELETE_QUESTION.TITLE,
      message: QUEUE_DELETE_QUESTION.BODY,
      act: QUEUE_DELETE_QUESTION.VERB,
      presented: deletingListed,
      onAct: () => {
        setDeleting(undefined);

        if (deleting !== undefined && deletingListed)
          void change({ change: QUEUE_CHANGE.DELETE, messageId: deleting });
      },
      onDismiss: () => setDeleting(undefined),
    },
    move: controlsQueue && held.length > 1 ? move : undefined,
    resume:
      controlsQueue && paused !== undefined
        ? () => void change({ change: QUEUE_CHANGE.RESUME })
        : undefined,
    edit: controlsQueue ? edit : undefined,
    cancelEdit: controlsQueue
      ? (id) => {
          if (editing?.id === id) return cancelEditOf(editing);
          void change({ change: QUEUE_CHANGE.HOLD, messageId: id, held: false });
        }
      : undefined,
    saving:
      editing === undefined
        ? undefined
        : {
            onSave: (typed) => sendEdit(QUEUE_EDIT_SEND.SAVE, typed),
            onSteer: writing ? (typed) => sendEdit(QUEUE_EDIT_SEND.STEER, typed) : undefined,
          },
    note,
    skills,
    mentions: skills === undefined ? mentions : undefined,
    pills: pillField.pills,
    editMessage,
    cancelMessageEdit: rewriting === undefined ? undefined : () => giveBackRewritten(rewriting),
    sendingEdit: {
      title: editAsk.title,
      message: editAsk.body,
      act: editAsk.verb,
      presented: askingEdit && rewriting !== undefined,
      // Note that the words go as the field holds them once the question is answered, taken out of it as Send takes them.
      onAct: () => {
        setAskingEdit(false);
        const field = pillField.pills.field.current;

        if (rewriting === undefined || field === null) return;
        const stash = rewriting;
        void field.take().then((taken) => {
          if (!sendRewritten(stash, taken.words)) taken.giveBack();
        });
      },
      onDismiss: () => setAskingEdit(false),
    },
    focusAsk,
    undelivered: { retry: retryLine, edit: editLine, drop: dropLine },
  };
}
