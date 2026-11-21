/**
 * search-recent-model.ts -- what the iOS app's Search tab lists before anything is typed: the tasks, Inbox threads, and agents last opened, newest first, as Apple's own search tabs list their recents.
 *
 * The phone keeps the list itself, as ids alone, so nothing a row says is
 * kept beside it: each row is drawn from the lists the app already holds,
 * and an id they no longer hold, a task deleted or a thread resolved past
 * the Inbox's reach, draws nothing. Opening one again moves it to the top,
 * and the list keeps only the newest few, across every workspace, so a
 * switch back to a workspace finds its own again.
 */

import { Schema } from "effect";
import { SEARCH_FOUND_KIND } from "./search-found-model.js";

/** How many opened tasks, threads, and agents the phone keeps, across every workspace. */
const RECENT_KEPT = 30;

/** How many the Search tab lists, of the chosen workspace's that its lists still hold. */
const RECENT_SHOWN = 10;

/** The words the Search tab's recents stand under, and the act that forgets them, in Apple's own words. */
export const RECENT_WORDS = {
  TITLE: "Recent",
  CLEAR: "Clear",
  CLEAR_HEARD: "Clear recent searches",
} as const;

/** One task, thread, or agent the member opened, as the phone keeps it: what it is, its id, and the workspace it stands in. */
const recentOpenedSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(SEARCH_FOUND_KIND)),
  id: Schema.String,
  workspaceId: Schema.String,
});

export type RecentOpened = typeof recentOpenedSchema.Type;

/** What the phone keeps, newest first, which the app reads back from its defaults through this schema, a build that kept another shape read as none. */
export const recentKeptSchema = Schema.Array(recentOpenedSchema);

/** A kept opening as its row is drawn: the opening, and the row's own value, found in the lists the app holds. */
export type RecentRow<Task, Thread, Agent> =
  | { readonly kind: typeof SEARCH_FOUND_KIND.TASKS; readonly id: string; readonly row: Task }
  | { readonly kind: typeof SEARCH_FOUND_KIND.INBOX; readonly id: string; readonly row: Thread }
  | { readonly kind: typeof SEARCH_FOUND_KIND.AGENTS; readonly id: string; readonly row: Agent };

/** Where each kind's row is found by its id, among the lists the app holds; none where they no longer hold it. */
export interface RecentFinders<Task, Thread, Agent> {
  readonly task: (id: string) => Task | undefined;
  readonly thread: (id: string) => Thread | undefined;
  readonly agent: (id: string) => Agent | undefined;
}

/** Whether two openings name the same task, thread, or agent. */
function sameOpened(one: RecentOpened, other: RecentOpened): boolean {
  return one.kind === other.kind && one.id === other.id;
}

/** One opening's row, found by its kind's finder; none where its list no longer holds it. */
function recentRowOf<Task, Thread, Agent>(
  { kind, id }: RecentOpened,
  find: RecentFinders<Task, Thread, Agent>,
): RecentRow<Task, Thread, Agent> | undefined {
  switch (kind) {
    case SEARCH_FOUND_KIND.TASKS: {
      const row = find.task(id);

      return row === undefined ? undefined : { kind, id, row };
    }

    case SEARCH_FOUND_KIND.INBOX: {
      const row = find.thread(id);

      return row === undefined ? undefined : { kind, id, row };
    }

    case SEARCH_FOUND_KIND.AGENTS: {
      const row = find.agent(id);

      return row === undefined ? undefined : { kind, id, row };
    }
  }
}

/** The kept list with `opened` at its top, any earlier opening of it let go, and cut to the newest the phone keeps. */
export function withOpened(
  kept: readonly RecentOpened[],
  opened: RecentOpened,
): readonly RecentOpened[] {
  return [opened, ...kept.filter((each) => !sameOpened(each, opened))].slice(0, RECENT_KEPT);
}

/**
 * The rows Search lists of `workspaceId`'s openings, newest first, each found
 * by its kind's finder; one no list holds any longer is passed over, so the
 * few shown are always rows that draw.
 */
export function recentRows<Task, Thread, Agent>(
  kept: readonly RecentOpened[],
  workspaceId: string | undefined,
  find: RecentFinders<Task, Thread, Agent>,
): readonly RecentRow<Task, Thread, Agent>[] {
  const rows: RecentRow<Task, Thread, Agent>[] = [];

  for (const opened of kept) {
    if (rows.length >= RECENT_SHOWN) break;

    if (opened.workspaceId !== workspaceId) continue;

    const row = recentRowOf(opened, find);

    if (row !== undefined) rows.push(row);
  }

  return rows;
}
