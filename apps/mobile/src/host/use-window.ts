// use-window.ts -- the one way a screen reads a window of rows from the store: a live query whose read answers a read state, holding its last rows while a rebuilt read loads.

import { type ReadWindow, readWindow } from "@repo/host/read-window";
import {
  type Context,
  type GetResult,
  type InitialQueryBuilder,
  type NonSingleResult,
  type QueryBuilder,
  useLiveQuery,
} from "@tanstack/react-db";
import { useMemo, useState } from "react";

/**
 * The window `query` reads, as a read state (`@repo/host/read-window`):
 * reading until its live query first answers, its rows once it has, and
 * the last rows it answered, not settled, while a read of other rows loads,
 * as a scope switched or a thread chosen rebuilds the query. A query that
 * answers none, waiting on what it reads by, stands as reading. Note that
 * the last rows are kept in state set while rendering, React's own way of
 * holding a value from an earlier render, so a rebuilt read never draws a
 * frame of nothing, and the hook renders again only where the rows moved.
 */
export function useWindow<Of extends Context & NonSingleResult>(
  query: (q: InitialQueryBuilder) => QueryBuilder<Of> | undefined,
): ReadWindow<GetResult<Of>> {
  const live = useLiveQuery(query);

  // SAFETY: a window is a list, never a `findOne` (`NonSingleResult`), so its query's data is the array of its results.
  const rows = live.data as readonly GetResult<Of>[] | undefined;
  const answered = live.isEnabled && live.isReady ? rows : undefined;

  const [last, keep] = useState(answered);

  if (answered !== undefined && answered !== last) keep(answered);

  return useMemo(
    () =>
      readWindow(
        {
          enabled: live.isEnabled,
          ready: live.isReady,
          failed: live.isLoadingError || live.isCrashed,
          rows: answered,
        },
        last,
      ),
    [live.isEnabled, live.isReady, live.isLoadingError, live.isCrashed, answered, last],
  );
}
