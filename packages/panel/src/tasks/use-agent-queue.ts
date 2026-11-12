import type { AgentQueue, QueuedMessage } from "@repo/features/agent-queue-wire";
import { QUEUE_LEFT_WORDS, QUEUE_REFUSED_WORDS } from "@repo/features/agent-queue-words";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@repo/features/agent-view";
import {
  AGENT_BOUNDS,
  type AgentAttachment,
  type AgentQueueChange,
  type AgentTranscriptMessage,
  agentAttachmentsSchema,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { SENTRY_SEND_SPAN } from "@repo/features/sentry-tracing";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { ACTION_RESULT_STATUS, type ActionResult, MESSAGE_ROLE } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Option, Schema } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { sendMutation } from "../act-mutations.js";
import { keptLines } from "../composer-drafts.js";
import { keepPictureRead, pictureNow, pictureQuery } from "../picture-query.js";
import { useToast } from "../toast.js";
import type { AgentPictureDoor } from "./agent-pictures.js";
import { putBackRefused } from "./refused-send.js";
import type { HeldComposer } from "./use-agent-composer.js";

/**
 * use-agent-queue.ts -- an agent's queue as its tab draws and changes it: the messages queued behind its turn, in the order they go, and the one door every change goes through.
 *
 * What the tab draws is the queue its transcript's page carries, with every
 * change asked of it drawn over it by the host the moment it is asked
 * (`@repo/host`'s `agent-queue-writes.ts`), each sent after every change of
 * the agent's queue asked before it and standing until a page carries it,
 * so nothing here waits on one. A change the service refused is taken back
 * by the host and said here in a toast. A message is queued under an id the
 * tab mints (`crypto.randomUUID`), so it is drawn at the queue's end as it
 * goes, under the id it keeps, and takes presses at once. The files of a
 * message queued or edited here are kept in the window's pictures under
 * ids of the tab's own, which the host draws them by, and, as the service
 * answers, under the ids it names them by, so its thumbnails never give way
 * to a read of what the window already holds. A message the queue did not
 * take, refused or unanswered, stays at the queue's end marked not delivered
 * (`unsent`), as a chat app keeps a message that did not go, never put back
 * in the box on its own, since one unanswered may have landed: Retry sends it
 * again under its id, which the service takes once, Edit takes it back into
 * the box, Delete lets it go, and a read holding it settles it quietly: the
 * queue listing it, or the transcript holding the row it was handed on as.
 */

/** What a change answered where the act itself failed. */
const UNANSWERED: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** The messages of a queue its page carries none of, as an agent's page before its first change. */
const NO_MESSAGES: readonly QueuedMessage[] = [];

/** The revision a message not delivered is kept at where no page had carried its agent's queue, below any page's. */
const NO_REVISION = -1;

/** A message queued from this window that the queue did not take, waiting on Retry, Edit, or Delete. */
export interface UnsentQueued {
  readonly agentId: string;
  /** The id it went under, which Retry sends it under again. */
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  /** How many files it went with, which a relaunch keeps though not their bytes. */
  readonly files: number;
  /** The queue's revision as it did not go; a page past it listing the message says it landed. */
  readonly revision: number;
}

/** A message not delivered as the renderer's storage keeps it: all of it but its files' bytes. */
const keptUnsentSchema = Schema.Struct({
  agentId: Schema.String,
  id: Schema.String,
  text: Schema.String,
  files: Schema.Number,
  revision: Schema.Number,
});

/**
 * Every message queued from this window that did not go, the account signed
 * in's alone, kept across a reload and a relaunch but for its files, which
 * stay in the window that attached them (`keptLines`).
 */
const unsentQueued = keptLines<UnsentQueued, typeof keptUnsentSchema.Type>({
  key: "app.unsentQueued",
  kept: keptUnsentSchema,
  toKept: ({ attachments: _files, ...kept }) => kept,
  fromKept: (kept) => ({ ...kept, attachments: [] }),
  idOf: (kept) => kept.id,
});

/** The ids the developer's rows of a transcript were written under, which a queued message handed on is one of. */
function rowsWritten(lines: readonly AgentTranscriptMessage[]): ReadonlySet<string> {
  return new Set(
    lines.flatMap((line) =>
      line.role === MESSAGE_ROLE.USER && line.clientId !== undefined ? [line.clientId] : [],
    ),
  );
}

