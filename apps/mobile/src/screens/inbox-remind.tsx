// inbox-remind.tsx -- Remind me on an Inbox thread: the sheet a row's swipe, its long press, or the thread's ⋯ menu opens, offering the panel's times.

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
  readonly sheet: ReactNode;
};

/**
 * The Remind me sheet a screen draws beside its rows, and the opening of it
 * on a thread: the panel's times (`@repo/features/inbox-remind-times`),
 * each saying when it comes due from the moment the sheet opens and set from
 * the moment it is pressed, a day and time of the reader's own, and Clear
 * reminder on a thread that holds one, as the panel's Remind me submenu
 * offers them. Each choice sends the panel's act and closes the sheet.
 */
export function useRemindSheet(): UseRemindSheetResult {
  const { remind } = useInboxActs();
  const [held, setHeld] = useState<{ readonly item: InboxItem; readonly at: number }>();
  const close = () => setHeld(undefined);

  const set = (until: number | null) => {
    if (held !== undefined) remind(held.item.id, until);
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
      onClear={held !== undefined && hasReminder(held.item) ? () => set(null) : undefined}
      onDismiss={close}
    />
  );

  return { open: (item) => setHeld({ item, at: Date.now() }), sheet };
}
