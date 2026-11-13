// inbox-remind.tsx -- Remind me on an Inbox thread, or on several chosen at once: the menu a row's swipe, its long press, the thread's ⋯ menu, or the Inbox's Select mode opens, offering the panel's times, and the sheet its "Pick a date and time…" opens.

import { hasReminder } from "@repo/features/inbox-list-model";
import {
  REMIND_TIMES,
  REMIND_WORDS,
  remindPickOpensAt,
  remindWords,
} from "@repo/features/inbox-remind-times";
import type { InboxItem } from "@repo/features/inbox-wire";
import {
  type BarMenu,
  GLYPH,
  RemindPickSheet,
  ROW_ACTION_TONE,
  type RowAction,
  type RowSubmenu,
} from "@repo/ui-native";
import { type ReactNode, useState } from "react";
import { useInboxActs } from "../inbox/use-inbox.js";

/** What Remind me is called and drawn with, wherever it stands: a row's swipe and long press, a thread's ⋯ menu, and Select mode's bar. */
const REMIND_ME = { label: REMIND_WORDS.REMIND_ME, symbol: GLYPH.TIME } as const;

/** Remind me as one menu every place draws: a row's swipe and long press take it as a submenu, a bar as its menu. */
type RemindMenu = RowSubmenu & BarMenu & { readonly actions: readonly RowAction[] };

type UseRemindResult = {
  /** Remind me's menu on the threads given, calling `after` once a time is sent, such as Select mode letting go. */
  readonly menu: (items: readonly InboxItem[], after?: () => void) => RemindMenu;
  /** The picker sheet "Pick a date and time…" opens, which a screen draws beside its rows. */
  readonly sheet: ReactNode;
};

/** The threads the picker stands open on, when it opened, and what runs once a time is sent. */
type Held = {
  readonly items: readonly InboxItem[];
  readonly at: number;
  readonly after?: (() => void) | undefined;
};

/**
 * Remind me as Mail's Remind Me: a menu of the panel's times
 * (`@repo/features/inbox-remind-times`), each saying under its words when it
 * comes due and set from the moment it is pressed, then "Pick a date and
 * time…", which alone opens a sheet, the system's calendar and clock with
 * Cancel and Done, and at its foot Clear reminder where a thread holds one,
 * as the panel's Remind me submenu offers them. A time is set the moment its
 * menu item is pressed, with nothing drawn between the press and the act.
 * Each sends the panel's act on every thread the menu stands on.
 */
export function useRemind(): UseRemindResult {
  const { remind, remindMany } = useInboxActs();
  const [held, setHeld] = useState<Held>();

  const send = (items: readonly InboxItem[], until: number | null, after?: () => void) => {
    const [only] = items;

    if (items.length === 1 && only !== undefined) remind(only.id, until);
    else
      remindMany(
        items.map((item) => item.id),
        until,
      );
    after?.();
  };

  const menu = (items: readonly InboxItem[], after?: () => void): RemindMenu => {
    const now = Date.now();

    const times: RowAction[] = REMIND_TIMES.map((time) => ({
      label: time.label,
      detail: remindWords(time.at(now), now),
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => send(items, time.at(Date.now()), after),
    }));

    const pick: RowAction = {
      label: REMIND_WORDS.PICK,
      symbol: GLYPH.TIME,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => setHeld({ items, at: Date.now(), after }),
    };

    const clear: RowAction[] = items.some(hasReminder)
      ? [
          {
            label: items.length === 1 ? REMIND_WORDS.CLEAR : REMIND_WORDS.CLEAR_ALL,
            symbol: GLYPH.INBOX,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => send(items, null, after),
          },
        ]
      : [];

    return { ...REMIND_ME, choices: [], actions: [...times, pick, ...clear] };
  };

  const openedAt = held?.at ?? Date.now();

  const sheet = (
    <RemindPickSheet
      presented={held !== undefined}
      pick={{ opensAt: remindPickOpensAt(openedAt), earliest: openedAt }}
      onPick={(at) => {
        if (held !== undefined) send(held.items, at, held.after);
        setHeld(undefined);
      }}
      onDismiss={() => setHeld(undefined)}
    />
  );

  return { menu, sheet };
}
