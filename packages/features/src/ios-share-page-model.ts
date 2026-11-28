/**
 * ios-share-page-model.ts -- what the iOS share page lists and says: where a share may go in its sections, narrowed by a search, and the "To" capsule's words for what is ticked.
 *
 * The page lists the snapshot's destinations (`ios-share-wire.ts`) on one
 * page above the composer: New task, then Recent, the newest moved of every
 * kind, then each kind's rest under its own heading, so no destination
 * stands twice, as a list a row is ticked in by its id must never hold one
 * id twice. A search drops Recent and narrows every kind by the words its
 * row says, every word found somewhere, as the app's lists search.
 */

import {
  SHARE_DESTINATION_KIND,
  type ShareDestination,
  type ShareDestinationKind,
} from "./ios-share-wire.js";
import { matchesTokens, searchTokens } from "./search-tokens.js";

/** How many destinations Recent holds. */
const RECENT_COUNT = 5;

/** The id New task is ticked by, which no destination's id can be, since theirs are the service's uuids. */
export const SHARE_NEW_TASK_ID = "new-task";

/** The page's words, as the app's composers and lists say them. */
export const SHARE_PAGE_WORDS = {
  TITLE: "Send to",
  SEARCH: "Managers, tasks, agents, threads",
  PLACEHOLDER: "Add a message",
  NEW_TASK: "New task",
  RECENT: "Recent",
  NO_MATCH: "No matches",
  CANCEL: "Cancel",
  /** Several places ticked, as the "To" capsule says them. */
  places: (count: number) => `${count} places`,
} as const;

/** Each kind's heading. */
export const SHARE_KIND_HEADING = {
  [SHARE_DESTINATION_KIND.MANAGER]: "Managers",
  [SHARE_DESTINATION_KIND.THREAD]: "Inbox",
  [SHARE_DESTINATION_KIND.TASK]: "Tasks",
  [SHARE_DESTINATION_KIND.AGENT]: "Agents",
} as const satisfies Record<ShareDestinationKind, string>;

/** The kinds in the order the page stands their sections. */
const KIND_ORDER: readonly ShareDestinationKind[] = [
  SHARE_DESTINATION_KIND.MANAGER,
  SHARE_DESTINATION_KIND.THREAD,
  SHARE_DESTINATION_KIND.TASK,
  SHARE_DESTINATION_KIND.AGENT,
];

/** One kind's rows under its heading. */
export interface ShareKindSection {
  readonly kind: ShareDestinationKind;
  readonly rows: readonly ShareDestination[];
}

/** What the page lists: Recent, empty while a search narrows the page, then each kind that holds a row. */
export interface ShareSections {
  readonly recent: readonly ShareDestination[];
  readonly kinds: readonly ShareKindSection[];
}

/** What a destination's row is called, its first line. */
export function shareDestinationName(row: ShareDestination): string {
  return row.kind === SHARE_DESTINATION_KIND.THREAD ? row.title : row.name;
}

/** Every line a destination's row says, which a search reads. */
function rowWords(row: ShareDestination): readonly string[] {
  switch (row.kind) {
    case SHARE_DESTINATION_KIND.MANAGER:
    case SHARE_DESTINATION_KIND.TASK:
      return [row.name];
    case SHARE_DESTINATION_KIND.AGENT:
      return [row.name, row.task];
    case SHARE_DESTINATION_KIND.THREAD:
      return [row.title, row.holder];
  }
}

/** `rows` of `kind`, newest moved first, but those in `left`. */
function ofKind(
  rows: readonly ShareDestination[],
  kind: ShareDestinationKind,
  left: ReadonlySet<string>,
): ShareKindSection {
  return {
    kind,
    rows: rows
      .filter((row) => row.kind === kind && !left.has(row.id))
      .toSorted((a, b) => b.at - a.at),
  };
}

/**
 * The page's sections for `rows` under `search`: with no words, Recent, the
 * newest moved of every kind, then each kind's rest; with words, no Recent,
 * and each kind's rows that say every word. A kind left with no row stands
 * no section.
 */
export function shareSections(rows: readonly ShareDestination[], search: string): ShareSections {
  const tokens = searchTokens(search);
  const searching = tokens.length > 0;

  const found = searching ? rows.filter((row) => matchesTokens(rowWords(row), tokens)) : rows;

  const recent = searching ? [] : found.toSorted((a, b) => b.at - a.at).slice(0, RECENT_COUNT);

  const shown = new Set(recent.map((row) => row.id));

  const kinds = KIND_ORDER.flatMap((kind) => {
    const section = ofKind(found, kind, shown);

    return section.rows.length > 0 ? [section] : [];
  });

  return { recent, kinds };
}

/** The "To" capsule's words for the names ticked: the one name, or how many places; none while nothing is. */
export function shareToLabel(names: readonly string[]): string | undefined {
  const [only] = names;

  if (only === undefined) return undefined;

  return names.length === 1 ? only : SHARE_PAGE_WORDS.places(names.length);
}
