/**
 * use-thread-answer.ts -- a thread's answer as the app holds and sends it: the draft on its box, kept for the thread whatever screen draws it, and each answer, reply, and resolve drawn at once and taken back where the service refused it.
 *
 * What a draft sends is the panel's own reading (`@repo/features/inbox-draft`'s
 * `inboxThreadSend`), sent on the host's act port as the panel sends it: a
 * reply, carrying the open ask's answer where the draft holds one, as
 * `AGENTS_INBOX_MESSAGE`, and a resolve as `AGENTS_INBOX_CLOSE`. Each send is
 * drawn over the thread the moment it is pressed (`inboxSendingDrawn`), so
 * the list and the thread read it settled at once, and stands until a read
 * carries it. A reply or a thread's start refused, or one no answer came
 * back for, which may have reached the agent all the same, never goes back
 * into the box: it stays at the thread's foot marked Not delivered
 * (`undelivered.ts`, `@repo/features/inbox-undelivered`), as the panel keeps
 * it, with Retry, which sends it again under the key it went under so the
 * service takes it once, Edit, which takes its words, pictures, and picks
 * back into the box, and Delete; a refusal also says why in the box's head,
 * and the phone buzzes as a refusal does. A read holding a message under its
 * key settles it, since that one went.
 * The box's next send may start a new thread with the thread's agent
 * instead (`AGENTS_INBOX_START`), as the panel's "Send as a new thread to"
 * does: its words the thread's first message, the new thread opened once
 * the service took it, and the box replying again after.
 * A resolve that went, and a notice's Got it, which nods to it with nothing
 * written (`AGENTS_INBOX_ANSWER`), say so in the app's one notice with Undo
 * (`useSettleUndo`), in the panel's words, which takes the settle back by
 * the key it went under (`AGENTS_INBOX_TAKE_BACK`), the thread open again.
 * Note that the drafts and the sends are kept in one store beside the
 * screens rather than in a screen's state, so folding or unfolding the
 * iPhone Duo, which draws the thread on another screen, keeps both.
 *
 * A notification's action, a decide's option or a reply typed in place,
 * opens the app on its thread and is held here (`pressFromNotification`)
 * until the thread's box stands, which sends it once as though it were
 * pressed there, so it is drawn, refused, and buzzed as any send is. An
 * option whose ask is no longer the thread's open one is let go unsent.
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { missingWords } from "@repo/features/inbox-ask-words";
import {
  type InboxFields,
  type InboxRow,
  inboxRowDrawn,
  inboxRowOf,
} from "@repo/features/inbox-digest";
import {
  EMPTY_INBOX_DRAFT,
  fieldValueOf,
  type InboxDraft,
  inboxMissing,
  inboxThreadSend,
  withChoice,
} from "@repo/features/inbox-draft";
import {
  acknowledgedOnOpen,
  awaitsNod,
  holderTask,
  type InboxAnyHolder,
  knownAsk,
} from "@repo/features/inbox-list-model";
import { INBOX_PUSH_PRESS, type InboxPushPress } from "@repo/features/inbox-push-wire";
import {
  filesLost,
  UNHEARD_UNDELIVERED,
  type UndeliveredReply,
  undeliveredDraft,
  undeliveredOn,
  undeliveredTakenBack,
  withUndelivered,
} from "@repo/features/inbox-undelivered";
import {
  INBOX_ASK,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
  openAskOf,
} from "@repo/features/inbox-wire";
import {
  ACKNOWLEDGE_UNTAKEN,
  acknowledgedWords,
  NOT_ACKNOWLEDGED,
  NOT_RESOLVED,
  RESOLVE_UNTAKEN,
  resolvedWords,
  TOOK_BACK,
  type TookBack,
  untakenSaid,
} from "@repo/features/inbox-write-words";
import {
  INBOX_SENDING,
  type InboxHeldFile,
  type InboxReader,
  type InboxSending,
  inboxSendingDrawn,
  inboxSendingFile,
  inboxSendingFiles,
} from "@repo/features/inbox-writes";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount } from "@repo/host/app-state-reads";
import { actRefusalSentence } from "@repo/host/contract";
import {
  BUZZ,
  buzz,
  heldValue,
  NOTICE_KIND,
  useFailureNotices,
  useHeldValue,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Predicate } from "effect";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { replyLetGo, replyPressed } from "../reply-drawn.js";
import { useWrite } from "../use-write.js";
import {
  dropUndelivered,
  keepUndelivered,
  settleUndelivered,
  undeliveredLine,
  undeliveredOnItem,
  useUndelivered,
} from "./undelivered.js";

/** What the app holds of one thread: the draft on its box, the sends not yet carried by a read, by key, what its last refused send said, and a notification's action not yet sent. */
interface ThreadHeld {
  readonly draft: InboxDraft;
  readonly sending: ReadonlyMap<string, InboxSending>;
  readonly note: string | undefined;
  readonly pressed?: InboxPushPress;
  /** Whether the box's next send starts a new thread with the thread's agent rather than replying. */
  readonly asNew?: boolean;
  /** The key the last thread start went under, its words and its pictures, which a start of the same words and pictures goes under again, so a retry starts one thread. */
  readonly started?: {
    readonly key: string;
    readonly words: string;
    readonly attachments: readonly AgentAttachment[];
  };
  /** The key of the Got it out, which takes Got it off the thread while it is out, as the host draws the thread settled once it goes, and sends nothing on a second press. */
  readonly nodding?: string | undefined;
  /** The key of the thread's start out, which a start that did not go stands under and Retry sends again, so its line steps aside while it goes. */
  readonly startOut?: string | undefined;
  /** The reply Edit took back into the box, by what it sends, which a send of the same goes under again, so a reply that landed unheard is taken once. */
  readonly edited?: { readonly key: string; readonly words: string } | undefined;
}

