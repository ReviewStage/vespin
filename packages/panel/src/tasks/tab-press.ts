/**
 * tab-press.ts -- the panel's one door for a press that opens something in a tab: a link, a chip, or a row, on any page that draws a column with a side panel beside it.
 *
 * The task page, an agent's page, and the Inbox each open what a press
 * names through here rather than picking a side panel or column door of
 * their own, so a press opens alike wherever it lands, by three rules:
 *
 * - It opens a tab of its own, or chooses the one already open on what it
 *   names (`SidePanelControl.onOpen`, `onOpenFile`), as a link pressed does.
 * - It hands the keys to the column it opened in (`ColumnKeys`), so ⌘W
 *   closes the tab it just opened, and ⌘T and ⌘F answer there.
 * - It is a step of the history, which Back undoes: a side panel's tab as
 *   a door naming it opens it (`SidePanelControl.opened`), and a column's
 *   by the press that chose it (`places/window-history.ts`).
 *
 * A page hands the keys to its own column focus as it opens (`useColumnFocus`);
 * a door that opens a tab on another task or page, a link, a pin, or ⌃Tab's
 * card, asks them of whichever page stands once it is drawn
 * (`useColumnKeys`).
 */

import type { PagePlace } from "@repo/features/page-wire";
import type { CodeRef } from "@repo/features/task-wire";
import { useCallback, useRef, useState } from "react";
import type { MainTab, MainTabsControl } from "./use-main-tabs.js";
import type { FileReads, SidePanelControl, SidePanelTab } from "./use-side-panel.js";

/** Which of a page's two columns holds the window's focus, which ⌘T, ⌘W, and ⌘F answer to: its own, or the side panel beside it. */
export const COLUMN = {
  MAIN: "main",
  SIDE: "side",
} as const;

export type Column = (typeof COLUMN)[keyof typeof COLUMN];

/** A door's ask that the keys go to a column, each ask its own, so the same column asked twice is taken twice; it stands until the page standing takes it. */
export interface ColumnKeys {
  readonly column: Column;
  readonly ask: number;
}

/** What a press opens a tab on: a tab of the side panel, a file in one, or a tab of the task's column. */
export const TAB_PRESS = {
  PANEL: "panel",
  FILE: "file",
  COLUMN: "column",
} as const;

/** What a press opens, as `TAB_PRESS` names it; a page a tab of another place shows reads on that `place`. */
export type TabPressed =
  | {
      readonly kind: typeof TAB_PRESS.PANEL;
      readonly tab: SidePanelTab;
      readonly place?: PagePlace | undefined;
    }
  | {
      readonly kind: typeof TAB_PRESS.FILE;
      readonly ref: CodeRef;
      readonly commit?: string | undefined;
      readonly reads?: FileReads | undefined;
    }
  | { readonly kind: typeof TAB_PRESS.COLUMN; readonly tab: MainTab };

/** What a press opens through: the open task's side panel and column, and where the keys are handed, the page's own column focus or the window's ask for it. */
export interface TabPressDoors {
  readonly sidePanel: Pick<
    SidePanelControl,
    "fullScreen" | "onToggleFullScreen" | "onOpen" | "onOpenFile"
  >;
  readonly mainTabs: Pick<MainTabsControl, "onChoose">;
  readonly onKeys: (column: Column) => void;
}

/**
 * Opens what a press names, by the rules above: the window's one door for
 * a press that opens a tab. Note that a column's tab opened here first has
 * a side panel filling the window over the column give way, since it would
 * open out of sight.
 */
export function pressTab(doors: TabPressDoors, pressed: TabPressed): void {
  const { sidePanel, onKeys } = doors;

  switch (pressed.kind) {
    case TAB_PRESS.PANEL:
      sidePanel.onOpen(pressed.tab, pressed.place);
      onKeys(COLUMN.SIDE);

      return;
    case TAB_PRESS.FILE:
      sidePanel.onOpenFile(pressed.ref, pressed.commit, pressed.reads);
      onKeys(COLUMN.SIDE);

      return;
    case TAB_PRESS.COLUMN:
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      doors.mainTabs.onChoose(pressed.tab);
      onKeys(COLUMN.MAIN);

      return;
  }
}

/** The window's ask for the keys, which a door opening a tab on another task or page makes. */
export interface ColumnKeysAsk {
  /** The column the last such door asked the keys of, until the page standing takes them. */
  readonly keys: ColumnKeys | undefined;
  /** Asks the keys for the column given. */
  readonly onKeys: (column: Column) => void;
  /** Says the page standing took the ask; only the ask taken is let go, a newer one standing until it is taken. */
  readonly onKeysTaken: (ask: number) => void;
}

/**
 * The keys asked of whichever page stands, for a door that opens a tab
 * where no page's own column focus is at hand: a link, a pin, or ⌃Tab's
 * card, which may open a page that is not drawn yet (`useColumnFocus`).
 */
export function useColumnKeys(): ColumnKeysAsk {
  const [keys, setKeys] = useState<ColumnKeys | undefined>(undefined);
  const asks = useRef(0);

  const onKeys = useCallback((column: Column) => {
    asks.current += 1;
    setKeys({ column, ask: asks.current });
  }, []);

  const onKeysTaken = useCallback(
    (ask: number) => setKeys((last) => (last?.ask === ask ? undefined : last)),
    [],
  );

  return { keys, onKeys, onKeysTaken };
}
