/**
 * cloud-browser-notes.ts -- the notes a member picked in a cloud Browser tab and has not sent, held per account and tab in the window's memory alone.
 *
 * Each note holds the member's words and the element picked, its crop among
 * it, so the notes are kept nowhere but this window: never in storage, as a
 * composer's attached files are not, and gone with a reload. They are the
 * account's that picked them, so a window another account signs in to reads
 * none of them, and a tab's notes outlast its pane being hidden and shown
 * again. Sending them, or Clear, lets them go.
 */

import type { BrowserLivePickedElement } from "@repo/features/browser-live-wire";
import { createStore, useSelector } from "@tanstack/react-store";
import { useCallback } from "react";

/** One note waiting to be sent. */
export interface HeldBrowserNote {
  readonly id: string;
  readonly words: string;
  readonly element: BrowserLivePickedElement;
  /** How many times the page had moved under the member when the note was picked, which its pin stands only while it still matches (`cloud-browser-pane.tsx`). */
  readonly moves: number;
}

type HeldNotes = ReadonlyMap<string | undefined, ReadonlyMap<string, readonly HeldBrowserNote[]>>;

const held = createStore<HeldNotes>(new Map());

const NONE: readonly HeldBrowserNote[] = [];

/** The last move counted, across every pane, so no two moves anywhere share a count. */
let lastMove = 0;

/** A count no move before it took: the page moved under the member, or the pane drew it at another size. */
export function nextPageMove(): number {
  lastMove += 1;

  return lastMove;
}

/** The notes the account holds on a tab, and a setter that replaces them. */
export function useCloudBrowserNotes(
  account: string | undefined,
  tabId: string,
): readonly [readonly HeldBrowserNote[], (notes: readonly HeldBrowserNote[]) => void] {
  const notes = useSelector(held, (all) => all.get(account)?.get(tabId) ?? NONE);

  const set = useCallback(
    (next: readonly HeldBrowserNote[]) =>
      held.setState((all) => {
        const tabs = new Map(all.get(account));

        if (next.length === 0) tabs.delete(tabId);
        else tabs.set(tabId, next);

        return new Map(all).set(account, tabs);
      }),
    [account, tabId],
  );

  return [notes, set];
}