/** A thread the app holds nothing of. */
const NOTHING_HELD: ThreadHeld = { draft: EMPTY_INBOX_DRAFT, sending: new Map(), note: undefined };

/** What a refused reply says, by why it was refused, in the panel's words. */
export function refusedWords(failure: AgentCallFailure): string {
  if (failure === AGENT_CALL_FAILURE.NOT_FOUND) return "This agent no longer exists.";

  if (failure === AGENT_CALL_FAILURE.UNANSWERED) return "No answer came back. Try again.";

  return "The message could not be sent. Try again.";
}

/** What a settle's Undo notice says it did, and what its take-back says where the service did not take it, in the panel's words: a resolve's, or a Got it's. */
export const SETTLE = {
  RESOLVE: { words: resolvedWords, untaken: RESOLVE_UNTAKEN },
  ACKNOWLEDGE: { words: acknowledgedWords, untaken: ACKNOWLEDGE_UNTAKEN },
} as const;

export type Settle = (typeof SETTLE)[keyof typeof SETTLE];

/** The label of the open ask's first number field whose words read as no number, which the box holds the answer back for; none where every number reads. */
function unreadableNumber(thread: readonly InboxMessage[], draft: InboxDraft): string | undefined {
  const ask = openAskOf(thread)?.ask;

  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.ANSWER) return undefined;

  return ask.fields?.find(
    (field) =>
      field.type === INBOX_FIELD.NUMBER && Predicate.isString(fieldValueOf(draft, field.label)),
  )?.label;
}

/** What the box says of a number field whose words read as no number. */
function unreadableWords(label: string): string {
  return `Write a number in ${label}.`;
}

/** Whether two starts carry the same pictures, each by its name and bytes, in the same order. */
function samePictures(one: readonly AgentAttachment[], other: readonly AgentAttachment[]): boolean {
  return (
    one.length === other.length &&
    one.every((each, at) => each.name === other[at]?.name && each.data === other[at]?.data)
  );
}

/** What a reply sends: its words and pictures, the answer it carries, and the notice's revision it settles. */
interface ReplySent {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly answers?: InboxAnswers | undefined;
  readonly revision?: number | undefined;
}

/** The words a reply is known by, which the same reply sent again after Edit is known by too, so it goes under the same key. */
function sentWords({ text, attachments, answers }: ReplySent): string {
  return JSON.stringify([text, attachments.map(({ name, data }) => [name, data]), answers]);
}

/** Whether a refusal the act threw is the host's or the service's, said in a sentence, rather than a send no answer came back for. */
function heardRefusal(cause: unknown): boolean {
  return actRefusalSentence(cause) !== undefined;
}

/** The draft a notification's action sends on the thread: its option on the ask it answers, while that ask is still the open one, or its words; none otherwise. */
function pressedDraft(
  thread: readonly InboxMessage[],
  press: InboxPushPress,
): InboxDraft | undefined {
  if (press.kind === INBOX_PUSH_PRESS.REPLY) return { ...EMPTY_INBOX_DRAFT, note: press.text };
  const asking = openAskOf(thread);

  if (asking?.message.id !== press.messageId || !knownAsk(asking.ask)) return undefined;
  const { ask } = asking;

  if (ask.type !== INBOX_ASK.DECIDE) return undefined;

  return ask.options.some((option) => option.label === press.option)
    ? withChoice(ask, EMPTY_INBOX_DRAFT, press.option)
    : undefined;
}