/** Lets the message not delivered by `id` go, answering it as it stood; none where it is no such message. */
function takeUnsent(id: string): UnsentQueued | undefined {
  const taken = unsentQueued.store.state.find((unsent) => unsent.id === id);

  if (taken !== undefined) unsentQueued.set((all) => all.filter((unsent) => unsent.id !== id));

  return taken;
}

/** A file the box held, as the window draws it from its own bytes. */
function fileUrl(file: AgentAttachment): string {
  return `data:${file.mediaType};base64,${file.data}`;
}

/** The files a change sends with a message, where it sends any. */
function filesOf(change: AgentQueueChange): readonly AgentAttachment[] {
  if (change.change !== QUEUE_CHANGE.ADD && change.change !== QUEUE_CHANGE.EDIT) return [];

  return change.attachments ?? [];
}

/** The message a change names, by its id; none for one of the whole queue. */
function messageOf(change: AgentQueueChange): string | undefined {
  if (change.change === QUEUE_CHANGE.ADD) return change.id;

  return "messageId" in change ? change.messageId : undefined;
}

/**
 * The files a message was queued or edited with from this tab, kept in the
 * agent's pictures under the ids the service's answer names them by, before
 * any page naming them by those is drawn, so the landed row draws the bytes
 * the box held rather than reading them back.
 */
function keepLandedFiles(
  client: QueryClient,
  owner: string,
  queue: AgentQueue,
  messageId: string,
  attachments: readonly AgentAttachment[],
): void {
  const landed = queue.messages.find((message) => message.id === messageId);

  for (const [index, file] of (landed?.files ?? []).entries()) {
    const held = attachments[index];

    if (file.id === undefined || held === undefined) continue;

    if (pictureNow(client, owner, file.id).kind !== PICTURE_STATE.READY) {
      keepPictureRead(client, owner, file.id, fileUrl(held));
    }
  }
}

/** An agent's queue as its tab holds it. */
export interface AgentQueueControl {
  /** Its messages in the order they go, every change asked of it drawn over the page. */
  readonly messages: readonly QueuedMessage[];
  /** The messages the queue lists now, by id. */
  readonly listed: ReadonlySet<string>;
  readonly paused: AgentQueue["paused"];
  /** One change, drawn by the host at once and answered as the service answered it, asked once `after` settles where one is given. */
  readonly change: (
    change: AgentQueueChange,
    after?: Promise<unknown>,
  ) => Promise<AgentQueueAnswerView>;
  /** The message at `from` put at `to`, as a drag drops it. */
  readonly move: (from: number, to: number) => void;
  /** One message deleted, answered as a confirm reads it. */
  readonly remove: (message: QueuedMessage) => Promise<ActionResult>;
  /** The messages queued from this window that did not go, in the order they failed, none the queue lists. */
  readonly unsent: readonly UnsentQueued[];
  /** Lets a message not delivered go, sending nothing. */
  readonly drop: (id: string) => void;
}

