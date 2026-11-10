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
} from "@repo/features/inbox-draft";
import { awaitsNod, type InboxListed, knownAsk } from "@repo/features/inbox-list-model";
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
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { NotificationFeedbackType, notificationAsync } from "expo-haptics";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";

/** What the app holds of one thread: the draft on its box, the sends not yet carried by a read, by key, and what its last refused send said. */
interface ThreadHeld {
  readonly draft: InboxDraft;
  readonly sending: ReadonlyMap<string, InboxSending>;
  readonly note: string | undefined;
}

/** A thread the app holds nothing of. */
const NOTHING_HELD: ThreadHeld = { draft: EMPTY_INBOX_DRAFT, sending: new Map(), note: undefined };

/** What a refused reply says, by why it was refused, in the panel's words. */
function refusedWords(failure: AgentCallFailure): string {
  if (failure === AGENT_CALL_FAILURE.NOT_FOUND) return "This agent no longer exists.";
  if (failure === AGENT_CALL_FAILURE.UNANSWERED) return "No answer came back. Try again.";
  return "The message could not be sent. Try again.";
}

/** What a resolve the service did not take says, by what had become of the item, in the panel's words. */
const NOT_RESOLVED = {
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
      field.type === INBOX_FIELD.NUMBER && typeof fieldValueOf(draft, field.label) === "string",
  )?.label;
}

/** What the box says of a number field whose words read as no number. */
function unreadableWords(label: string): string {
  return `Write a number in ${label}.`;
}

/** A send the act port answered with a refusal, carrying the words it says. */
class SendRefused extends Error {}

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

/** Buzzes the phone as the system does for an outcome: a send taken, a send refused, or one that lacks something. */
function buzz(type: NotificationFeedbackType): void {
  notificationAsync(type).catch((error: unknown) => console.error("The buzz did not go.", error));
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
  /** Whether Send stands lit with no words typed: the draft holds an answer to send. */
  readonly answerReady: boolean;
  /** Sends what the draft holds, or the draft given, such as one Mark done was just pressed on; or says what it lacks. */
  readonly send: (pressed?: InboxDraft) => void;
  /** Resolves the thread without an answer. */
  readonly resolve: () => void;
}

/** The box of the thread `listed` stands for: its draft, and its Send and Resolve. */
export function useThreadAnswer(listed: InboxListed): ThreadAnswer {
  const acts = useHostActs();
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
    buzz(NotificationFeedbackType.Error);
  };
  const send = (pressed?: InboxDraft) => {
    const sending = pressed ?? draft;
    const unreadable = unreadableNumber(thread, sending);
    if (unreadable !== undefined) {
      hold(itemId, (was) => ({ ...was, note: unreadableWords(unreadable) }));
      buzz(NotificationFeedbackType.Warning);
      return;
    }
    const sent = inboxThreadSend(thread, sending);
    if (sent === undefined) {
      const missing = inboxMissing(thread, sending);
      hold(itemId, (was) => ({
        ...was,
        note: missing === undefined ? undefined : missingWords(missing),
      }));
      buzz(NotificationFeedbackType.Warning);
      return;
    }
    const key = randomUUID();
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
    acts[ACT_KIND.AGENTS_INBOX_MESSAGE]({
      itemId,
      text: sent.text,
      ...(sent.attachments.length === 0 ? undefined : { attachments: [...sent.attachments] }),
      ...(sent.answers === undefined ? undefined : { answers: sent.answers }),
      ...(revision === undefined ? undefined : { revision }),
      clientKey: key,
    })
      .then((answer) => {
        if ("failure" in answer) throw new SendRefused(refusedWords(answer.failure));
        buzz(NotificationFeedbackType.Success);
      })
      .catch((error: unknown) => {
        if (!(error instanceof SendRefused)) console.error("The reply did not go.", error);
        refuse(
          key,
          sending,
          error instanceof SendRefused
            ? error.message
            : refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        );
      });
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
    acts[ACT_KIND.AGENTS_INBOX_CLOSE]({ itemId, revision: item.revision, clientKey: key })
      .then((answer) => {
        if ("failure" in answer) throw new SendRefused(refusedWords(answer.failure));
        if (!answer.taken) throw new SendRefused(NOT_RESOLVED[answer.item.status]);
        buzz(NotificationFeedbackType.Success);
      })
      .catch((error: unknown) => {
        if (!(error instanceof SendRefused)) console.error("The resolve did not go.", error);
        refuse(
          key,
          draft,
          error instanceof SendRefused
            ? error.message
            : refusedWords(AGENT_CALL_FAILURE.UNANSWERED),
        );
      });
  };
  return {
    draft,
    onDraft,
    note,
    answerReady:
      unreadableNumber(thread, draft) === undefined && inboxThreadSend(thread, draft) !== undefined,
    send,
    resolve,
  };
}
