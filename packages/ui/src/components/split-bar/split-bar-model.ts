/**
 * split-bar-model.ts -- how many of a split bar's segments stand in its width, and how wide each stands.
 *
 * Every segment the bar shows is as wide as the others, and none narrower
 * than the floor its owner keeps legible. Where all of them fit at that
 * floor, all stand; where they do not, the bar keeps room for the one
 * segment that names the rest ("3 more") at its own width, and shows as many
 * as fit beside it, at least one, so the count is never what gives way.
 */

/** What a split bar is fitted from, every width in the same unit. */
export interface SplitBarRoom {
  /** The bar's width. */
  readonly width: number;
  /** How many segments it has to show. */
  readonly count: number;
  /** The narrowest a segment may stand. */
  readonly floor: number;
  /** The room between two segments. */
  readonly gap: number;
  /** The width of the segment that names the rest. */
  readonly more: number;
}

/** How a split bar stands: how many segments it shows, and how wide each of them is. */
export interface SplitBarFit {
  readonly shown: number;
  readonly segment: number;
}

/** The segments a bar shows in its width, as many as fit at their floor, the rest folded into one segment that names them. */
export function splitBarFit({ width, count, floor, gap, more }: SplitBarRoom): SplitBarFit {
  if (count === 0) return { shown: 0, segment: 0 };
  const whole = count * floor + (count - 1) * gap <= width;

  const shown = whole
    ? count
    : Math.min(count - 1, Math.max(1, Math.floor((width - more) / (floor + gap))));

  const folded = shown < count ? more + gap : 0;

  return { shown, segment: Math.max(0, (width - folded - (shown - 1) * gap) / shown) };
}
