// search-switch-probe.ts -- PROBE, never merged: writes every switch to the Search tab to Documents/tab-switch.json for the Mac's timing rig, with when it was (wall clock), and from the tap: when JavaScript heard it, the first frame, Recent's rows drawn, and the JS thread's long tasks in between, as raw milliseconds.

import { File, Paths } from "expo-file-system";
import { useIsFocused } from "expo-router";
import { useLayoutEffect, useRef } from "react";

/** How long before the tab heard it came forward the tap that chose it may have ended. */
const TAP_WITHIN_MS = 3000;

/** The input entries a tap ends with, as React Native's event timing names them. */
const TAP_ENDS: ReadonlySet<string> = new Set(["touchend", "pointerup", "click"]);

/** The file the rig reads, under the app's Documents. */
const RECORD_FILE = new File(Paths.document, "tab-switch.json");

/** One switch to Search, as the rig reads it. */
interface SwitchRecord {
  readonly at: string;
  readonly order: number;
  readonly tapToHeardMs: number;
  readonly tapToFrameMs: number;
  readonly tapToRowsMs: number;
  readonly longTaskMs: number;
  readonly longTasks: number;
}

/** A switch being timed. */
interface Switching {
  readonly tapAt: number;
  readonly heardAt: number;
  frameAt: number | undefined;
}

let lastTapAt: number | undefined;
const longTasks: PerformanceEntry[] = [];
const records: SwitchRecord[] = [];

new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (TAP_ENDS.has(entry.name)) lastTapAt = Math.max(lastTapAt ?? 0, entry.startTime);
  }
}).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);

new PerformanceObserver((list) => {
  longTasks.push(...list.getEntries());
}).observe({ type: "longtask" });

/** The long tasks between `from` and `to`: how many touched the span, and how long they held it. */
function heldBetween(from: number, to: number): { readonly ms: number; readonly count: number } {
  return longTasks.reduce(
    (held, task) => {
      const overlap = Math.min(task.startTime + task.duration, to) - Math.max(task.startTime, from);

      return overlap > 0 ? { ms: held.ms + overlap, count: held.count + 1 } : held;
    },
    { ms: 0, count: 0 },
  );
}

/** Keeps a record and writes the whole list again, so the file always holds every switch so far. */
function keep(record: SwitchRecord): void {
  records.push(record);
  RECORD_FILE.write(JSON.stringify(records, null, 2));
}

/** Times every switch to the Search tab from the tap that chose it, until `rowsShown` first holds in front. */
export function useSearchSwitchProbe(rowsShown: boolean): void {
  const inFront = useIsFocused();
  const renderedAt = performance.now();
  const switching = useRef<Switching | undefined>(undefined);
  const heardAt = useRef(renderedAt);

  heardAt.current = renderedAt;

  useLayoutEffect(() => {
    if (!inFront) {
      switching.current = undefined;

      return;
    }

    const tapAt = lastTapAt;
    lastTapAt = undefined;

    if (tapAt === undefined || heardAt.current - tapAt > TAP_WITHIN_MS) return;
    const timing: Switching = { tapAt, heardAt: heardAt.current, frameAt: undefined };
    switching.current = timing;
    requestAnimationFrame(() => {
      timing.frameAt = performance.now();
    });
  }, [inFront]);

  useLayoutEffect(() => {
    const timing = switching.current;

    if (timing === undefined || !inFront || !rowsShown) return;
    switching.current = undefined;
    requestAnimationFrame(() => {
      const rowsAt = performance.now();
      const held = heldBetween(timing.tapAt, rowsAt);

      keep({
        at: new Date().toISOString(),
        order: records.length + 1,
        tapToHeardMs: Math.round(timing.heardAt - timing.tapAt),
        tapToFrameMs: Math.round((timing.frameAt ?? rowsAt) - timing.tapAt),
        tapToRowsMs: Math.round(rowsAt - timing.tapAt),
        longTaskMs: Math.round(held.ms),
        longTasks: held.count,
      });
    });
  }, [inFront, rowsShown]);
}