export function useAgentQueue(
  agentId: string,
  queue: AgentQueue | undefined,
  /** The transcript as the tab holds it, where a message handed on before any page listed it is read back. */
  lines: readonly AgentTranscriptMessage[],
): AgentQueueControl {
  // Note that a message queued, or one sent on from the queue, is traced as a send; reordering and editing are not.
  const { mutateAsync: sendQueue } = useMutation(
    sendMutation(ACT_KIND.AGENTS_QUEUE, ({ change }) =>
      change.change === QUEUE_CHANGE.ADD || change.change === QUEUE_CHANGE.STEER
        ? SENTRY_SEND_SPAN.AGENT_QUEUE
        : undefined,
    ),
  );

  const queryClient = useQueryClient();
  const toast = useToast();
  const messages = queue?.messages ?? NO_MESSAGES;
  const listed = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  // The queue as last drawn, which an answer landing later reads its revision from.
  const latest = useRef(queue);
  latest.current = queue;
  const kept = useSelector(unsentQueued.store);

  const unsent = useMemo(
    () => kept.filter((each) => each.agentId === agentId && !listed.has(each.id)),
    [kept, agentId, listed],
  );

  // Note that only a page past the revision it failed at is the service's word, because the host's own draw of the add moves no revision.
  const revision = queue?.revision;
  const written = useMemo(() => rowsWritten(lines), [lines]);

  const landedIn = (each: UnsentQueued) =>
    each.agentId === agentId &&
    ((listed.has(each.id) && revision !== undefined && revision > each.revision) ||
      written.has(sentLineId(each.id)));

  const landed = kept.some(landedIn);
  // A message a read holds landed after all, and is let go quietly.
  const settled = useRef(landedIn);
  settled.current = landedIn;
  useEffect(() => {
    if (landed) unsentQueued.set((all) => all.filter((each) => !settled.current(each)));
  }, [landed]);

  const change = (next: AgentQueueChange, after?: Promise<unknown>) => {
    const files = filesOf(next);
    const messageId = messageOf(next);

    const drawnAs = files.map((file) => {
      const id = crypto.randomUUID();
      keepPictureRead(queryClient, agentId, id, fileUrl(file));

      return id;
    });

    const params = {
      agentId,
      change: next,
      ...(drawnAs.length === 0 ? undefined : { pictures: drawnAs }),
    };

    // Note that a message queued behind the box's own sends is asked only once they settle, so it never reaches the service ahead of them.
    const asked = after === undefined ? sendQueue(params) : after.then(() => sendQueue(params));

    return asked
      .catch(() => UNANSWERED)
      .then((answer) => {
        // Note that the files are kept under the service's ids as it answers, ahead of the page that carries its queue.
        if ("queue" in answer && messageId !== undefined && files.length > 0) {
          keepLandedFiles(queryClient, agentId, answer.queue, messageId, files);
        }

        const words = QUEUE_REFUSED_WORDS[next.change];

        if (!("failure" in answer) || words === undefined) return answer;

        // A message the queue did not take stays at its end, not delivered, under the id it went under.
        if (next.change === QUEUE_CHANGE.ADD) {
          const failed: UnsentQueued = {
            agentId,
            id: next.id,
            text: next.text,
            attachments: files,
            files: files.length,
            revision: latest.current?.revision ?? NO_REVISION,
          };

          unsentQueued.set((all) => [...all.filter((each) => each.id !== next.id), failed]);
        }

        toast({
          replayUnmasked: true,
          words,
          ...(answer.failure === AGENT_CALL_FAILURE.NOT_FOUND && messageId !== undefined
            ? { detail: QUEUE_LEFT_WORDS }
            : undefined),
          tone: STATUS_TONE.DANGER,
          failure: {
            surface:
              next.change === QUEUE_CHANGE.DELETE
                ? FAILURE_SURFACE.AGENT_QUEUE_DELETE
                : FAILURE_SURFACE.AGENT_QUEUE_CHANGE,
            cause: answer,
            about: { agentId },
          },
        });

        return answer;
      });
  };

  const move = (from: number, to: number) => {
    const ids = messages.map((message) => message.id);
    const [taken] = ids.splice(from, 1);

    if (taken === undefined) return;
    ids.splice(to, 0, taken);
    void change({ change: QUEUE_CHANGE.REORDER, order: ids });
  };

  // Note that the host draws the deletion on the press, so the dialog closes at once; one refused is taken back and said in a toast.
  const remove = (message: QueuedMessage) => {
    void change({ change: QUEUE_CHANGE.DELETE, messageId: message.id });

    return Promise.resolve<ActionResult>({ status: ACTION_RESULT_STATUS.ACCEPTED });
  };

  const drop = (id: string) => {
    takeUnsent(id);
  };

  return { messages, listed, paused: queue?.paused, change, move, remove, unsent, drop };
}

/** A queued message's files whole, read through the agent's pictures by the ids the queue names them under; none where any did not read. */
function readQueuedFiles(
  client: QueryClient,
  message: QueuedMessage,
  door: AgentPictureDoor,
): Promise<readonly AgentAttachment[] | undefined> {
  const files = message.files ?? [];

  return Promise.all(
    files.map(({ name, mediaType, id }) => {
      if (id === undefined) return undefined;

      // Note that a file the window holds already, one of a message queued here, is taken as it stands, since a picture's query never goes stale.
      return client.fetchQuery(pictureQuery(door.owner, id, door.read)).then(
        (read) =>
          read.kind === PICTURE_STATE.READY
            ? { name, mediaType, data: read.url.slice(read.url.indexOf(",") + 1) }
            : undefined,
        () => undefined,
      );
    }),
  ).then((read) => Option.getOrUndefined(Schema.decodeUnknownOption(agentAttachmentsSchema)(read)));
}

