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
 * a refusal does. A paste long enough to bury the message is attached as a
 * text file beside the pictures (`useAttachedPictures`' `pasteText`).
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
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentQueueChange,
  type AgentStatus,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
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
} from "@repo/host/app-state-reads";
import { AGENT_ENTER } from "@repo/settings";
import {
  type AttachedPicture,
  BUZZ,
  buzz,
  type ComposerSaving,
  type QueuedLine,
} from "@repo/ui-native";
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

/**
 * Each agent's words typed and not yet sent, with the suggestion last laid
 * into them, by the agent, so they outlive the page that drew them, as a
 * widening window hands a page from its tab's stack to a split view's
 * detail, each drawing its own, and the page drawn anew lays no suggestion
 * in again.
 */
const unsentWords = new Map<
  string,
  { readonly words: string; readonly laidFor: string | undefined }
>();

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
  /** Whether Send stands lit with no words typed: a picture or a pasted file is attached. */
  readonly sendable: boolean;
  readonly send: () => void;
  /** Whether Send queues the message behind the turn rather than sending it to the agent now. */
  readonly sendQueues: boolean;
  readonly attached: readonly AttachedPicture[];
  readonly attach: () => void;
  /** Attaches pictures dropped on the composer, on an iPad, by the files the drop kept. */
  readonly dropPictures: (uris: readonly string[], unreadable: number) => void;
  /** Takes a long paste as a text file beside the pictures, answering whether it did. */
  readonly pasteText: (words: string) => boolean;
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
  /** Lays one of the member's sent lines' words in the field to send again in its place, the field's own kept aside, and has it take the keyboard. */
  readonly editMessage: (line: MessageEdit) => void;
  /** Gives up the edit of a sent line, the field given back what it held; none while the field holds no sent line's words. */
  readonly cancelMessageEdit: (() => void) | undefined;
  /** The question the send of a line written again asks first where anything follows it, as the panel's asks it. */
  readonly sendingEdit: QueuedDeleteAsk;
  /** Counts each time the field is asked to take the keyboard, as Edit asks it. */
  readonly focusAsk: number;
}

/** One of the member's sent lines opened to write again in its place: its id, its words, and what its send drops. */
export interface MessageEdit {
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
export interface QueuedDeleteAsk {
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
): AgentComposer {
  const acts = useHostActs();
  const write = useWrite();

  const { data: enterQueues = false } = useQuery({
    ...appStateQuery,
    select: (state) => selectAppSettingsView(state)?.agentEnter === AGENT_ENTER.QUEUE,
  });

  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const [words, setWords] = useState(() => unsentWords.get(agentId)?.words ?? "");
  // The suggestion whose words the box last laid in, so each is laid in once.
  const [laidFor, setLaidFor] = useState(() => unsentWords.get(agentId)?.laidFor);

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
    if (ownWords === "" && laidFor === undefined) unsentWords.delete(agentId);
    else unsentWords.set(agentId, { words: ownWords, laidFor });
  }, [agentId, ownWords, laidFor]);

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
  const taskId = agent?.taskId ?? undefined;
  const skills = useSkillOffer(words, setWords, taskId === undefined ? undefined : { taskId });

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
  const handBack = (sent: Sent, refusal: string) => {
    setNote(refusal);

    if (editingNow.current !== undefined) {
      return setEditing((stash) =>
        stash === undefined
          ? stash
          : {
              ...stash,
              words: stash.words.trim() === "" ? sent.words : `${sent.words}\n${stash.words}`,
              pictures: [...sent.pictures, ...stash.pictures],
            },
      );
    }

    setWords((typed) => (typed.trim() === "" ? sent.words : `${sent.words}\n${typed}`));
    pictures.putBack(sent.pictures);
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
    // Note that a send while the field holds a queued message's words saves them back in its place, as Save does.
    if (editing !== undefined) return sendEdit(QUEUE_EDIT_SEND.SAVE);

    // Note that a line written again asks first where anything follows it, since its send drops that for good.
    if (rewriting !== undefined) {
      if (words.trim() === "") return;

      return rewriting.line.cuts ? setAskingEdit(true) : sendRewritten(rewriting);
    }

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
      ...(taskId === undefined ? undefined : { taskId: taskId }),
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

  /** The field given back the words and pictures it held before a sent line's edit, the edit's own let go. */
  const giveBackRewritten = (stash: Rewriting) => {
    pictures.take();
    pictures.putBack(stash.pictures);
    setWords(stash.words);
    setRewriting(undefined);
  };

  /**
   * The words in the field sent in place of the sent line, the agent taken
   * back to just before it first, as the panel's Edit sends them; the field
   * given back what it held, and the words handed back where it was refused.
   * Note that it stops the turn under way rather than steering it.
   */
  const sendRewritten = (stash: Rewriting) => {
    const text = words.trim();

    if (text === "") return;

    // Note that pictures attached while the line was written again go with it, as the panel's Edit takes files.
    const attachments =
      pictures.files === undefined ? undefined : { attachments: [...pictures.files] };

    const sent: Sent = { id: randomUUID(), words: text, pictures: pictures.take() };
    ownSends.current.add(sentLineId(sent.id));
    setNote(undefined);
    giveBackRewritten(stash);
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
        inPlace: (refusal: string) => {
          if (!mounted.current) return;
          handBack(sent, refusal);
          void acts[ACT_KIND.AGENTS_UNSEND]({ agentId, lineId: sentLineId(sent.id) }).catch(
            () => undefined,
          );
        },
        refused: (answer) =>
          "failure" in answer ? messageFailureWords(answer.failure) : undefined,
        unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
      },
    );
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

  /** The edit saved or steered with the field's words and pictures, closed once the queue took it; given up where the field was emptied. */
  const sendEdit = (way: QueueEditSend) => {
    if (editing === undefined) return;
    const stash = editing;
    const next = queueEditChange(way, stash.id, { text: words, attachments: pictures.files ?? [] });

    if (next === undefined) return cancelEditOf(stash);
    setSettling(stash.id);
    void change(next).then((went) => {
      setSettling((was) => (was === stash.id ? undefined : was));

      // Note that only the edit that sent it closes, so a Save landing after its edit was given up and the message opened again leaves the new edit standing.
      const now = editingNow.current;

      if (went && now?.session === stash.session) giveBack(now);
    });
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
    pasteText: pictures.pasteText,
    detach: pictures.detach,
    stop: writing ? stop : undefined,
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
            onSave: () => sendEdit(QUEUE_EDIT_SEND.SAVE),
            onSteer: writing ? () => sendEdit(QUEUE_EDIT_SEND.STEER) : undefined,
          },
    note,
    skills,
    editMessage,
    cancelMessageEdit: rewriting === undefined ? undefined : () => giveBackRewritten(rewriting),
    sendingEdit: {
      title: editAsk.title,
      message: editAsk.body,
      act: editAsk.verb,
      presented: askingEdit && rewriting !== undefined,
      onAct: () => {
        setAskingEdit(false);

        if (rewriting !== undefined) sendRewritten(rewriting);
      },
      onDismiss: () => setAskingEdit(false),
    },
    focusAsk,
  };
}
