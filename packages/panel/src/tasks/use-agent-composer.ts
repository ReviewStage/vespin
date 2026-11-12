import { newerTurn } from "@repo/features/agent-status";
import {
  AGENT_CALL_FAILURE,
  type AgentMessageParams,
  type SendingMessage,
} from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentPayer,
  type AgentTranscriptMessage,
  type AgentTurn,
  agentAttachmentsSchema,
  hasWordsOrFiles,
} from "@repo/features/agent-wire";
import { type Failure, remedyLabel } from "@repo/features/failure-remedy";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraft } from "../composer-drafts.js";
import { keepPictureRead, pictureNow } from "../picture-query.js";
import { useToast } from "../toast.js";
import {
  closesComposer,
  messageFailureNote,
  SENT_LINE_STATE,
  type SentLine,
} from "./agent-model.js";
import type { HeldUpdate } from "./refused-send.js";

/**
 * use-agent-composer.ts -- the message box under an agent's transcript as one control: the words being written, and the lines the member sent, drawn from the one record of their messages on their way the host holds.
 *
 * A send takes the words out of the box and hands them to the host, which
 * draws them at once in the transcript as the member's own line, under the
 * id the service writes its row under (`sentLineId`), so the row lands in
 * its place, and lets the line go as it lands (`@repo/host`'s
 * `agent-queue-writes.ts`); the box takes the next message straight away.
 * The host sends a line, a change of the queue, and a rewind one at a time,
 * in the order they were asked, which is the order the service's lock takes
 * them in, so nothing here orders them. Where the service holds a line in the
 * queue while the agent's first launch boots, the host draws it there in the
 * same draw it leaves the transcript, so it never stands in both nor in
 * neither. Every window draws the same record: this one's, another's, and the
 * iPhone's. The agent's status is the task list's, which carries the turn a
 * message opens as it lands, so a message to an agent that had finished turns
 * its status back and starts the transcript reading again.
 *
 * A message the service refused stays where it went, as a chat app keeps
 * one, and never comes back into the box, which holds only words not yet
 * sent: the host keeps it in the record, marked with why, so every window
 * and every tab opened again draws it, and its rows and tabs wear the failed
 * mark meanwhile (`failed-lines.ts`). Its line offers Retry, which sends it
 * again under the same key, so a send whose answer was lost reaches the
 * agent once, as the newest line; Edit, which takes its words and files back
 * into the box ahead of what the box holds; and Delete. A refusal that
 * something elsewhere mends, a token to update or the task to move to the
 * workspace that reaches its repository, is also said under the box with that
 * remedy and Retry (`repository-remedy.tsx`). A refusal for good, the agent's
 * session ended, holds the box, disabled, with its reason under it, every
 * line refused drawn as not delivered, and the words the box held kept for
 * Continue (`unsent`). A refusal that lands while the tab is not on screen is
 * said in a toast too, in the window that sent it.
 *
 * The words and the files not yet sent are the agent's draft, kept apart from
 * the tab (`../composer-drafts.ts`), so they wait while another tab or task is
 * open and come back as the tab does.
 *
 * Edit opens one of the member's lines for writing again where it stands
 * (`rewind-action.tsx`), leaving the box as it is, and its send takes the
 * agent back to just before that line first, which the host does as it sends
 * it, so the words go in its place. Revert takes the agent back to just
 * before a line without sending. Either hides the messages the rewind drops
 * at once, until the transcript reads back without them; an edit refused
 * stands where it went, its Retry rewinding again only where the rewind did
 * not go, and a revert refused says why under the box, its Retry asking
 * again. A line still on its way is no place to rewind to (`going`), because
 * the service may still withdraw its row.
 */

/** A message as the box sends it: the request the service takes, and what the host draws it by while it goes. */
export type OutgoingMessage = Omit<AgentMessageParams, "agentId">;

/** How one message is sent to an agent, answered as the view hears it. */
export type MessageSender = (agentId: string, message: OutgoingMessage) => Promise<AgentActAnswer>;

/** How the agent is taken back to just before one of the developer's lines, by its message id, answered as the view hears it. */
export type MessageRewinder = (
  agentId: string,
  messageId: string,
  restoreFiles?: boolean,
) => Promise<AgentActAnswer>;

