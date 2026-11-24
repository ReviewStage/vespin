// launch-probe.ts -- PROBE ONLY, never merged: a cold launch's marks and the JS thread's stalls, written to Documents/launch-probe.json for the Mac rig to read.

import { File, Paths } from "expo-file-system";

type Mark = { n: string; t: number; d?: unknown };

const marks: Mark[] = [];
const stalls: Array<[number, number]> = [];
const seen = new Set<string>();
const wallAtLoad = Date.now();
const perfAtLoad = performance.now();

/** A gap between ticks longer than this is the JS thread held by work. */
const STALL_MS = 34;
const TICK_MS = 8;
const WATCH_MS = 16_000;

/** Notes a mark, every time it is called. */
export function probe(n: string, d?: unknown): void {
  marks.push(d === undefined ? { n, t: performance.now() } : { n, t: performance.now(), d });
}

/** Notes a mark the first time alone. */
export function probeOnce(n: string, d?: unknown): void {
  if (seen.has(n)) return;
  seen.add(n);
  probe(n, d);
}

/** Times `step`, noting its length as a mark of its own. */
export function probeTimed<T>(n: string, step: () => T, d?: (value: T) => unknown): T {
  const start = performance.now();
  const value = step();
  const ms = performance.now() - start;
  marks.push({ n, t: start, d: { ms: Math.round(ms * 10) / 10, ...(d ? { x: d(value) } : {}) } });

  return value;
}

// Note that the host's packages reach the probe through a global, since they can't import the app.
(globalThis as Record<string, unknown>).__launchProbe = probe;
(globalThis as Record<string, unknown>).__launchProbeTimed = probeTimed;

function startup(): Record<string, number | undefined> {
  try {
    const timing = (performance as unknown as { rnStartupTiming?: Record<string, number | null> })
      .rnStartupTiming;

    if (!timing) return {};

    return {
      startTime: timing.startTime ?? undefined,
      initializeRuntimeStart: timing.initializeRuntimeStart ?? undefined,
      executeJavaScriptBundleEntryPointStart:
        timing.executeJavaScriptBundleEntryPointStart ?? undefined,
      executeJavaScriptBundleEntryPointEnd:
        timing.executeJavaScriptBundleEntryPointEnd ?? undefined,
      initializeRuntimeEnd: timing.initializeRuntimeEnd ?? undefined,
      endTime: timing.endTime ?? undefined,
    };
  } catch {
    return {};
  }
}

let last = performance.now();

function tick(): void {
  const now = performance.now();

  if (now - last > STALL_MS) stalls.push([last, now]);
  last = now;

  if (now - perfAtLoad < WATCH_MS) setTimeout(tick, TICK_MS);
}

setTimeout(tick, TICK_MS);

/** Each module factory's own evaluation as the patched Metro runtime timed it (`__moduleProbeTimes`): the 400 slowest by self time, and the totals. */
function moduleTimes(at: (t: number) => number) {
  const times =
    ((globalThis as Record<string, unknown>).__moduleProbeTimes as
      | Array<[number, number, number, number]>
      | undefined) ?? [];
  const selfTotal = times.reduce((sum, [, self]) => sum + self, 0);
  const slowest = [...times]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 400)
    .map(([id, self, total, start]) => [id, Math.round(self * 100) / 100, Math.round(total * 10) / 10, at(start)]);

  return { count: times.length, selfTotal: Math.round(selfTotal), all: times.map(([id, self, , start]) => [id, Math.round(self * 100) / 100, at(start)]), slowest };
}

/** Writes everything noted so far, over what an earlier flush wrote. */
export function probeFlush(reason: string): void {
  try {
    const timing = startup();
    const zero = timing.startTime ?? perfAtLoad;
    const at = (t: number) => Math.round((t - zero) * 10) / 10;

    const text = JSON.stringify({
      reason,
      wallAtLoad,
      perfAtLoad: at(perfAtLoad),
      // Note that the epoch of RN's startTime lets the rig line the marks up with the process's own start.
      startEpochMs: wallAtLoad - (perfAtLoad - zero),
      timeOrigin: (performance as unknown as { timeOrigin?: number }).timeOrigin,
      timing: Object.fromEntries(
        Object.entries(timing).map(([key, value]) => [key, value === undefined ? null : at(value)]),
      ),
      marks: marks.map((mark) => ({ ...mark, t: at(mark.t) })),
      stalls: stalls.map(([from, to]) => [at(from), at(to), Math.round(to - from)]),
      modules: moduleTimes(at),
    });

    const file = new File(Paths.document, "launch-probe.json");
    file.writeSync(text);
  } catch (cause) {
    console.error("launch probe could not write", cause);
  }
}

probe("probe-loaded");
setTimeout(() => probeFlush("t16"), WATCH_MS + 200);
