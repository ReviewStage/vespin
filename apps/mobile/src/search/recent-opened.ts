/**
 * recent-opened.ts -- the tasks, Inbox threads, and agents the member last opened on this phone, which Search lists before anything is typed, kept in the app's `NSUserDefaults` for the next launch and forgotten on sign-out.
 *
 * Each thread, task, and agent screen notes itself as it comes in front
 * (`useNoteOpened`), as it advertises its Handoff activity. Only what it is
 * and its id are kept (`@repo/features/search-recent-model`), never a word it
 * says, so Search draws each from the lists the app holds. The list is held
 * here, read from the defaults once at launch, as `chosen-workspace.ts`
 * holds the workspace chosen, since only this module writes it.
 */

import {
  type RecentOpened,
  recentKeptSchema,
  withOpened,
} from "@repo/features/search-recent-model";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { Option, Schema } from "effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Settings } from "react-native";

/** The defaults key the list is kept under. */
const RECENT_KEY = "searchRecent";

/** The list kept at launch, none where the defaults hold nothing readable, such as a build that kept another shape. */
const decodeKept = Schema.decodeUnknownOption(recentKeptSchema);

/** The list as the phone holds it now, newest first. */
const recent = heldValue(
  Option.getOrElse(decodeKept(Settings.get(RECENT_KEY)), (): readonly RecentOpened[] => []),
);

/** Keeps `next` for this launch and the next, and tells every screen reading it. */
function keep(next: readonly RecentOpened[]): void {
  Settings.set({ [RECENT_KEY]: next });
  recent.set(next);
}

/** Forgets every opening, as Search's Clear and a sign-out do. */
export function forgetRecentOpened(): void {
  if (recent.read().length === 0) return;

  keep([]);
}

/** What the member last opened on this phone, newest first, across every workspace. */
export function useRecentOpened(): readonly RecentOpened[] {
  return useHeldValue(recent);
}

/**
 * Notes `opened` at the top of the list each time its screen comes in front,
 * a split view's detail coming back from a page pushed over it among them;
 * nothing while the screen has not yet read what it shows.
 */
export function useNoteOpened(opened: RecentOpened | undefined): void {
  const kind = opened?.kind;
  const id = opened?.id;
  const workspaceId = opened?.workspaceId;

  useFocusEffect(
    useCallback(() => {
      if (kind === undefined || id === undefined || workspaceId === undefined) return;

      keep(withOpened(recent.read(), { kind, id, workspaceId }));
    }, [kind, id, workspaceId]),
  );
}

/** Forgets the list when the account signs out, so the next account's Search starts with none. */
export function useRecentOpenedSignOut(signedIn: boolean): void {
  const wasSignedIn = useRef(signedIn);

  useEffect(() => {
    if (wasSignedIn.current && !signedIn) forgetRecentOpened();

    wasSignedIn.current = signedIn;
  }, [signedIn]);
}
