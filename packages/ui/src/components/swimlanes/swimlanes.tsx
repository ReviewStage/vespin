/**
 * swimlanes.tsx -- MOCKUP, never to merge: lanes across a stretch of time, each a row of spans and marks, with the hours above and a now-line through them all.
 *
 * Each lane names itself at its start, then lays its spans (a turn, from its
 * start to its end) and its marks (a moment, such as a pull request opened)
 * at their places in the stretch. A span or a mark carries its words for a
 * reader and its tooltip.
 */

import type { ReactNode } from "react";
import { cn } from "../../cn.js";

/** What a span says by its fill: at work now, finished, or waiting on the reader. */
export const SWIMLANE_TONE = {
  WORKING: "working",
  DONE: "done",
  WAITING: "waiting",
} as const;

export type SwimlaneTone = (typeof SWIMLANE_TONE)[keyof typeof SWIMLANE_TONE];

const SPAN_CLASS = {
  [SWIMLANE_TONE.WORKING]: "bg-working",
  [SWIMLANE_TONE.DONE]: "bg-fill-strong",
  [SWIMLANE_TONE.WAITING]: "bg-attention",
} as const satisfies Record<SwimlaneTone, string>;

export interface SwimlaneSpan {
  readonly from: number;
  readonly to: number;
  readonly tone: SwimlaneTone;
  readonly label: string;
}

export interface SwimlaneMark {
  readonly at: number;
  readonly glyph: ReactNode;
  readonly label: string;
}

export interface Swimlane {
  readonly key: string;
  /** Its name at the lane's start: a glyph and words. */
  readonly head: ReactNode;
  readonly spans: readonly SwimlaneSpan[];
  readonly marks: readonly SwimlaneMark[];
}

export interface SwimlaneTick {
  readonly at: number;
  readonly label: string;
}

/** Where `at` stands in the stretch, as a share of its width, held inside it. */
function placeOf(at: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (at - from) / (to - from)));
}

function percent(share: number): string {
  return `${(share * 100).toFixed(3)}%`;
}

/** Lanes across `from` to `to`, its hours above at `ticks`, and a line at `now`. */
export function Swimlanes({
  label,
  lanes,
  from,
  to,
  now,
  ticks,
}: {
  label: string;
  lanes: readonly Swimlane[];
  from: number;
  to: number;
  now: number;
  ticks: readonly SwimlaneTick[];
}): React.JSX.Element {
  const nowAt = percent(placeOf(now, from, to));
  // Note that a tick under the now-line's label would be hidden by it, so it is not drawn there.
  const shownTicks = ticks.filter((tick) => Math.abs(tick.at - now) > (to - from) / 16);

  return (
    <div role="group" aria-label={label} className="grid grid-cols-[200px_1fr] gap-y-ui-4">
      <div />
      <div className="relative h-ui-24 border-b border-border">
        {shownTicks.map((tick) => (
          <span
            key={tick.at}
            className="absolute top-0 -translate-x-1/2 text-caption text-muted-foreground tabular-nums whitespace-nowrap"
            style={{ left: percent(placeOf(tick.at, from, to)) }}
          >
            {tick.label}
          </span>
        ))}
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-destructive px-ui-6 text-caption text-ground"
          style={{ left: nowAt }}
        >
          Now
        </span>
      </div>
      {lanes.map((lane) => (
        <div key={lane.key} className="contents">
          <div className="flex min-w-0 items-center pr-ui-12">{lane.head}</div>
          <div className="relative h-ui-40 rounded-control bg-muted">
            {ticks.map((tick) => (
              <span
                key={tick.at}
                aria-hidden="true"
                className="absolute inset-y-0 w-px bg-border"
                style={{ left: percent(placeOf(tick.at, from, to)) }}
              />
            ))}
            {lane.spans.map((span) => {
              const start = placeOf(span.from, from, to);
              const end = placeOf(span.to, from, to);

              return (
                <span
                  key={`${span.from}`}
                  title={span.label}
                  aria-label={span.label}
                  role="img"
                  className={cn(
                    "absolute top-ui-12 h-ui-16 rounded-avatar-tile",
                    SPAN_CLASS[span.tone],
                  )}
                  style={{ left: percent(start), width: percent(Math.max(end - start, 0.008)) }}
                />
              );
            })}
            {lane.marks.map((mark) => (
              <span
                key={`${mark.at}-${mark.label}`}
                title={mark.label}
                aria-label={mark.label}
                role="img"
                className="absolute top-1/2 grid size-ui-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-ground text-body-foreground [--ui-glyph-size:14px] [&_svg]:size-ui-12"
                style={{ left: percent(placeOf(mark.at, from, to)) }}
              >
                {mark.glyph}
              </span>
            ))}
            <span
              aria-hidden="true"
              className="absolute -inset-y-ui-4 w-0.5 bg-destructive"
              style={{ left: nowAt }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
