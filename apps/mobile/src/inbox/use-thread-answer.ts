/**
 * use-thread-answer.ts -- a thread's answer as the app holds and sends it: the draft on its box, kept for the thread whatever screen draws it, and each answer, reply, and resolve drawn at once and taken back where the service refused it.
 *
 * What a draft sends is the panel's own reading (`@repo/features/inbox-draft`'s
 * `inboxThreadSend`), sent on the host's act port as the panel sends it: a
 * reply, carrying the open ask's answer where the draft holds one, as
 * `AGENTS_INBOX_MESSAGE`, and a resolve as `AGENTS_INBOX_CLOSE`. Each send is
 * drawn over the thread the moment it is pressed (`inboxSendingDrawn`), so
 * the list and the thread read it settled at once, and stands until a read
 * carries it; a refused one is let go, its words and picks put back on the
 * box, the refusal said under it, and the phone buzzes as a refusal does.
 * Note that the drafts and the sends are kept in one store beside the
 * screens rather than in a screen's state, so folding or unfolding the
 * iPhone Duo, which draws the thread on another screen, keeps both.
 *
 * A notification's press the phone could not send in the background, a
 * decide's option or a reply typed in place, opens the app on its thread and
 * is held here (`pressFromNotification`) until the thread's box stands,
 * which sends it once as though it were pressed there, so it is drawn,
 * refused, and buzzed as any send is, under the key the notice names where
 * it names one, so an answer the service took after all is taken once. An
 * option whose ask is no longer the thread's open one is let go unsent.
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import { missingWords } from "@repo/features/inbox-ask-words";
import {
  EMPTY_INBOX_DRAFT,
  fieldValueOf,
  type InboxDraft,
  inboxMissing,
  inboxThreadSend,
  withChoice,
} from "@repo/features/inbox-draft";
import { awaitsNod, type InboxListed, knownAsk } from "@repo/features/inbox-list-model";
import { INBOX_PUSH_PRESS, type InboxPushPress } from "@repo/features/inbox-push-wire";
import {
  INBOX_ASK,
  INBOX_FIELD,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  type InboxStatus,
  openAskOf,
} from "@repo/features/inbox-wire";
import {
  INBOX_SENDING,
  type InboxReader,
  type InboxSending,
  inboxSendingDrawn,
} from "@repo/features/inbox-writes";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount } from "@repo/host/app-state-reads";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Predicate } from "effect";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** What the app holds of one thread: the draft on its box, the sends not yet carried by a read, by key, what its last refused send said, and a notification's action not yet sent. */
interface ThreadHeld {
  readonly draft: InboxDraft;
  readonly sending: ReadonlyMap<string, InboxSending>;
  readonly note: string | undefined;
  readonly pressed?: InboxPushPress;
}

/** A thread the app holds nothing of. */
const NOTHING_HELD: ThreadHeld = { draft: EMPTY_INBOX_DRAFT, sending: new Map(), note: undefined };

/** What a refused reply says, by why it was refused, in the panel's words. */
export function refusedWords(failure: AgentCallFailure): string {
  if (failure === AGENT_CALL_FAILURE.NOT_FOUND) return "This agent no longer exists.";

  if (failure === AGENT_CALL_FAILURE.UNANSWERED) return "No answer came back. Try again.";

  return "The message could not be sent. Try again.";
}

/** What a resolve the service did not take says, by what had become of the item, in the panel's words. */
export const NOT_RESOLVED = {
  [INBOX_STATUS.OPEN]: "The agent changed this item before you resolved it.",
  [INBOX_STATUS.ANSWERED]: "This item was already answered.",
  [INBOX_STATUS.CLOSED]: "This item was already resolved.",
} as const satisfies Record<InboxStatus, string>;

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
let held: ReadonlyMap<string, ThreadHeld> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function heldNow(): ReadonlyMap<string, ThreadHeld> {
  return held;
}

/** The store with the thread's holding changed as `change` says. */
function hold(itemId: string, change: (was: ThreadHeld) => ThreadHeld): void {
  held = new Map(held).set(itemId, change(held.get(itemId) ?? NOTHING_HELD));

  for (const listener of listeners) listener();
}

/**
 * The store with each close a read carries let go: one on a thread the read
 * holds settled. Note that a close the host took may only be queued, and the
 * host draws it over its own reads until it goes, and takes it back where
 * its retry is refused, so the thread reads open again rather than stand
 * closed by a send the app no longer has out.
 */
