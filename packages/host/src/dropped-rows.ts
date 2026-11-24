/**
 * dropped-rows.ts -- counts the rows a followed read's reading left out (`live-follow.ts`'s `dropped`), once a session for each kind, as `rows:dropped`: the kind and how many, on a rung, never a row or an id.
 *
 * A row of a followed read that does not decode is dropped rather than
 * failing its answer (`@repo/features/live-read`'s `rowsReading`), so a
 * shape the service and a released build disagree on makes rows vanish
 * from a list with no error anywhere. Counting each kind that lost any is
 * how such a drift is seen; once a session, so a read answered whole again
 * and again counts it once.
 */

import {
  PRODUCT_EVENT,
  type ProductRowKind,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@repo/features/analytics";

/** Counts through `record` how many rows of a kind a read dropped, the first time in this session that kind drops any. */
export function droppedRowsCount(
  record: RecordProductEvent,
): (kind: ProductRowKind, count: number) => void {
  const counted = new Set<ProductRowKind>();

  return (kind, count) => {
    if (count <= 0 || counted.has(kind)) return;
    counted.add(kind);
    record(PRODUCT_EVENT.ROWS_DROPPED, {
      row_kind: kind,
      dropped: productSessionCountBucket(count),
    });
  };
}