/** How a refused message is let go, by the id its line is drawn under. */
export type MessageUnsender = (agentId: string, lineId: string) => void;

/** Why a message did not go, with the answer that said so, which the shown failure reports in its place. */
export type ComposerNote = Failure & { readonly cause?: unknown };

/** Everything the composer draws and presses. */
export interface AgentComposerControl {
  /** The words in the box. */
  draft: string;
  setDraft: (text: string) => void;
  /** The files that go with the words, in the order attached. */
  attachments: readonly AgentAttachment[];
  /** Changes the files from those the box holds as the change lands, which a read that lands late needs. */
  setAttachments: (next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[]) => void;
  /** Whether a send holds the box until it answers, during which the box takes nothing: New task's, whose send opens the task; an agent's box never holds. */
  sending: boolean;
  /** Why the last Revert did not go, or the newest message refused where what mends it is elsewhere, said under the box beside that remedy and Retry; nothing while neither waits. Every message refused says so on its own line too. */
  note: ComposerNote | undefined;
  /** Why the agent takes no message any more, in the host's words; nothing while it does. */
  closed: string | undefined;
  /** Sends the words in the box, trimmed, and its files under a fresh key; nothing on an empty box or a closed agent. */
  send: () => void;
  /** Asks the Revert that did not go again, or sends the message whose remedy the note offers again under its key. */
  retry: () => void;
  /** The message the note's remedy is for, as it was sent; none where the note is of no message. */
  notedLine?: SentLine | undefined;
  /** The member's lines the transcript has not read back yet, on their way or refused, in order. */
  sent: readonly SentLine[];
}

interface Held {
  agentId: string;
  /** The developer's line open for writing again where it stands, by its message id; none while none is. */
  editing: string | undefined;
  /** The line a revert under way takes the agent back to just before, by its message id; none while none is out. */
  reverting: string | undefined;
  /** When the newest edit or revert was pressed, in epoch milliseconds, which the working line counts from while it goes; none before one was. */
  rewoundAt: number | undefined;
  /** The messages a rewind under way or just done drops, by their ids, hidden until the transcript reads back without them. */
  cut: ReadonlySet<string> | undefined;
  /** The Revert that did not go, which the note under the box is of and its Retry asks again, the files back too where it asked them. */
  revertFailed:
    | { readonly messageId: string; readonly restoreFiles: boolean; readonly note: ComposerNote }
    | undefined;
  /** The newest turn a send's answer named, the one its line awaits; none before a send answered. */
  turn: AgentTurn | undefined;
}

/** A tab's composer as it opens on an agent: nothing of its own; what it sent stands in the host's record. */
function fresh(agentId: string): Held {
  return {
    agentId,
    editing: undefined,
    reverting: undefined,
    rewoundAt: undefined,
    cut: undefined,
    revertFailed: undefined,
    turn: undefined,
  };
}

/** The ids of the message named and every message after it, which a rewind to just before it drops. */
function cutFrom(
  messages: readonly AgentTranscriptMessage[],
  messageId: string,
): ReadonlySet<string> | undefined {
  const at = messages.findIndex((message) => message.id === messageId);

  return at === -1 ? undefined : new Set(messages.slice(at).map((message) => message.id));
}

/** A file the box held, as the window draws it from its own bytes. */
function fileUrl(file: AgentAttachment): string {
  return `data:${file.mediaType};base64,${file.data}`;
}

/**
 * A message's files whole, from the bytes the window keeps under the ids the
 * host draws them by; those the window holds no bytes of, sent from another
 * window, are drawn by their row once it lands.
 */
function filesHeld(
  client: QueryClient,
  agentId: string,
  files: SendingMessage["files"],
): readonly AgentAttachment[] {
  const held = (files ?? []).flatMap(({ name, mediaType, id }) => {
    const read = id === undefined ? undefined : pictureNow(client, agentId, id);

    if (read?.kind !== PICTURE_STATE.READY) return [];

    return [{ name, mediaType, data: read.url.slice(read.url.indexOf(",") + 1) }];
  });

  return Option.getOrElse(
    Schema.decodeUnknownOption(agentAttachmentsSchema)(held),
    () => [] as const,
  );
}

