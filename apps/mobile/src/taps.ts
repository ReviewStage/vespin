// taps.ts -- when the app's latest touches ended, and which were taps rather than drags, as React Native's event timing stamped each where it landed, before JavaScript ran anything for it: what `tab:drawn` and `open:drawn` time a switch or an open from.

/** The input entries a tap ends with, as React Native's event timing names them. */
const TAP_ENDS: ReadonlySet<string> = new Set(["touchend", "pointerup", "click"]);

/** The input entries a touch starts with. */
const TAP_STARTS: ReadonlySet<string> = new Set(["touchstart", "pointerdown"]);

/** The longest a touch held down still reads as a tap rather than a drag or a scroll, in milliseconds. */
const TAP_HELD_MS = 250;

/** The least wait event timing tells of, in milliseconds: the spec's floor, so a touch slow enough to matter is always heard. */
const EVENT_TIMING_FLOOR_MS = 16;

/** How many of the latest touches are kept, enough for a burst of taps on one row and no more. */
const KEPT_TAPS = 16;

/** Two entries of one touch, a `touchend` and its `pointerup` or `click`, land this close; a second tap never does. */
const SAME_TAP_MS = 30;

/** The Event Timing spec's own option, the least wait an event's entry is kept for, which TypeScript's DOM lib leaves out. */
interface EventTimingInit extends PerformanceObserverInit {
  readonly durationThreshold?: number;
}

/** The taps watched for: every input entry the floor keeps, from the bundle's start. */
const EVENT_WATCH: EventTimingInit = {
  type: "event",
  buffered: true,
  durationThreshold: EVENT_TIMING_FLOOR_MS,
};

/** A touch that ended: when, and whether it was held down briefly enough to be a tap. */
interface TouchEnd {
  readonly at: number;
  readonly tap: boolean;
}

/** Each of the latest touches' ends, on the performance clock, oldest first. */
const touchEnds: TouchEnd[] = [];

/** When the latest touch started; none before one has. */
let startedAt: number | undefined;

/** Keeps a touch's end, once a touch, however many entries name it. */
function keepTouchEnd(at: number): void {
  const last = touchEnds.at(-1);

  if (last !== undefined && Math.abs(at - last.at) < SAME_TAP_MS) return;
  const tap = startedAt !== undefined && at - startedAt <= TAP_HELD_MS;
  touchEnds.push({ at, tap });
  touchEnds.sort((left, right) => left.at - right.at);

  if (touchEnds.length > KEPT_TAPS) touchEnds.splice(0, touchEnds.length - KEPT_TAPS);
}

// Note that touches are heard from the bundle's start, since event timing stamps each as it landed, before JavaScript runs anything for it, which is what lets an open be timed from the finger rather than from when JavaScript heard it.
const tapWatch = new PerformanceObserver((list) => {
  const entries = list.getEntries().toSorted((left, right) => left.startTime - right.startTime);

  for (const entry of entries) {
    if (TAP_STARTS.has(entry.name)) startedAt = Math.max(startedAt ?? 0, entry.startTime);

    if (TAP_ENDS.has(entry.name)) keepTouchEnd(entry.startTime);
  }
});

tapWatch.observe(EVENT_WATCH);

/** When the latest touch ended, a tap's or a drag's; none before one has. */
export function lastTapAt(): number | undefined {
  return touchEnds.at(-1)?.at;
}

/** When the latest touch ended by `to`, a tap's or a drag's; none where none had. */
export function lastTouchBy(to: number): number | undefined {
  return touchEnds.findLast(({ at }) => at <= to)?.at;
}

/** How many taps, touches held down briefly rather than drags or scrolls, ended after `from` and by `to`. */
export function tapsBetween(from: number, to: number): number {
  return touchEnds.filter(({ at, tap }) => tap && at > from && at <= to).length;
}
