/**
 * inbox-rows.ts -- the Inbox's items as a screen reads them where they are kept on disk: a live query over the pool's kept collection, the same query over the rows a member's writes draw, and the two merged (`@repo/host/inbox-rows`).
 *
 * The kept collection loads from the account's database only what the
 * query's filter finds there, and hands the query each change as it lands,
 * so a delivery costs the rows it moved. The rows the writes standing draw
 * are few, held by the pool in one collection of their own made with the
 * kind (`StandingRows.drawn`), so the same query, declared once, runs over
 * them with the same filter, and the merge takes each key a write stands
 * over from them.
 */

import {
  INBOX_REACH,
  type InboxReach,
  type InboxRowsSource,
  inboxRowsMerged,
  inboxRowsWhere,
  type PlacedInboxItem,
} from "@repo/host/inbox-rows";
import { WINDOW_READ, windowRows } from "@repo/host/read-window";
import type { Collection, InitialQueryBuilder } from "@tanstack/react-db";
import { useEffect, useMemo, useReducer } from "react";
import { useInboxRowsSource } from "../host/host-provider.js";
import { useWindow } from "../host/use-window.js";

/** No write standing over any row. */
const NONE_PENDING: ReadonlyMap<string, PlacedInboxItem> = new Map();

/** The query a screen reads `source`'s rows by, as far as `reach` reads. */
function rowsQuery(
  q: InitialQueryBuilder,
  source: Collection<PlacedInboxItem, string>,
  reach: InboxReach,
) {
  const rows = q.from({ item: source });

  return reach.kind === INBOX_REACH.WHOLE
    ? rows
    : rows.where(({ item }) => inboxRowsWhere(item, reach));
}

/** The kind's collection and the rows its writes draw as they stand, read again each time they move. */
function useStanding(source: InboxRowsSource) {
  const [moves, moved] = useReducer((count: number) => count + 1, 0);

  // Note that the rows are read again once the watch stands, since a move between the render's read and the watch is told nobody.
  useEffect(() => {
    const stop = source.watch(moved);
    moved();

    return stop;
  }, [source]);

  // Note that `moves` is read only to read the rows again each time they move.
  return useMemo(() => (moves >= 0 ? source.standing() : undefined), [source, moves]);
}

/**
 * The Inbox's items as far as `reach` reads, each a write stands over as it
 * draws it; none while nothing reads (`reach` none) or the query has not
 * loaded yet.
 */
export function useInboxRows(
  reach: InboxReach | undefined,
): readonly PlacedInboxItem[] | undefined {
  const standing = useStanding(useInboxRowsSource());
  const collection = standing?.collection;
  const drawnSource = standing?.drawn;
  const pending = standing?.pending ?? NONE_PENDING;

  const kept = useWindow((q) =>
    reach === undefined || collection === undefined ? undefined : rowsQuery(q, collection, reach),
  );

  const drawnRows = windowRows(
    useWindow((q) =>
      reach === undefined || drawnSource === undefined
        ? undefined
        : rowsQuery(q, drawnSource, reach),
    ),
  );

  // Note that only a settled read's rows stand here for now, never the last read's held over, since the thread's screen reads them as answered (`@repo/host/inbox-thread-standing`); the Inbox's screens take the window itself next.
  const keptRows = kept.status === WINDOW_READ.ROWS && kept.settled ? kept.rows : undefined;

  return useMemo(
    () => (keptRows === undefined ? undefined : inboxRowsMerged(keptRows, drawnRows, pending)),
    [keptRows, drawnRows, pending],
  );
}
