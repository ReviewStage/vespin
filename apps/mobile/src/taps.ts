// taps.ts -- when the app's latest touches ended, as React Native's event timing stamped each where it landed, before JavaScript ran anything for it: what `tab:drawn` and `open:drawn` time a switch or an open from.

/** The input entries a touch ends with, as React Native's event timing names them. */
const TOUCH_ENDS: ReadonlySet<string> = new Set(["touchend", "pointerup", "click"]);

/** The least wait event timing tells of, in milliseconds: the spec's floor, so a touch slow enough to matter is always heard. */
const EVENT_TIMING_FLOOR_MS = 16;

/** How many of the latest touches are kept, enough for a burst of taps on one row and no more. */
const KEPT_TOUCHES = 16;

/** The Event Timing spec's own option, the least wait an event's entry is kept for, which TypeScript's DOM lib leaves out. */
interface EventTimingInit extends PerformanceObserverInit {
  readonly durationThreshold?: number;
}

/** The touches watched for: every input entry the floor keeps, from the bundle's start. */
const EVENT_WATCH: EventTimingInit = {
  type: "event",
  buffered: true,
  durationThreshold: EVENT_TIMING_FLOOR_MS,
};

/** When each of the latest touches ended, on the performance clock, oldest first. */
const touchEnds: number[] = [];

/** Keeps the ends among `entries`. */
function keepTouchEnds(entries: readonly PerformanceEntry[]): void {
  for (const entry of entries) {
    if (TOUCH_ENDS.has(entry.name)) touchEnds.push(entry.startTime);
  }

  touchEnds.sort((left, right) => left - right);

  if (touchEnds.length > KEPT_TOUCHES) touchEnds.splice(0, touchEnds.length - KEPT_TOUCHES);
}

// Note that touches are heard from the bundle's start, since event timing stamps each as it landed, before JavaScript runs anything for it, which is what lets an open be timed from the finger rather than from when JavaScript heard it.
const touchWatch = new PerformanceObserver((list) => keepTouchEnds(list.getEntries()));

touchWatch.observe(EVENT_WATCH);

/** When the latest touch ended; none before one has. */
export function lastTapAt(): number | undefined {
  return touchEnds.at(-1);
}

/**
 * When the latest touch ended after `from` and by `to`; none where none did.
 * Note that entries the observer holds but has not yet handed over are taken
 * first, because React Native hands them over at idle priority, behind the
 * very renders an open's tap starts.
 */
export function lastTouchBetween(from: number, to: number): number | undefined {
  keepTouchEnds(touchWatch.takeRecords());

  return touchEnds.findLast((at) => at > from && at <= to);
}