/* ----- The store ----- */

/** Every thread the app holds something of, by its item's id. */
const threads = heldValue<ReadonlyMap<string, ThreadHeld>>(new Map());

/** A file a reply sent from the phone on `itemId` carries, by its attachment, as the thread draws it from the reply's own bytes, before a read carries the reply and after, under the attachment `thread` names it by; none for any other. */
export function pendingThreadFile(
  itemId: string,
  attachmentId: string,
  thread: readonly InboxMessage[] | undefined,
): InboxHeldFile | undefined {
  const sending = threads.read().get(itemId)?.sending.values() ?? [];

  // Note that a reply that did not go draws its pictures from the bytes it still holds, as one on its way does.
  const undelivered = undeliveredOnItem(itemId).map(
    (line): InboxSending => ({
      kind: INBOX_SENDING.REPLY,
      key: line.key,
      text: line.text,
      files: inboxSendingFiles(line.key, line.attachments),
      at: line.at,
    }),
  );

  return inboxSendingFile([...sending, ...undelivered], attachmentId, thread);
}

/** The store with the thread's holding changed as `change` says. */
function hold(itemId: string, change: (was: ThreadHeld) => ThreadHeld): void {
  const held = threads.read();
  threads.set(new Map(held).set(itemId, change(held.get(itemId) ?? NOTHING_HELD)));
}

/**
 * The store with each close a read carries let go: one on a thread the read
 * holds settled. Note that a close the host took may only be queued, and the
 * host draws it over its own reads until it goes, and takes it back where
 * its retry is refused, so the thread reads open again rather than stand
 * closed by a send the app no longer has out.
 */
function letGoCarriedCloses(items: readonly Pick<InboxItem, "id" | "status">[]): void {
  const carried = items.filter(
    (item) =>
      item.status !== INBOX_STATUS.OPEN &&
      [...(threads.read().get(item.id)?.sending.values() ?? [])].some(
        (sending) => sending.kind === INBOX_SENDING.CLOSE,
      ),
  );

  for (const item of carried) {
    hold(item.id, (was) => ({
      ...was,
      sending: new Map(
        [...was.sending].filter(([, sending]) => sending.kind !== INBOX_SENDING.CLOSE),
      ),
    }));
  }
}

/** The store with the thread's closes let go, as its Undo asks, so the thread is drawn as the host draws the take-back rather than closed by a send taken back. */
function letGoCloses(itemId: string): void {
  if (!threads.read().has(itemId)) return;
  hold(itemId, (was) => ({
    ...was,
    sending: new Map(
      [...was.sending].filter(([, sending]) => sending.kind !== INBOX_SENDING.CLOSE),
    ),
  }));
}

/** Holds a notification's action for its thread's box to send once it stands, in place of any held before it. */
export function pressFromNotification(press: InboxPushPress): void {
  hold(press.itemId, (was) => ({ ...was, pressed: press }));
}

/* ----- Reads ----- */

/** The account signed in, as an answer or a resolve names who gave it; none while none is. */
function useReader(): InboxReader | undefined {
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });

  return useMemo(
    () =>
      account?.status === ACCOUNT_STATUS.SIGNED_IN && account.id !== undefined
        ? { userId: account.id, name: account.name ?? account.email }
        : undefined,
    [account],
  );
}

/**
 * The groups with the reader's sends still out drawn on their rows, as
 * `useSendsDrawn` draws them on whole items: each send drawn over the thread
 * the row's digest carries (`inboxRowDrawn`), so a reply stands as the
 * thread's latest words and a close settles it, at once. A send is taken as
 * landed once a row's latest messages hold one under its key, since a
 * reply lands as the thread's latest message.
 */
export function useSendsDrawnOnRows<Group extends { readonly items: readonly InboxRow[] }>(
  groups: readonly Group[],
): readonly Group[] {
  const store = useHeldValue(threads);
  const reader = useReader();
  useEffect(() => {
    const items = groups.flatMap((group) => group.items);
    letGoCarriedCloses(items);
    settleUndelivered(items.map((row) => ({ id: row.id, thread: row.digest.tail })));
  }, [groups]);

  return useMemo(() => {
    if (store.size === 0) return groups;

    return groups.map((group) => {
      if (!group.items.some((item) => (store.get(item.id)?.sending.size ?? 0) > 0)) return group;

      return {
        ...group,
        items: group.items.map((row) => {
          const sending = store.get(row.id)?.sending;

          return sending === undefined || sending.size === 0
            ? row
            : (inboxRowDrawn(row, (item) =>
                inboxSendingDrawn(item, [...sending.values()], reader),
              ) ?? row);
        }),
      };
    });
  }, [groups, store, reader]);
}

