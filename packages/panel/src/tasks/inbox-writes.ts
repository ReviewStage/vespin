/**
 * inbox-writes.ts -- an Inbox item's reminder and read mark as the undo stack takes them back and puts them back: each a row write over the items the window holds, pressed once for every item one press writes.
 *
 * A reminder set or cleared, and a read or unread mark, each set one field
 * of an item, which the host draws over every read holding it the moment it
 * is asked (`@repo/host`'s `inbox-collections.ts`), so ⌘Z and a toast's
 * Undo send each item the field back as it stood (`undo-stack.ts`'s
 * `pressRows`), while that item still holds what the press set: an item
 * marked again, or reminded again, since, here, on another Mac, or by an
 * agent's post, is left as it stands. A press over several items is one
 * entry, and one toast says it; a refused undo says so in the words the
 * press's own refusal does.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { isUnread } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { KEPT, type Kept, notKept } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { type PressedRows, pressRows, type RowWrite } from "../undo-stack.js";
import { appStateIn } from "../use-app-state.js";

/** What one toast says of read marks given to several items: how many the service took, and how many not. */
export function markedNote(unread: boolean, landed: number, refused: number): string {
  const state = unread ? "unread" : "read";
  if (landed === 0) return `Could not mark ${countWords(refused, TERM.INBOX_ITEM)} ${state}`;
  const kept = `${countWords(landed, TERM.INBOX_ITEM)} marked ${state}`;
  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

/** What a toast says of a reminder set, or canceled, that the service did not take. */
export const REMIND_REFUSED = {
  SET: "Could not set the reminder",
  CANCEL: "Could not cancel the reminder",
} as const;

/** Where an inbox write's items are read: the window's document, holding the account's feed and each holder's own inbox, every write still standing drawn over them. */
type InboxRows = AppStateSnapshot | undefined;

/** An item's read mark as an entry reads and sends it. */
interface MarkFields {
  readonly unread: boolean;
}

/** An item's reminder as an entry reads and sends it: when it comes due, null where it holds none. */
interface RemindFields {
  readonly remindAt: number | null;
}

/** `itemId`'s item as the window holds it: in the account's feed, else in a holder's own inbox; none where it holds no such item. */
function inboxItemIn(rows: InboxRows, itemId: string): InboxItem | undefined {
  const fed = rows?.[LIVE_READ.INBOX_ITEMS].rows;
  const held = rows?.[LIVE_READ.HOLDER_INBOX];
  const lists = [
    ...Object.values(fed?.[INBOX_SCOPE_KIND.PLAN] ?? {}),
    ...Object.values(INBOX_SCOPE_KIND).flatMap((kind) =>
      Object.values(held?.[kind] ?? {}).map((read) => read.rows ?? []),
    ),
  ];
  for (const items of lists) {
    const item = items.find((each) => each.id === itemId);
    if (item !== undefined) return item;
  }
  return undefined;
}

/** An inbox act's answer as whether it was kept, with what refused it where it was not. */
function inboxKept(asked: Promise<object>): Promise<Kept> {
  return asked.then((answer) => ("failure" in answer ? notKept(answer) : KEPT), notKept);
}

/** The inbox's row writes: an item's read mark, and its reminder, each read off the items the window holds. */
const INBOX_WRITE = {
  MARK: {
    read: (rows, itemId) => {
      const item = inboxItemIn(rows, itemId);
      return item === undefined ? undefined : { unread: isUnread(item) };
    },
    holds: (now, wanted) => now.unread === wanted.unread,
    kind: ACT_KIND.AGENTS_INBOX_READ_STATE,
    send: (send, itemId, { unread }) => inboxKept(send({ itemId, unread })),
    unmasked: true,
    surface: FAILURE_SURFACE.INBOX_MARK,
    refused: (_itemId, { unread }, kept, refused) => ({ words: markedNote(unread, kept, refused) }),
  } satisfies RowWrite<InboxRows, MarkFields, typeof ACT_KIND.AGENTS_INBOX_READ_STATE>,
  REMIND: {
    read: (rows, itemId) => {
      const item = inboxItemIn(rows, itemId);
      return item === undefined ? undefined : { remindAt: item.remindAt ?? null };
    },
    holds: (now, wanted) => now.remindAt === wanted.remindAt,
    kind: ACT_KIND.AGENTS_INBOX_REMIND,
    send: (send, itemId, { remindAt }) => inboxKept(send({ itemId, until: remindAt })),
    unmasked: true,
    surface: FAILURE_SURFACE.INBOX_MARK,
    // Note that several items refused say it once, each refusal's words being the same.
    refused: (itemId, { remindAt }) => ({
      words: remindAt === null ? REMIND_REFUSED.CANCEL : REMIND_REFUSED.SET,
      about: { inboxItemId: itemId },
    }),
  } satisfies RowWrite<InboxRows, RemindFields, typeof ACT_KIND.AGENTS_INBOX_REMIND>,
} as const;

/** Presses of the inbox's writes: each reads its items as the window holds them, before the act is sent, for an entry its caller keeps once the service answers. */
export interface InboxPresses {
  /** The items' reminders, set for `until` or cleared where it is null. */
  readonly remind: (items: readonly InboxItem[], until: number | null) => PressedRows;
  /** The items' read marks, read or unread as `unread` says. */
  readonly mark: (items: readonly InboxItem[], unread: boolean) => PressedRows;
}

/** The inbox's presses, their items read off the window's document and their inverses sent on its own mutations. */
export function useInboxPresses(): InboxPresses {
  const client = useQueryClient();
  const { mutateAsync: sendMark } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_READ_STATE));
  const { mutateAsync: sendRemind } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_REMIND));
  const rows = useCallback(() => appStateIn(client), [client]);
  return useMemo(
    () => ({
      remind: (items, until) =>
        pressRows(
          INBOX_WRITE.REMIND,
          { rows, send: sendRemind },
          items.map((item) => ({ id: item.id, after: { remindAt: until } })),
        ),
      mark: (items, unread) =>
        pressRows(
          INBOX_WRITE.MARK,
          { rows, send: sendMark },
          items.map((item) => ({ id: item.id, after: { unread } })),
        ),
    }),
    [rows, sendMark, sendRemind],
  );
}
