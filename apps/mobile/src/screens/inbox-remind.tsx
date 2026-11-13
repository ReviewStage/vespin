// inbox-remind.tsx -- Remind me on an Inbox thread, or on several chosen at once: the sheet a row's swipe, its long press, the thread's ⋯ menu, or the Inbox's Select mode opens, offering the panel's times.

import { hasReminder } from "@repo/features/inbox-list-model";
import {
  REMIND_TIMES,
  REMIND_WORDS,
  remindPickOpensAt,
  remindWords,
} from "@repo/features/inbox-remind-times";
import type { InboxItem } from "@repo/features/inbox-wire";
import { GLYPH, RemindSheet } from "@repo/ui-native";
import { type ReactNode, useState } from "react";
import { useInboxActs } from "../inbox/use-inbox.js";

/** What Remind me is called and drawn with, wherever it stands: a row's swipe and long press, and a thread's ⋯ menu. */
export const REMIND_ME = { label: REMIND_WORDS.REMIND_ME, symbol: GLYPH.TIME } as const;

type UseRemindSheetResult = {
  readonly open: (item: InboxItem) => void;
  /** Opens the sheet on several threads, whose every reminder a choice sets, calling `after` once a choice is sent. */
  readonly openMany: (items: readonly InboxItem[], after?: () => void) => void;
  readonly sheet: ReactNode;
};

/** The threads the sheet stands open on, when it opened, and what runs once a choice is sent. */
type Held = {
  readonly items: readonly InboxItem[];
  readonly at: number;
  readonly after?: (() => void) | undefined;
};

/**
 * The Remind me sheet a screen draws beside its rows, and the opening of it
 * on a thread, or on several chosen at once: the panel's times
 * (`@repo/features/inbox-remind-times`), each saying when it comes due from
 * the moment the sheet opens and set from the moment it is pressed, a day
 * and time of the reader's own, and Clear reminder where a thread holds one,
 * as the panel's Remind me submenu offers them. Each choice sends the
 * panel's act, on every thread it stands open on, and closes the sheet.
 */
export function useRemindSheet(): UseRemindSheetResult {
  const { remind, remindMany } = useInboxActs();
  const [held, setHeld] = useState<Held>();
  const close = () => setHeld(undefined);

  const set = (until: number | null) => {
    if (held !== undefined) {
      const [only] = held.items;

      if (held.items.length === 1 && only !== undefined) remind(only.id, until);
      else
        remindMany(
          held.items.map((item) => item.id),
          until,
        );
      held.after?.();
    }

    close();
  };

  const openedAt = held?.at ?? Date.now();

  const sheet = (
    <RemindSheet
      presented={held !== undefined}
      times={REMIND_TIMES.map((time) => ({
        label: time.label,
        detail: remindWords(time.at(openedAt), openedAt),
        onPress: () => set(time.at(Date.now())),
      }))}
      pick={{ opensAt: remindPickOpensAt(openedAt), earliest: openedAt }}
      onPick={set}
      onClear={held?.items.some(hasReminder) === true ? () => set(null) : undefined}
      onDismiss={close}
    />
  );

  return {
    open: (item) => setHeld({ items: [item], at: Date.now() }),
    openMany: (items, after) => {
      if (items.length > 0) setHeld({ items, at: Date.now(), after });
    },
    sheet,
  };
}