/**
 * The reader's sends drawn over the threads they were sent on, so the list,
 * the badge, and the thread read each settled the moment it is pressed; a
 * thread with nothing out stands as the read holds it.
 */
export function useSendsDrawn<Group extends { readonly items: readonly InboxItem[] }>(
  groups: readonly Group[],
): readonly Group[] {
  const store = useHeldValue(threads);
  const reader = useReader();
  useEffect(() => {
    const items = groups.flatMap((group) => group.items);
    letGoCarriedCloses(items);
    // Note that a reply that did not go is taken as sent once a read holds a message under its key, since one no answer came back for may have landed.
    settleUndelivered(items);
  }, [groups]);

  return useMemo(() => {
    if (store.size === 0) return groups;

    return groups.map((group) => {
      if (!group.items.some((item) => (store.get(item.id)?.sending.size ?? 0) > 0)) return group;

      return {
        ...group,
        items: group.items.map((item) => {
          const sending = store.get(item.id)?.sending;

          return sending === undefined || sending.size === 0
            ? item
            : inboxSendingDrawn(item, [...sending.values()], reader);
        }),
      };
    });
  }, [groups, store, reader]);
}

/** A thread as it is drawn with the reader's replies on it that did not go, and those replies. */
export interface UndeliveredShown {
  /** The item with each reply that did not go at its thread's foot, as the reader's own message under its key (`withUndelivered`). */
  readonly item: InboxItem;
  /** The replies on it that did not go, in the order they failed, but for those a read holds under their keys already and one Retry has on its way, which stands on the thread as sending meanwhile. */
  readonly lines: readonly UndeliveredReply[];
}

/** The reader's replies on `item` that did not go, and the item as its thread draws them, at its foot marked Not delivered. */
export function useUndeliveredShown(item: InboxItem): UndeliveredShown {
  const reader = useReader();
  const all = useUndelivered(reader?.userId);
  const held = useHeldValue(threads, (store) => store.get(item.id));

  return useMemo(() => {
    const out = (key: string) =>
      held?.sending.has(key) === true ||
      held?.startOut === key ||
      (item.thread ?? []).some(({ id, clientKey }) => id === key || clientKey === key);

    const lines = undeliveredOn(all, item.id, out);

    return { item: withUndelivered(item, lines, reader), lines };
  }, [item, all, held, reader]);
}

/* ----- Undo ----- */

/** A thread a settle went on, and the key it went under, by which its Undo takes it back. */
export interface SettledThread {
  readonly item: InboxFields;
  readonly key: string;
}

/** Whether a take-back the service answered took the settle back, an unreached one counting as not. */
function tookBack(
  answer: { readonly outcome: TookBack } | { readonly failure: unknown },
): TookBack {
  return "failure" in answer ? TOOK_BACK.UNREACHED : answer.outcome;
}

/**
 * Says a settle that went in the app's one notice, the thread by its title or
 * the threads by how many, or in `words` where the caller says it otherwise,
 * such as how many went of several, with Undo, which takes each back by the
 * key it went under, as the panel's toast does: the threads open again,
 * waiting on the reader; or, where the service did not take one back, says
 * why, with Try again where no take-back was reached.
 */
export function useSettleUndo(): (
  threads: readonly SettledThread[],
  settle: Settle,
  words?: string,
) => void {
  const notices = useFailureNotices();
  const acts = useHostActs();
  const write = useWrite();

  return useCallback(
    (threads, settle, words) => {
      // Note that every take-back goes as one write, so several answer with one buzz and one notice rather than one each, and that Try again sends again only those no answer reached.
      const takeBack = () => {
        for (const { item } of threads) letGoCloses(item.id);
        let unreached = threads;
        // Note that what the service answered stays among the outcomes a Try again is read with, so a refusal it said is said again rather than hidden by a later take-back that went.
        let answered: readonly TookBack[] = [];
        void write(
          () =>
            Promise.all(
              unreached.map(({ item, key }) =>
                Promise.resolve(
                  acts[ACT_KIND.AGENTS_INBOX_TAKE_BACK]({ itemId: item.id, clientKey: key }),
                ).then(tookBack, () => TOOK_BACK.UNREACHED),
              ),
            ).then((outcomes) => {
              unreached = unreached.filter((_, at) => outcomes[at] === TOOK_BACK.UNREACHED);
              const seen = [...answered, ...outcomes];
              answered = seen.filter((outcome) => outcome !== TOOK_BACK.UNREACHED);

              return seen;
            }),
          {
            refused: (outcomes) => untakenSaid(outcomes, settle.untaken),
            unanswered: settle.untaken.unreached,
            // Note that only a take-back the service never answered offers Try again, under the same keys; one it refused never takes.
            retry: (outcomes) => outcomes.includes(TOOK_BACK.UNREACHED),
            went: BUZZ.SUCCESS,
          },
        );
      };

      notices.say({
        kind: NOTICE_KIND.DONE,
        words: words ?? settle.words(threads.map(({ item }) => item)),
        undo: takeBack,
      });
    },
    [notices, acts, write],
  );
}