/** A message in the host's record as the transcript draws its line: on its way, refused, or, where the box closed, not delivered. */
function lineOf(
  message: SendingMessage,
  attachments: readonly AgentAttachment[],
  closed: boolean,
): SentLine {
  const state =
    message.refused === undefined
      ? SENT_LINE_STATE.PENDING
      : closed
        ? SENT_LINE_STATE.UNDELIVERED
        : SENT_LINE_STATE.FAILED;

  return {
    id: message.id,
    clientKey: message.clientKey,
    text: message.text,
    attachments,
    steers: message.steers,
    sentAt: message.sentAt,
    state,
    ...(message.rewinds === undefined ? undefined : { rewinds: message.rewinds }),
    ...(message.restoresFiles === true ? { restoresFiles: true } : undefined),
    ...(message.refused !== undefined && "rewound" in message.refused
      ? { rewound: true }
      : undefined),
  };
}

/** What a closed box keeps for Continue, which carries it: the words and files of every line refused, in the order sent, then what the box holds. */
function carried(lines: readonly SentLine[], box: Draft): Draft {
  const refused = lines.filter((line) => line.state !== SENT_LINE_STATE.PENDING);

  return {
    ...EMPTY_DRAFT,
    text: [...refused.map((line) => line.text), box.text]
      .filter((text) => text !== "")
      .join("\n\n"),
    attachments: [...refused.flatMap((line) => line.attachments), ...box.attachments],
  };
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** What the toast says of a message not delivered while its tab is not on screen, and its press. */
const NOT_DELIVERED_TOAST = "Message not delivered";
const OPEN_WORD = "Open";

/** The composer as an agent's tab holds it: what it draws, the words and files Continue carries, and the presses a refused line offers. */
export interface HeldComposer extends AgentComposerControl {
  readonly unsent: {
    readonly words: string;
    readonly attachments: readonly AgentAttachment[];
  };
  /** Sends a refused line again under its key, as the newest line. */
  readonly retryLine: (id: string) => void;
  /** Lets a refused line go, sending nothing. */
  readonly dropLine: (id: string) => void;
  /** Takes a refused line back into the box, ahead of what it holds, to be written again. */
  readonly takeBackLine: (id: string) => void;
  /** Why each refused line did not go, by its id. */
  readonly failedNotes: ReadonlyMap<string, ComposerNote>;
  /** Sends the words given as a new line of the developer's own, under a fresh key, leaving the box as it is; nothing on a closed agent. */
  readonly sendWords: (text: string) => void;
  /** The developer's line open for writing again where it stands, by its message id; none while none is. */
  readonly editing: string | undefined;
  /** Opens one of the developer's lines for writing again where it stands. */
  readonly edit: (messageId: string) => void;
  /** Closes the line open for writing again, sending nothing. */
  readonly dropEdit: () => void;
  /** Sends the words and files in place of the line named, taking the agent back to just before it first, its files back too where `restoreFiles`. */
  readonly sendEdit: (
    messageId: string,
    words: string,
    attachments: readonly AgentAttachment[],
    restoreFiles?: boolean,
  ) => void;
  /** Whether a revert is out, until the service answers it. */
  readonly rewindOut: boolean;
  /** Whether a revert is out, or a line an edit sent in another's place is still on its way. */
  readonly rewinding: boolean;
  /** Whether a line sent is still on its way. */
  readonly unanswered: boolean;
  /** The newest turn a send's answer named, the one its line awaits, which the tab weighs against its summary's (`newerTurn`); none before a send answered. */
  readonly turn: AgentTurn | undefined;
  /** When the newest edit or revert was pressed, in epoch milliseconds, which the working line counts from while it is rewinding; none before one was. */
  readonly rewoundAt: number | undefined;
  /** Takes the agent back to just before one of the developer's lines, sending nothing, its files back too where `restoreFiles`. */
  readonly revert: (messageId: string, restoreFiles?: boolean) => void;
  /** The messages a rewind drops, hidden from the transcript until it reads back without them; none while none does. */
  readonly cut: ReadonlySet<string> | undefined;
  /** The ids of the lines still on their way, whose rows the service may yet withdraw, so no rewind lands on them. */
  readonly going: ReadonlySet<string>;
  /** Moves the box's words and files on together from what its draft holds as the change lands, as a refused send put back does (`refused-send.ts`). */
  readonly updateHeld: HeldUpdate;
}

export function useAgentComposer(input: {
  agentId: string;
  /** The agent's task, whose repository a refusal's remedy mends; null for an agent with no task, whose refusal says its words alone. */
  taskId: string | null;
  /** The transcript as the tab holds it, which a rewind's cut is read from. */
  messages: readonly AgentTranscriptMessage[];
  /** The member's messages on their way and refused, as the host draws them (`AppTranscript.sending`). */
  sending: readonly SendingMessage[];
  /** Whether a turn runs now, which a line sent now steers rather than opening one; none where none does. */
  running?: boolean | undefined;
  send: MessageSender;
  /** Lets a refused message go. */
  unsend: MessageUnsender;
  /** Takes the agent back to just before one of the developer's lines; none where the box offers no edit and no revert. */
  rewind?: MessageRewinder | undefined;
  /** Who pays for the agent, which a plan's refusal names; none for an agent from before payers. */
  payer?: AgentPayer | undefined;
  /** The teammate who started the agent (`teammateStarter`), whose own credentials a refusal names; none for the reader's own. */
  starter?: string | undefined;
  /** Whether the tab is on screen, which a refusal landing while it is not says in a toast; on screen where unsaid. */
  shown?: boolean | undefined;
  /** Opens the agent's tab, which that toast offers; none offers nothing. */
  onOpen?: (() => void) | undefined;
  /** Words a send carries under the box's own, such as the follow-ups ticked in the bar over it, which a send with the box empty still sends; none where nothing is held. */
  lead?: string | undefined;
  /** Told once a send has carried the lead, so its holder lets it go. */
  onLeadSent?: (() => void) | undefined;
}): HeldComposer {
  const { agentId, messages, sending } = input;
  const kept = useDraft({ kind: DRAFT_PLACE.AGENT, planId: input.taskId, agentId });
  const queryClient = useQueryClient();
  const [held, setHeld] = useState<Held>(() => fresh(agentId));

  if (held.agentId !== agentId) setHeld(fresh(agentId));
  // Note that the sender is read through a ref, because the tab hands new closures on every render and an answer lands on whichever render is current.
  const latest = useRef(input);
  latest.current = input;
  const toast = useToast();
  // Whether the tab still stands, since a refusal landing after it closed is said in a toast.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  // A rewind's cut is let go once the transcript reads back without the messages it dropped.
  const cutStands = held.cut !== undefined && messages.some((message) => held.cut?.has(message.id));
  useEffect(() => {
    if (held.cut === undefined || cutStands) return;
    setHeld((was) => ({ ...was, cut: undefined }));
  }, [held.cut, cutStands]);

  // Note that the state is changed only while the tab still shows the agent the line went to.
  const ours = (change: (was: Held) => Held) =>
    setHeld((was) => (was.agentId === agentId ? change(was) : was));

  const { update } = kept;
  const at = latest.current;

  /** Why a refused message did not go, in the box's words. */
  const noteOf = (message: SendingMessage): ComposerNote | undefined =>
    message.refused === undefined
      ? undefined
      : {
          ...messageFailureNote(message.refused, at.taskId, at.payer, at.starter),
          cause: message.refused,
        };

  // A refusal for good, the agent's session ended, closes the box, said in the words of the newest one.
  const ending = sending.findLast(
    (message) => message.refused !== undefined && closesComposer(message.refused.failure),
  );

  const closed = ending === undefined ? undefined : noteOf(ending)?.text;

  const sent = sending.map((message) =>
    lineOf(message, filesHeld(queryClient, agentId, message.files), closed !== undefined),
  );

  // The newest refusal mended elsewhere is offered under the box too, with its remedy.
  const remedied = sending.findLast((message) => {
    const note = noteOf(message);

    return note !== undefined && remedyLabel(note) !== undefined;
  });

  /** Says a message to the agent was not delivered in a toast, where its tab is not on screen, which offers to open it. */
  const sayWhereAway = (answer: Extract<AgentActAnswer, { readonly failure: unknown }>) => {
    const now = latest.current;

    if (mounted.current && now.agentId === agentId && now.shown !== false) return;
    const { onOpen } = now;
    toast({
      replayUnmasked: true,
      words: NOT_DELIVERED_TOAST,
      tone: STATUS_TONE.DANGER,
      failure: { surface: FAILURE_SURFACE.AGENT_SEND, cause: answer, about: { agentId } },
      ...(onOpen !== undefined && {
        action: { label: OPEN_WORD, onPress: onOpen, replayUnmasked: true },
      }),
    });
  };

  /**
   * Hands one line to the host, which draws it at once and sends it after
   * every write of the agent's asked before it; its files are kept in the
   * window's pictures under ids of the line's own, which the host draws them
   * by. A refusal is the host's to keep where the line went.
   */
  const deliver = (line: {
    readonly clientKey: string;
    readonly text: string;
    readonly attachments: readonly AgentAttachment[];
    readonly steers: boolean;
    readonly rewinds?: { readonly messageId: string; readonly restoreFiles: boolean } | undefined;
  }) => {
    const pictures = line.attachments.map((file) => {
      const id = crypto.randomUUID();
      keepPictureRead(queryClient, agentId, id, fileUrl(file));

      return id;
    });

    const { taskId } = latest.current;

    void latest.current
      .send(agentId, {
        text: line.text,
        clientKey: line.clientKey,
        ...(line.attachments.length === 0
          ? undefined
          : { attachments: line.attachments, pictures }),
        steers: line.steers,
        ...(taskId === null ? undefined : { taskId }),
        ...(line.rewinds === undefined
          ? undefined
          : {
              rewinds: {
                messageId: line.rewinds.messageId,
                ...(line.rewinds.restoreFiles ? { restoreFiles: true } : undefined),
              },
            }),
      })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if ("failure" in answer) {
          sayWhereAway(answer);

          // A rewind that did not go drops nothing, so the messages it would have dropped are drawn again.
          if (line.rewinds !== undefined && !("rewound" in answer)) {
            ours((was) => ({ ...was, cut: undefined }));
          }

          return;
        }

        ours((was) => ({ ...was, turn: newerTurn(answer.agent.turn, was.turn) }));
      });
  };

  const sendDraft = (clientKey: string = crypto.randomUUID()) => {
    const { lead, onLeadSent } = latest.current;

    const text = [kept.draft.text.trim(), lead?.trim() ?? ""]
      .filter((each) => each !== "")
      .join("\n\n");

    const { attachments } = kept.draft;

    if (!hasWordsOrFiles(text, attachments) || closed !== undefined) return;
    update(() => EMPTY_DRAFT);
    deliver({ clientKey, text, attachments, steers: input.running === true });

    if (lead !== undefined) onLeadSent?.();
  };

  /** Sends the words and files in place of the line named, the messages from it on hidden at once; the box is left as it is. */
  const sendEdit = (
    messageId: string,
    words: string,
    attachments: readonly AgentAttachment[],
    restoreFiles = false,
  ) => {
    const text = words.trim();

    if (!hasWordsOrFiles(text, attachments) || closed !== undefined) return;
    setHeld((was) => ({
      ...was,
      revertFailed: undefined,
      editing: undefined,
      rewoundAt: Date.now(),
      cut: cutFrom(messages, messageId),
    }));
    // Note that a line in place of another stops the turn under way rather than steering it.
    deliver({
      clientKey: crypto.randomUUID(),
      text,
      attachments,
      steers: false,
      rewinds: { messageId, restoreFiles },
    });
  };

  /** Takes the agent back to just before the line named, after every write of the agent's asked before it. */
  const revert = (messageId: string, restoreFiles = false) => {
    setHeld((was) => ({
      ...was,
      revertFailed: undefined,
      editing: undefined,
      reverting: messageId,
      rewoundAt: Date.now(),
      cut: cutFrom(messages, messageId),
    }));

    const rewound =
      latest.current.rewind?.(agentId, messageId, restoreFiles) ?? Promise.resolve(UNANSWERED);

    void rewound
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (!("failure" in answer)) {
          ours((was) => ({ ...was, reverting: undefined }));

          return;
        }

        const note: ComposerNote = {
          ...messageFailureNote(answer, latest.current.taskId, latest.current.payer),
          cause: answer,
        };

        ours((was) => ({
          ...was,
          cut: undefined,
          reverting: undefined,
          revertFailed: { messageId, restoreFiles, note },
        }));
      });
  };

  /** The refused line by `id`, where it is one and the box takes messages; none otherwise. */
  const refusedLine = (id: string): SentLine | undefined => {
    const line = sent.find((each) => each.id === id);

    return line?.state === SENT_LINE_STATE.FAILED ? line : undefined;
  };

  /**
   * Sends a refused line again, under its key, as the newest line, as a chat
   * app moves a message tried again to the conversation's end; the host draws
   * it on its way in place of the refusal in the one draw. An edit whose
   * rewind went only sends, since the line it stood in place of is gone.
   */
  const resend = (id: string) => {
    const line = refusedLine(id);

    if (line === undefined) return;

    if (line.rewinds !== undefined && line.rewound !== true) {
      setHeld((was) => ({
        ...was,
        rewoundAt: Date.now(),
        cut: cutFrom(messages, line.rewinds ?? ""),
      }));
    }

    deliver({
      clientKey: line.clientKey,
      text: line.text,
      attachments: line.attachments,
      steers: line.rewinds === undefined && input.running === true,
      ...(line.rewinds === undefined || line.rewound === true
        ? undefined
        : { rewinds: { messageId: line.rewinds, restoreFiles: line.restoresFiles === true } }),
    });
  };

  /** Lets a refused line go, sending nothing. */
  const dropLine = (id: string) => {
    if (refusedLine(id) === undefined) return;
    latest.current.unsend(agentId, id);
  };

  /** Takes a refused line back into the box to be written again, ahead of what the box holds, which is newer. */
  const takeBackLine = (id: string) => {
    const line = refusedLine(id);

    if (line === undefined) return;
    latest.current.unsend(agentId, id);
    kept.update((draft) => ({
      ...draft,
      text: [line.text, draft.text].filter((text) => text !== "").join("\n\n"),
      attachments: [...line.attachments, ...draft.attachments],
    }));
  };

  // Note that a closed box draws none of its words, because Continue carries them with every line refused (`unsent`).
  const shown = closed === undefined ? kept.draft : EMPTY_DRAFT;
  const unsent = closed === undefined ? kept.draft : carried(sent, kept.draft);
  const going = sent.filter((line) => line.state === SENT_LINE_STATE.PENDING);
  const remediedNote = remedied === undefined ? undefined : noteOf(remedied);

  return {
    draft: shown.text,
    setDraft: (text) => kept.update((was) => ({ ...was, text })),
    attachments: shown.attachments,
    setAttachments: (next) =>
      kept.update((was) => ({ ...was, attachments: next(was.attachments) })),
    updateHeld: (next) =>
      kept.update((was) => {
        const moved = next(was);

        return moved === undefined ? was : { ...was, ...moved };
      }),
    sending: false,
    note: closed === undefined ? (held.revertFailed?.note ?? remediedNote) : undefined,
    closed,
    send: () => sendDraft(),
    retry: () => {
      const { revertFailed } = held;

      if (revertFailed !== undefined) {
        return revert(revertFailed.messageId, revertFailed.restoreFiles);
      }

      if (remedied !== undefined) resend(remedied.id);
    },
    notedLine:
      closed === undefined && remedied !== undefined
        ? sent.find((line) => line.id === remedied.id)
        : undefined,
    retryLine: resend,
    dropLine,
    takeBackLine,
    failedNotes: new Map(
      sending.flatMap((message) => {
        const note = noteOf(message);

        return note === undefined ? [] : [[message.id, note] as const];
      }),
    ),
    sendWords: (text) => {
      if (text.trim() === "" || closed !== undefined) return;
      deliver({
        clientKey: crypto.randomUUID(),
        text: text.trim(),
        attachments: [],
        steers: input.running === true,
      });
    },
    sent,
    unsent: { words: unsent.text, attachments: unsent.attachments },
    editing: held.editing,
    edit: (messageId) => setHeld((was) => ({ ...was, editing: messageId })),
    dropEdit: () => setHeld((was) => ({ ...was, editing: undefined })),
    sendEdit,
    rewindOut: held.reverting !== undefined,
    rewoundAt: held.rewoundAt,
    rewinding: held.reverting !== undefined || going.some((line) => line.rewinds !== undefined),
    unanswered: going.length > 0,
    turn: held.turn,
    revert,
    cut: held.cut,
    going: new Set(going.map((line) => line.id)),
  };
}
