/**
 * inbox-rows.ts -- the Inbox's items as a screen reads them where they are kept on disk: a live query over the pool's kept collection, the same query over the rows a member's writes draw, and the two merged (`@repo/host/inbox-rows`).
 *
 * The kept collection loads from the account's database only what the
 * query's filter finds there, and hands the query each change as it lands,
 * so a delivery costs the rows it moved. The rows the writes standing draw
 * are few, held in a collection of their own made anew each time they move,
 * so the query runs over them with the same filter, and the merge takes each
 * key a write stands over from them.
 */

import type { InboxMessage } from "@repo/features/inbox-wire";
import {
  INBOX_REACH,
  type InboxReach,
  type InboxRowsSource,
  inboxRowsDrawn,
  inboxRowsMerged,
  inboxRowsWhere,
  type PlacedInboxRow,
  threadMessagesWhere,
  threadOfRows,
} from "@repo/host/inbox-rows";
import {
  type Collection,
  createCollection,
  type InitialQueryBuilder,
  localOnlyCollectionOptions,
  useLiveQuery,
} from "@tanstack/react-db";
import { useEffect, useMemo, useReducer, useState } from "react";
import { useInboxRowsSource } from "../host/host-provider.js";

/** No write standing over any row. */
const NONE_PENDING: ReadonlyMap<string, PlacedInboxRow> = new Map();

/** No row drawn by a write. */
const NONE_DRAWN: readonly PlacedInboxRow[] = [];

/** The query a screen reads `source`'s rows by, as far as `reach` reads. */
function rowsQuery(
  q: InitialQueryBuilder,
  source: Collection<PlacedInboxRow, string>,
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
export function useInboxRows(reach: InboxReach | undefined): readonly PlacedInboxRow[] | undefined {
  const standing = useStanding(useInboxRowsSource());
  const collection = standing?.collection;
  const pending = standing?.pending ?? NONE_PENDING;

  // Note that the drawn rows stand in a collection only while any does, so a screen with no write standing runs one query.
  const drawnSource = useMemo(() => {
    const rows = inboxRowsDrawn(pending);

    return reach === undefined || rows.length === 0
      ? undefined
      : createCollection(
          localOnlyCollectionOptions<PlacedInboxRow, string>({
            getKey: (row) => row.id,
            initialData: [...rows],
          }),
        );
  }, [pending, reach === undefined]);

  useEffect(
    () => () => {
      void drawnSource?.cleanup();
    },
    [drawnSource],
  );

  const kept = useLiveQuery((q) =>
    reach === undefined || collection === undefined ? undefined : rowsQuery(q, collection, reach),
  );

  const drawn = useLiveQuery((q) =>
    reach === undefined || drawnSource === undefined ? undefined : rowsQuery(q, drawnSource, reach),
  );

  const keptRows = kept.isReady ? kept.data : undefined;
  const drawnRows = drawn.data ?? NONE_DRAWN;

  return useMemo(
    () => (keptRows === undefined ? undefined : inboxRowsMerged(keptRows, drawnRows, pending)),
    [keptRows, drawnRows, pending],
  );
}

/**
 * The messages of the thread `threadId` names, oldest first, read from the
 * kind they are kept in on disk as the thread opens, so a launch never reads
 * a thread it does not show; none where nothing keeps them, as where the
 * Inbox is held in memory, or before the query has loaded.
 */
export function useThreadMessages(
  threadId: string | undefined,
): readonly InboxMessage[] | undefined {
  const source = useInboxRowsSource();
  // Note that the standing is read only to hear the message kind made, which the follow stands on after the screen first draws.
  const standing = useStanding(source);
  const messages = standing === undefined ? undefined : source.messages();

  const kept = useLiveQuery((q) =>
    threadId === undefined || messages === undefined
      ? undefined
      : q
          .from({ message: messages })
          .where(({ message }) => threadMessagesWhere(message, threadId)),
  );

  const rows = kept.isReady ? kept.data : undefined;

  return useMemo(() => (rows === undefined ? undefined : threadOfRows(rows)), [rows]);
}

/** No kept message answers a search: what one reads before its query answers, or where nothing is typed. */
const NONE_SEARCHED: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * Each thread whose kept messages say any of `tokens`, with those they say,
 * as the kept words find them in SQLite off the JavaScript thread
 * (`InboxRowsSource.threadsSaying`), so a keystroke waits on no read of the
 * messages. A search typed anew asks anew, as it does each time the kept
 * words are written while it stands, and the answer to one it replaced is
 * let go unheard, so typing never draws an older search's. None
 * where nothing is typed, and none found before the first answer.
 */
export function useSearchedWords(
  tokens: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const source = useInboxRowsSource();
  const [searched, setSearched] = useState(NONE_SEARCHED);
  const [written, wrote] = useReducer((count: number) => count + 1, 0);
  const typed = tokens.length > 0;

  // Note that a search standing hears each write of the kept words, so a message that lands saying a word typed brings its thread in as it lands.
  useEffect(() => (typed ? source.wordsMoved(wrote) : undefined), [source, typed]);

  useEffect(() => {
    let current = true;

    if (tokens.length === 0) setSearched(NONE_SEARCHED);
    else
      source.threadsSaying(tokens).then(
        (found) => {
          if (current) setSearched(found);
        },
        // Note that a search the database would not answer finds by each row's own words alone.
        () => {
          if (current) setSearched(NONE_SEARCHED);
        },
      );

    return () => {
      current = false;
    };
  }, [source, tokens, written]);

  return tokens.length === 0 ? NONE_SEARCHED : searched;
}