/* ----- The thread's box ----- */

/** A thread's box as its screen draws and presses it. */
export interface ThreadAnswer {
  readonly draft: InboxDraft;
  /** Sets the draft, or changes it from the one the box holds now, which a change that lands later, such as the photo picker's, reads rather than the draft it was opened on. */
  readonly onDraft: (draft: InboxDraft | ((now: InboxDraft) => InboxDraft)) => void;
  /** What the box's last send said where it did not go: what the answer lacks, or the refusal. */
  readonly note: string | undefined;
  /** Whether Send stands lit with no words typed: the draft holds an answer to send, or a number whose words a press says read as none. */
  readonly answerReady: boolean;
  /** Sends what the draft holds, or the draft given, such as one Mark done was just pressed on; or says what it lacks. Answers whether it sent. */
  readonly send: (pressed?: InboxDraft) => boolean;
  /** Resolves the thread without an answer, with Undo once it went. */
  readonly resolve: () => void;
  /** Whether the box's Send reads Got it, as the panel's does: a notice open, asking nothing, that opening did not settle (`acknowledgedOnOpen`), the box empty, and no Got it out, so a press takes it away at once until the host draws the thread settled. */
  readonly nods: boolean;
  /** Settles the notice with Got it, messaging nobody, with Undo once it went; the empty box's Send. */
  readonly acknowledge: () => void;
  /** Whether the box's next send starts a new thread with the thread's agent, as the panel's "Send as a new thread to" asks. */
  readonly asNew: boolean;
  readonly setAsNew: (asNew: boolean) => void;
  /**
   * The box's Send, on the words it took out of the field: a new thread's
   * start where the box starts one, Got it where the box holds nothing to
   * send and the notice waits on a nod, and else a reply of those words
   * with the rest of the draft as it stands now. Answers whether it took
   * the words (`ComposerSend`).
   */
  readonly sendTyped: (typed: string) => boolean;
  /** Sends a reply that did not go again under the key it went under; none where a relaunch took its pictures, which Edit attaches again. */
  readonly retryUndelivered: (key: string) => void;
  /** Takes a reply that did not go back into the box, ahead of what was typed since, to send again. */
  readonly editUndelivered: (key: string) => void;
  /** Lets go of a reply that did not go. */
  readonly deleteUndelivered: (key: string) => void;
}

/** The new threads out, by the item's id, so a second start waits for the first's answer rather than racing it for the box's words. */
const starting = new Set<string>();

/**
 * The box of the thread `listed` stands for: its draft, and its Send, Got
 * it, Resolve, and the start of a new thread with its agent, which
 * `onStarted` opens. Opening the reader's own notice acknowledges it, as
 * the panel's open does (`useNodOnOpen`): once for each revision each time
 * it is shown, messaging nobody and offering no Undo, since opening was the
 * nod, and never while the box holds words or pictures, which stay a reply
 * to send.
 */