function letGoCarriedCloses(items: readonly InboxItem[]): void {
  const carried = items.filter(
    (item) =>
      item.status !== INBOX_STATUS.OPEN &&
      [...(held.get(item.id)?.sending.values() ?? [])].some(
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
 * The reader's sends drawn over the threads they were sent on, so the list,
 * the badge, and the thread read each settled the moment it is pressed; a
 * thread with nothing out stands as the read holds it.
 */
export function useSendsDrawn<Group extends { readonly items: readonly InboxItem[] }>(
  groups: readonly Group[],
): readonly Group[] {
  const store = useSyncExternalStore(subscribe, heldNow);
  const reader = useReader();
  useEffect(() => letGoCarriedCloses(groups.flatMap((group) => group.items)), [groups]);

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

/* ----- The thread's box ----- */

/** A thread's box as its screen draws and presses it. */
export interface ThreadAnswer {
  readonly draft: InboxDraft;
  readonly onDraft: (draft: InboxDraft) => void;
  /** What the box's last send said where it did not go: what the answer lacks, or the refusal. */
  readonly note: string | undefined;
  /** Whether Send stands lit with no words typed: the draft holds an answer to send, or a number whose words a press says read as none. */
  readonly answerReady: boolean;
  /** Sends what the draft holds, or the draft given, such as one Mark done was just pressed on; or says what it lacks. */
  readonly send: (pressed?: InboxDraft) => void;
  /** Resolves the thread without an answer. */
  readonly resolve: () => void;
}

/** The box of the thread `listed` stands for: its draft, and its Send and Resolve. */
export function useThreadAnswer(listed: InboxListed): ThreadAnswer {
  const acts = useHostActs();
  const write = useWrite();
  const { item } = listed;
  const itemId = item.id;
  const store = useSyncExternalStore(subscribe, heldNow);
  const { draft, note } = store.get(itemId) ?? NOTHING_HELD;
  const thread = item.thread ?? [];

  const onDraft = useCallback(
    (next: InboxDraft) => hold(itemId, (was) => ({ ...was, draft: next, note: undefined })),
    [itemId],
  );

  // A send let go once refused: its words and picks back on the box, ahead of nothing typed since, and the refusal said.
  const refuse = (key: string, sent: InboxDraft, words: string) => {
    hold(itemId, (was) => {
      const sending = new Map(was.sending);
      sending.delete(key);
      const typed = was.draft.note.trim() === "" ? sent : was.draft;

      return { draft: typed, sending, note: words };
    });
  };

  const sendUnder = (sending: InboxDraft, key: string) => {
    const unreadable = unreadableNumber(thread, sending);

    if (unreadable !== undefined) {
      hold(itemId, (was) => ({ ...was, note: unreadableWords(unreadable) }));
      buzz(BUZZ.WARNING);

      return;
    }

    const sent = inboxThreadSend(thread, sending);

    if (sent === undefined) {
      const missing = inboxMissing(thread, sending);
      hold(itemId, (was) => ({
        ...was,
        note: missing === undefined ? undefined : missingWords(missing),
      }));
      buzz(BUZZ.WARNING);

      return;
    }

    const revision = awaitsNod(item) ? item.revision : undefined;
    hold(itemId, (was) => ({
      draft: EMPTY_INBOX_DRAFT,
      note: undefined,
      sending: new Map(was.sending).set(key, {
        kind: INBOX_SENDING.REPLY,
        key,
        text: sent.text,
        answers: sent.answers,
        at: Date.now(),
      }),
    }));
    // A send refused says why on the box, where its words go back, rather than in the notice.
    write(
      () =>
        acts[ACT_KIND.AGENTS_INBOX_MESSAGE]({
          itemId,
          text: sent.text,
          ...(sent.attachments.length === 0 ? undefined : { attachments: [...sent.attachments] }),
          ...(sent.answers === undefined ? undefined : { answers: sent.answers }),
          ...(revision === undefined ? undefined : { revision }),
          clientKey: key,
        }),
      {
        refused: (answer) => ("failure" in answer ? refusedWords(answer.failure) : undefined),
        unanswered: refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        inPlace: (words) => refuse(key, sending, words),
        went: BUZZ.SUCCESS,
      },
    );
  };

  const send = (pressed?: InboxDraft) => sendUnder(pressed ?? draft, randomUUID());

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
      },
    );
  };

  // A notification's action held for this thread, taken once and sent as though pressed here.
  const pressed = store.get(itemId)?.pressed;
  useEffect(() => {
    if (pressed === undefined) return;
    hold(itemId, ({ pressed: _taken, ...was }) => was);
    const sending = pressedDraft(thread, pressed);

    if (sending !== undefined) sendUnder(sending, pressed.clientKey ?? randomUUID());
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
  };
}