/** The box's words and files kept aside while it holds a queued message's words being edited. */
interface Stashed {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

/** How an agent's box queues its message and edits one queued already, as the composer's `queueing` takes it. */
export interface QueueEditing {
  /** The message the box is editing, by its id; none while none is. */
  readonly editing: string | undefined;
  /** The box's message queued behind the turn, after every line the box sent before it, the box emptied for the next. */
  readonly queue: () => void;
  /** The message's words and files taken into the box to edit, the box's own kept aside, and the message marked, which stops the hand-off at it. */
  readonly edit: (message: QueuedMessage) => void;
  /** The box's words saved back into the message's place, and the box given back what it held. */
  readonly save: () => void;
  /** The message sent now with the box's words, as one change of that message, and the box given back what it held. */
  readonly steer: () => void;
  /** The edit given up, the message left as it was, and the box given back what it held. */
  readonly cancel: () => void;
  /** The edit of `message` given up from its row: this box's own, as `cancel`, or one another window left standing, its mark cleared. */
  readonly cancelRow: (message: QueuedMessage) => void;
  /** A message not delivered queued again under the id it went under, after every line the box sent before it. */
  readonly retry: (id: string) => void;
  /** A message not delivered taken back into the box, ahead of what the box holds, which is newer. */
  readonly takeBack: (id: string) => void;
}

/**
 * The box's part in the queue. An edit moves the queued message's words into
 * the box, keeping what the box held aside, and marks the message as being
 * edited, which stops the hand-off at it; Save writes the words back in its
 * place, which the host draws in the message's row at once, and Steer sends
 * them now as that message, each closing the edit once the queue took it, so
 * a refusal leaves the words where they are, the box's own still kept aside. Cancel,
 * Escape, or Save with the box emptied lets it go as it was, and a message
 * the queue would not mark, already on its way, closes the edit. The mark
 * has no time to it: an edit left standing, its window closed, stays until
 * any of the member's windows cancels it from its row. Its files come into the box beside its words, read whole through the
 * agent's pictures as its row reads them (`readQueuedFiles`), where they are
 * taken off or joined as any message's are, and Save and Steer send the
 * box's files with its words; neither goes while they are still read, and an
 * edit whose files did not read closes, the message left as it was. A
 * message the queue did not take stays in the queue not delivered; Retry
 * queues it again under the id it went under, and Edit takes it back into
 * the box ahead of whatever was written there since (`refused-send.ts`),
 * under that id too, so queueing it again as it went can never queue it twice.
 */
export function useQueueEditing(
  composer: Pick<
    HeldComposer,
    "draft" | "setDraft" | "attachments" | "setAttachments" | "sendsSettled" | "updateHeld"
  >,
  queue: Pick<AgentQueueControl, "change" | "listed">,
  files: AgentPictureDoor,
): QueueEditing {
  const queryClient = useQueryClient();
  const [stashed, setStashed] = useState<Stashed | undefined>();
  const held = useRef<string | undefined>(undefined);
  held.current = stashed?.id;
  // Whether the service's queue has listed the message since its edit opened, which its leaving the queue is read against.
  const seen = useRef(false);
  const listed = stashed !== undefined && queue.listed.has(stashed.id);

  if (listed) seen.current = true;

  if (stashed === undefined) seen.current = false;
  // A message that left the queue while its edit stood open, sent or deleted elsewhere, is no longer the box's to
  // edit: the edit closes, its words left in the box.
  const left = stashed !== undefined && seen.current && !listed;
  useEffect(() => {
    if (left) setStashed(undefined);
  }, [left]);
  // The words a message not delivered gave back on Edit, and the id they went under, which queueing them again reuses.
  const refused = useRef<{ readonly text: string; readonly id: string } | undefined>(undefined);
  // The message whose files are still being read into the box, by id, which no Save or Steer sends meanwhile.
  const reading = useRef<string | undefined>(undefined);
  const { change } = queue;

  const giveBack = (stash: Stashed) => {
    composer.setDraft(stash.text);
    composer.setAttachments(() => stash.attachments);
    setStashed(undefined);
  };

  /** The edit closed once the queue took `edit`, where it is still this message's; left open where it was refused. */
  const closing = (stash: Stashed, edit: AgentQueueChange) => {
    void change(edit).then((answer) => {
      if (!("failure" in answer) && held.current === stash.id) giveBack(stash);
    });
  };

  /** The message the box queues, under `id`, after every line the box sent before it. */
  const add = (id: string, text: string, attachments: readonly AgentAttachment[]) => {
    void change(
      {
        change: QUEUE_CHANGE.ADD,
        id,
        text,
        ...(attachments.length === 0 ? undefined : { attachments }),
      },
      composer.sendsSettled(),
    );
  };

  /** The edit of `stash` given up, its mark cleared and the box given back what it held. */
  const cancelOf = (stash: Stashed) => {
    void change({ change: QUEUE_CHANGE.HOLD, messageId: stash.id, held: false });
    giveBack(stash);
  };

  const cancel = () => {
    if (stashed !== undefined) cancelOf(stashed);
  };

  return {
    editing: stashed?.id,
    queue: () => {
      const text = composer.draft.trim();
      const { attachments } = composer;

      if (!hasWordsOrFiles(text, attachments)) return;
      const again = refused.current;
      const id = again !== undefined && again.text === text ? again.id : crypto.randomUUID();
      refused.current = undefined;
      composer.setDraft("");
      composer.setAttachments(() => []);
      add(id, text, attachments);
    },
    edit: (message) => {
      if (stashed !== undefined)
        void change({ change: QUEUE_CHANGE.HOLD, messageId: stashed.id, held: false });

      const kept = stashed ?? {
        id: message.id,
        text: composer.draft,
        attachments: composer.attachments,
      };

      const stash = { ...kept, id: message.id };
      setStashed(stash);
      composer.setDraft(message.text);
      composer.setAttachments(() => []);
      // A message the queue would not mark, already on its way, is no longer the box's to edit.
      void change({ change: QUEUE_CHANGE.HOLD, messageId: message.id, held: true }).then(
        (answer) => {
          if ("failure" in answer && held.current === message.id) giveBack(stash);
        },
      );

      if ((message.files ?? []).length === 0) return;
      // Its files join the box ahead of any taken on meanwhile, or, where they did not read, the edit closes.
      reading.current = message.id;
      void readQueuedFiles(queryClient, message, files).then((read) => {
        if (held.current !== message.id) return;
        reading.current = undefined;

        if (read === undefined) return cancelOf(stash);
        composer.setAttachments((added) => [...read, ...added]);
      });
    },
    save: () => {
      if (stashed === undefined || reading.current === stashed.id) return;
      const text = composer.draft.trim();
      const { attachments } = composer;

      if (!hasWordsOrFiles(text, attachments)) return cancel();
      closing(stashed, {
        change: QUEUE_CHANGE.EDIT,
        messageId: stashed.id,
        text,
        ...(attachments.length === 0 ? undefined : { attachments }),
      });
    },
    steer: () => {
      if (stashed === undefined || reading.current === stashed.id) return;
      const text = composer.draft.trim();
      const { attachments } = composer;

      if (!hasWordsOrFiles(text, attachments)) return cancel();
      closing(stashed, {
        change: QUEUE_CHANGE.STEER,
        messageId: stashed.id,
        text,
        ...(attachments.length === 0 ? undefined : { attachments }),
      });
    },
    cancel,
    cancelRow: (message) => {
      if (message.id === stashed?.id) return cancel();
      void change({ change: QUEUE_CHANGE.HOLD, messageId: message.id, held: false });
    },
    retry: (id) => {
      const unsent = takeUnsent(id);

      if (unsent !== undefined) add(unsent.id, unsent.text, unsent.attachments);
    },
    takeBack: (id) => {
      const unsent = takeUnsent(id);

      if (unsent === undefined) return;
      const { text, attachments } = unsent;
      // Its words and files come into the box ahead of what was written there since.
      putBackRefused({
        went: { text, attachments },
        most: AGENT_BOUNDS.MAX_MESSAGE_CHARS,
        update: (next) =>
          composer.updateHeld((now) => {
            const joined = next(now);

            if (joined !== undefined) refused.current = { text, id };

            return joined;
          }),
      });
    },
  };
}