export function useThreadAnswer(
  listed: { readonly holder: InboxAnyHolder; readonly item: InboxItem },
  readerId: string | undefined,
  onStarted?: (itemId: string) => void,
): ThreadAnswer {
  const acts = useHostActs();
  const write = useWrite();
  const settled = useSettleUndo();
  const { item } = listed;
  const itemId = item.id;
  const store = useHeldValue(threads);
  const { draft, note, asNew = false, nodding } = store.get(itemId) ?? NOTHING_HELD;
  const thread = item.thread ?? [];

  const onDraft = useCallback(
    (next: InboxDraft | ((now: InboxDraft) => InboxDraft)) =>
      hold(itemId, (was) => ({
        ...was,
        draft: Predicate.isFunction(next) ? next(was.draft) : next,
        note: undefined,
      })),
    [itemId],
  );

  // A send let go once refused, for the resolve whose draft stands on the box: the draft back, ahead of nothing typed since, and the refusal said.
  const refuse = (key: string, sent: InboxDraft, words: string) => {
    hold(itemId, (was) => {
      const sending = new Map(was.sending);
      sending.delete(key);

      // Note that pictures attached since count as typed, so a refusal never takes them off.
      const typed =
        was.draft.note.trim() === "" && was.draft.attachments.length === 0 ? sent : was.draft;

      return { ...was, draft: typed, sending, note: words };
    });
  };

  // Note that a reply that did not go stays at the thread's foot under its key, never back in the box, with why: the refusal's words, which the box says too, or that no answer came back, which only its mark says.
  const undelivered = (line: Omit<UndeliveredReply, "why">, words: string, heard: boolean) => {
    replyLetGo(line.key);
    hold(itemId, (was) => {
      const sending = new Map(was.sending);
      sending.delete(line.key);

      return { ...was, sending, note: heard ? words : was.note };
    });

    if (readerId !== undefined)
      keepUndelivered(readerId, { ...line, why: heard ? words : UNHEARD_UNDELIVERED });
  };

  // A reply sent under `key`, drawn at the thread's foot at once, and kept Not delivered where it did not go.
  const sendReply = (sent: ReplySent, key: string, at: number) => {
    replyPressed(key, sent.attachments.length > 0);
    hold(itemId, (was) => ({
      ...was,
      note: undefined,
      sending: new Map(was.sending).set(key, {
        kind: INBOX_SENDING.REPLY,
        key,
        text: sent.text,
        answers: sent.answers,
        files: inboxSendingFiles(key, sent.attachments),
        at,
      }),
    }));

    const line = {
      key,
      taskId: holderTask(listed.holder)?.id ?? null,
      itemId,
      text: sent.text,
      attachments: sent.attachments,
      files: sent.attachments.length,
      answers: sent.answers,
      revision: sent.revision,
      at,
    };

    let heard = true;
    write(
      () =>
        acts[ACT_KIND.AGENTS_INBOX_MESSAGE]({
          itemId,
          text: sent.text,
          ...(sent.attachments.length === 0 ? undefined : { attachments: [...sent.attachments] }),
          ...(sent.answers === undefined ? undefined : { answers: sent.answers }),
          ...(sent.revision === undefined ? undefined : { revision: sent.revision }),
          clientKey: key,
        }).then(
          (answer) => {
            heard = !("failure" in answer) || answer.failure !== AGENT_CALL_FAILURE.UNANSWERED;

            return answer;
          },
          (cause: unknown) => {
            heard = heardRefusal(cause);
            throw cause;
          },
        ),
      {
        refused: (answer) => ("failure" in answer ? refusedWords(answer.failure) : undefined),
        unanswered: refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        inPlace: (words) => undelivered(line, words, heard),
        went: BUZZ.SUCCESS,
        done: () => dropUndelivered(key),
      },
    );
  };

  const send = (pressed?: InboxDraft) => {
    const sending = pressed ?? draft;
    const unreadable = unreadableNumber(thread, sending);

    if (unreadable !== undefined) {
      hold(itemId, (was) => ({ ...was, note: unreadableWords(unreadable) }));
      buzz(BUZZ.WARNING);

      return false;
    }

    const message = inboxThreadSend(thread, sending);

    if (message === undefined) {
      const missing = inboxMissing(thread, sending);
      hold(itemId, (was) => ({
        ...was,
        note: missing === undefined ? undefined : missingWords(missing),
      }));
      buzz(BUZZ.WARNING);

      return false;
    }

    const sent = { ...message, revision: awaitsNod(inboxRowOf(item)) ? item.revision : undefined };
    // Note that the reply Edit took back, sent again as it was, goes under the key it went under, so one that landed unheard is taken once.
    const edited = threads.read().get(itemId)?.edited;
    const key = edited?.words === sentWords(sent) ? edited.key : randomUUID();
    // Note that the box lets go of what it sent at once and never takes it back.
    hold(itemId, ({ edited: _sent, ...was }) => ({ ...was, draft: EMPTY_INBOX_DRAFT }));
    sendReply(sent, key, Date.now());

    return true;
  };

  const resolve = () => {
    const key = randomUUID();
    hold(itemId, (was) => ({
      ...was,
      note: undefined,
      sending: new Map(was.sending).set(key, {
        kind: INBOX_SENDING.CLOSE,
        revision: item.revision,
        at: Date.now(),
      }),
    }));
    write(
      () => acts[ACT_KIND.AGENTS_INBOX_CLOSE]({ itemId, revision: item.revision, clientKey: key }),
      {
        refused: (answer) =>
          "failure" in answer
            ? refusedWords(answer.failure)
            : answer.taken
              ? undefined
              : NOT_RESOLVED[answer.item.status],
        unanswered: refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        inPlace: (words) => refuse(key, draft, words),
        went: BUZZ.SUCCESS,
        done: () => settled([{ item, key }], SETTLE.RESOLVE),
      },
    );
  };

  // Got it nods at the revision drawn, so an agent's change since is never settled unseen; one settled first by someone else is passed over quietly, with no Undo, since what was asked already stands. Note that a nod sent on opening buzzes nothing and offers no Undo, as the panel's open nod does, since no person pressed for it.
  const nod = (opened: boolean) => {
    if (threads.read().get(itemId)?.nodding !== undefined) return;
    const key = randomUUID();
    let taken = false;
    // Note that a Got it's refusal and its letting go touch the box only while the Got it out is still this one.
    const ours = () => threads.read().get(itemId)?.nodding === key;
    hold(itemId, (was) => ({ ...was, note: undefined, nodding: key }));
    void write(
      () =>
        acts[ACT_KIND.AGENTS_INBOX_ANSWER]({
          itemId,
          revision: item.revision,
          reply: INBOX_REPLY.ACKNOWLEDGED,
          clientKey: key,
        }).then((answer) => {
          taken = !("failure" in answer) && answer.taken;

          return answer;
        }),
      {
        refused: (answer) =>
          "failure" in answer
            ? refusedWords(answer.failure)
            : answer.taken || answer.item.status !== INBOX_STATUS.OPEN
              ? undefined
              : NOT_ACKNOWLEDGED,
        unanswered: refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        inPlace: (words) => {
          if (ours()) hold(itemId, (was) => ({ ...was, note: words }));
        },
        went: opened ? undefined : BUZZ.SUCCESS,
      },
    ).then((went) => {
      if (ours()) hold(itemId, (was) => ({ ...was, nodding: undefined }));

      if (went && taken && !opened) settled([{ item, key }], SETTLE.ACKNOWLEDGE);
    });
  };

  const acknowledge = () => nod(false);
  const settlesOnOpen = acknowledgedOnOpen(inboxRowOf(item), readerId);
  const empty = draft.note.trim() === "" && draft.attachments.length === 0;

  // Opening the reader's own notice acknowledges it, once for each revision shown, as the panel's open does.
  const noddedOn = useRef<{ readonly id: string; readonly revision: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    // Note that nothing is settled until the reader is known, so a teammate's notice is never acknowledged.
    if (readerId === undefined) return;
    const was = noddedOn.current;

    if (was !== undefined && was.id === itemId && was.revision === item.revision) return;
    noddedOn.current = { id: itemId, revision: item.revision };

    // Note that a notice opened while its box holds a draft is left waiting until it is opened again, so a box emptied of its draft never settles it under the reader's hands.
    if (settlesOnOpen && empty) nod(true);
  }, [itemId, item.revision, readerId, settlesOnOpen]);

  const setAsNew = useCallback(
    (on: boolean) => hold(itemId, (was) => ({ ...was, asNew: on, note: undefined })),
    [itemId],
  );

  // A thread's start under `key`, its words and pictures the new thread's first message, kept Not delivered where it did not go and opened once the service took it. One start is out at a time, as one Got it is.
  const startUnder = (text: string, attachments: readonly AgentAttachment[], key: string) => {
    if (starting.has(itemId)) return;
    starting.add(itemId);
    const at = undeliveredLine(key)?.at ?? Date.now();
    let startedId: string | undefined;
    let heard = true;
    hold(itemId, (was) => ({
      ...was,
      note: undefined,
      started: { key, words: text, attachments },
      startOut: key,
    }));
    void write(
      () =>
        acts[ACT_KIND.AGENTS_INBOX_START]({
          agentId: item.agentId,
          text,
          ...(attachments.length === 0 ? undefined : { attachments: [...attachments] }),
          clientKey: key,
        }).then(
          (answer) => {
            if (!("failure" in answer)) startedId = answer.item.id;
            else heard = answer.failure !== AGENT_CALL_FAILURE.UNANSWERED;

            return answer;
          },
          (cause: unknown) => {
            heard = heardRefusal(cause);
            throw cause;
          },
        ),
      {
        refused: (answer) => ("failure" in answer ? refusedWords(answer.failure) : undefined),
        unanswered: refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        // Note that a start that did not go stays on the thread marked as a new thread, never back in the box, so a later Send never posts its words as a reply.
        inPlace: (words) => {
          hold(itemId, (was) => ({ ...was, note: heard ? words : was.note }));

          if (readerId === undefined) return;
          keepUndelivered(readerId, {
            key,
            taskId: holderTask(listed.holder)?.id ?? null,
            itemId,
            text,
            attachments,
            files: attachments.length,
            at,
            why: heard ? words : UNHEARD_UNDELIVERED,
            startsThread: true,
          });
        },
        went: BUZZ.SUCCESS,
        done: () => dropUndelivered(key),
      },
    ).then((went) => {
      starting.delete(itemId);
      hold(itemId, ({ startOut: _out, ...was }) => was);

      if (!went || startedId === undefined || threads.read().get(itemId)?.started?.key !== key)
        return;
      hold(itemId, ({ started: _sent, ...was }) => ({ ...was, asNew: false }));
      onStarted?.(startedId);
    });
  };

  // Note that the same words and pictures sent again go under the key they went under, so a retry starts one thread, and a start whose pictures changed goes under a new key, which the service would refuse under the old one. The box lets go of its words at once, as a reply does.
  const start = (sending: InboxDraft): boolean => {
    const text = sending.note.trim();

    if (text === "" || starting.has(itemId)) return false;
    // The pictures the box holds go as the new thread's first message's, as the panel's start carries its files.
    const { attachments } = sending;
    const before = threads.read().get(itemId)?.started;

    const key =
      before?.words === text && samePictures(before.attachments, attachments)
        ? before.key
        : randomUUID();

    hold(itemId, (was) => ({ ...was, draft: { ...was.draft, note: "", attachments: [] } }));
    startUnder(text, attachments, key);

    return true;
  };

  // Whether a box holding `held` reads Got it: see `nods`.
  const nodsOn = (held: InboxDraft) =>
    !asNew &&
    nodding === undefined &&
    awaitsNod(inboxRowOf(item)) &&
    !settlesOnOpen &&
    held.note.trim() === "" &&
    held.attachments.length === 0;

  // Note that the draft is read from the store as it stands at the press, which a send before it already emptied, rather than as the render pressed in held it, so a second press that reaches the box with the first sends nothing again.
  const sendTyped = (typed: string): boolean => {
    const now = threads.read().get(itemId);
    const sending = { ...(now?.draft ?? EMPTY_INBOX_DRAFT), note: typed };

    if (now?.asNew === true) return start(sending);

    if (nodsOn(sending)) {
      acknowledge();

      return true;
    }

    // Note that Send stands on an empty field only for an answer ready, so a press that finds none ready and no words, as one after a send that went, does nothing.
    const ready =
      unreadableNumber(thread, sending) !== undefined ||
      inboxThreadSend(thread, sending) !== undefined;

    if (typed.trim() === "" && !ready) return false;

    return send(sending);
  };

  // Note that a reply goes again after whatever is on its way, as it was, under the key it went under; one a relaunch took the pictures from never goes without them.
  const retryUndelivered = (key: string) => {
    const line = undeliveredLine(key);

    if (line === undefined || filesLost(line)) return;

    if (line.startsThread === true) {
      startUnder(line.text, line.attachments, key);

      return;
    }

    if (threads.read().get(itemId)?.sending.has(key) === true) return;
    sendReply(line, key, line.at);
  };

  // Note that the words taken back and sent again as they were go under the key they went under, so one that landed unheard is taken once; a thread's start goes back as one, the box turned to start a thread.
  const editUndelivered = (key: string) => {
    const line = undeliveredLine(key);

    if (line === undefined) return;
    dropUndelivered(key);
    const went = undeliveredDraft(thread, line);
    hold(itemId, (was) => ({
      ...was,
      draft: undeliveredTakenBack(was.draft, went),
      note: undefined,
      ...(line.startsThread === true
        ? { asNew: true, started: { key, words: line.text, attachments: line.attachments } }
        : { edited: { key, words: sentWords(line) } }),
    }));
  };

  // A notification's action held for this thread, taken once and sent as though pressed here.
  const pressed = store.get(itemId)?.pressed;
  useEffect(() => {
    if (pressed === undefined) return;
    hold(itemId, ({ pressed: _taken, ...was }) => was);
    const sending = pressedDraft(thread, pressed);

    if (sending !== undefined) send(sending);
  }, [pressed]);

  return {
    draft,
    onDraft,
    note,
    // Note that a number whose words read as none lights Send too, so its press says why the answer is held back rather than standing dimmed with no word.
    answerReady:
      unreadableNumber(thread, draft) !== undefined || inboxThreadSend(thread, draft) !== undefined,
    send,
    resolve,
    nods: nodsOn(draft),
    acknowledge,
    asNew,
    setAsNew,
    sendTyped,
    retryUndelivered,
    editUndelivered,
    deleteUndelivered: dropUndelivered,
  };
}
