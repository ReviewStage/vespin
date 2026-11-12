import type { StatusTone } from "../../status-tone.js";

/**
 * segment-bar.tsx -- a thin horizontal bar of segments, one for each thing in a line, each in its tone, as a merge queue's line is drawn over its rows.
 *
 * Each segment takes an equal share of the bar's width, in order, drawn in
 * its status tone's ink (`tokens/status-tone.css`), or the strong border's
 * where it has none, as a thing still waiting its turn is. One segment may
 * stand marked, ringed in the text's ink, as the thing a page was opened for
 * is. It is a picture of the rows beside it, which say everything it shows,
 * so it is hidden from assistive technology and takes no press.
 */

/** One segment: its tone, none for a thing at rest, and whether it is the one marked. */
export interface BarSegment {
  readonly tone?: StatusTone | undefined;
  readonly marked?: boolean | undefined;
}

/** The bar: a row of equal shares with a hairline's room between them. */
const BAR_CLASS = "ui-segment-bar flex w-full items-center gap-ui-2";

/** A segment, in its tone's ink where it has one, the strong border's where it has none, ringed where marked. */
const SEGMENT_CLASS =
  "ui-segment-bar-segment h-ui-4 min-w-ui-4 flex-[1_1_0] rounded-ui-full bg-border-strong data-tone:bg-tone-ink data-marked:outline data-marked:outline-1 data-marked:outline-offset-1 data-marked:outline-foreground";

export function SegmentBar({ segments }: { segments: readonly BarSegment[] }): React.JSX.Element {
  return (
    <div className={BAR_CLASS} aria-hidden="true">
      {segments.map((segment, index) => (
        <span
          // Note that a segment is its place in the line, which is all the bar knows of it.
          key={index}
          className={SEGMENT_CLASS}
          data-tone={segment.tone}
          data-marked={segment.marked === true ? "" : undefined}
        />
      ))}
    </div>
  );
}
