/**
 * search-recent.ts -- what a phone's Search page lists under Recent before anything is typed: the tasks, Inbox threads, and agents last opened in this window, newest first, as the iOS app's Search tab keeps them.
 *
 * The window keeps the list itself, as ids alone (`search-recent-model.ts`),
 * so nothing a row says is kept beside it: each row is drawn from the lists
 * the palette already reads, and an id they no longer hold draws nothing.
 * A task, a thread, or an agent is kept as the window opens it, by whatever
 * door, so a task opened from the Tasks page stands in Recent as one picked
 * from Search does, and again each time its page comes back on screen, and an
 * agent as its page or its task's tab stands.
 *
 * The list is the account's, as the iOS app's is: the window keeps beside it
 * whose it is, and forgets it when that account signs out, or when another
 * account's comes to read it, a reload's sign-in included. Clear forgets them all.
 */

import { SEARCH_FOUND_KIND, type SearchFoundKind } from "@repo/features/search-found-model";
import {
  type RecentOpened,
  recentKeptSchema,
  withOpened,
} from "@repo/features/search-recent-model";
import { Schema } from "effect";
import { useCallback, useEffect, useRef } from "react";
import { ROUTED_PLACE, useWindowPlace } from "../places/routed-places.js";
import { keptKey, useKept } from "../use-kept.js";

/** Where the window keeps what it opened last. */
const KEPT_RECENT = keptKey("app.searchRecent", Schema.fromJsonString(recentKeptSchema));

/** Whose list the window keeps, by the account's id; none kept before any account read it. */
const KEPT_RECENT_OWNER = keptKey("app.searchRecentOwner", Schema.String);

/** No account kept as the list's. */
const NO_OWNER = "";

/** Nothing opened yet, as a window that kept nothing reads. */
const NONE_OPENED: readonly RecentOpened[] = [];

/** What the window stands open on now, each none while it stands on none. */
export interface OpenedNow {
  /** The account signed in, none before it is read and once it signs out. */
  readonly accountId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly taskId: string | undefined;
  readonly itemId: string | undefined;
  /** The agent shown, on its own page or as its task's tab. */
  readonly agentId: string | undefined;
}

/** What the window opened last, newest first, and the press that forgets it all. */
export interface SearchRecent {
  readonly kept: readonly RecentOpened[];
  readonly onClear: () => void;
}

/** Keeps `id` of `kind` at the top of what was opened, as it opens in `workspaceId`. */
function useKeepOpened(
  kind: SearchFoundKind,
  id: string | undefined,
  workspaceId: string | undefined,
  change: (changed: (kept: readonly RecentOpened[]) => readonly RecentOpened[]) => void,
): void {
  useEffect(() => {
    if (id === undefined || workspaceId === undefined) return;
    change((kept) => withOpened(kept, { kind, id, workspaceId }));
  }, [kind, id, workspaceId, change]);
}

/**
 * Forgets what was opened when the account signs out, or when an account
 * other than the one the list was kept for reads it. Note that an account
 * not yet read forgets nothing, so a launch keeps the list until its account
 * answers.
 */
function useForgetOnAccountChange(accountId: string | undefined, forget: () => void): void {
  const [owner, keepOwner] = useKept(KEPT_RECENT_OWNER, NO_OWNER);
  const signedIn = useRef(accountId);

  useEffect(() => {
    const was = signedIn.current;
    signedIn.current = accountId;

    if (accountId === undefined) {
      if (was === undefined) return;
      forget();
      keepOwner(NO_OWNER);

      return;
    }

    if (owner === accountId) return;

    if (owner !== NO_OWNER) forget();
    keepOwner(accountId);
  }, [accountId, owner, forget, keepOwner]);
}

/** What the window opened last, kept as each task, thread, and agent opens (`now`), and forgotten as its account leaves. */
export function useSearchRecent(now: OpenedNow): SearchRecent {
  const [kept, keep, change] = useKept(KEPT_RECENT, NONE_OPENED);
  const forget = useCallback(() => keep(NONE_OPENED), [keep]);
  // Note that the account is settled before what is open now is kept, so an account's first opening is kept under it.
  useForgetOnAccountChange(now.accountId, forget);
  // Note that a task is kept as its page comes on screen, since the Inbox and the Tasks page keep the task they left bound, so a return to it is kept again.
  const taskShown = useWindowPlace().place === ROUTED_PLACE.TASK;
  useKeepOpened(
    SEARCH_FOUND_KIND.TASKS,
    taskShown ? now.taskId : undefined,
    now.workspaceId,
    change,
  );
  useKeepOpened(SEARCH_FOUND_KIND.INBOX, now.itemId, now.workspaceId, change);
  useKeepOpened(SEARCH_FOUND_KIND.AGENTS, now.agentId, now.workspaceId, change);

  return { kept, onClear: forget };
}
