/**
 * search-recent.ts -- what a phone's Search page lists under Recent before anything is typed: the tasks and Inbox threads last opened in this window, newest first, as the iOS app's Search tab keeps them.
 *
 * The window keeps the list itself, as ids alone (`search-recent-model.ts`),
 * so nothing a row says is kept beside it: each row is drawn from the lists
 * the palette already reads, and an id they no longer hold draws nothing.
 * A task or a thread is kept as the window opens it, by whatever door, so a
 * task opened from the Tasks page stands in Recent as one picked from
 * Search does, and again each time its page comes back on screen. Clear forgets them all.
 */

import { SEARCH_FOUND_KIND, type SearchFoundKind } from "@repo/features/search-found-model";
import {
  type RecentOpened,
  recentKeptSchema,
  withOpened,
} from "@repo/features/search-recent-model";
import { Schema } from "effect";
import { useEffect } from "react";
import { ROUTED_PLACE, useWindowPlace } from "../places/routed-places.js";
import { keptKey, useKept } from "../use-kept.js";

/** Where the window keeps what it opened last. */
const KEPT_RECENT = keptKey("app.searchRecent", Schema.fromJsonString(recentKeptSchema));

/** Nothing opened yet, as a window that kept nothing reads. */
const NONE_OPENED: readonly RecentOpened[] = [];

/** What the window stands open on now, each none while it stands on none. */
export interface OpenedNow {
  readonly workspaceId: string | undefined;
  readonly taskId: string | undefined;
  readonly itemId: string | undefined;
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

/** What the window opened last, kept as each task and thread opens (`now`). */
export function useSearchRecent(now: OpenedNow): SearchRecent {
  const [kept, keep, change] = useKept(KEPT_RECENT, NONE_OPENED);
  // Note that a task is kept as its page comes on screen, since the Inbox and the Tasks page keep the task they left bound, so a return to it is kept again.
  const taskShown = useWindowPlace().place === ROUTED_PLACE.TASK;
  useKeepOpened(
    SEARCH_FOUND_KIND.TASKS,
    taskShown ? now.taskId : undefined,
    now.workspaceId,
    change,
  );
  useKeepOpened(SEARCH_FOUND_KIND.INBOX, now.itemId, now.workspaceId, change);

  return { kept, onClear: () => keep(NONE_OPENED) };
}
