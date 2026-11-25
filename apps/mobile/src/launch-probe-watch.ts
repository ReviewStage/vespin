// launch-probe-watch.ts -- PROBE ONLY, never merged: what the JS thread did in a cold launch's first seconds, for the Mac rig: React Native's long tasks and input events, and a Hermes sampling profile naming what ran in them, written beside launch-probe.json.

import { File, Paths } from "expo-file-system";
import { TurboModuleRegistry } from "react-native";
import { probe } from "./launch-probe.js";

/** How long after the bundle's start the watch keeps its entries and the profile runs: past the first ten seconds after the first frame. */
const WATCH_MS = 40_000;

type Entry = { readonly name: string; readonly startTime: number; readonly duration: number };

type EventEntry = Entry & { readonly processingStart?: number; readonly processingEnd?: number };

const longTasks: Array<[number, number]> = [];
const events: Array<{ n: string; t: number; d: number; ps?: number; pe?: number }> = [];

/** Sentry's native module, whose calls start and stop Hermes's own sampling profiler. */
interface SentryProfiler {
  readonly startProfiling: (platformProfilers: boolean) => { started?: boolean; error?: string };
  readonly stopProfiling: () => { profile?: string; error?: string };
}

const sentry = TurboModuleRegistry.get("RNSentry") as SentryProfiler | null;

function observe(type: string, take: (entry: EventEntry) => void, threshold?: number): void {
  try {
    const Observer = (
      globalThis as unknown as {
        PerformanceObserver?: new (
          cb: (list: { getEntries: () => EventEntry[] }) => void,
        ) => { observe: (o: object) => void };
      }
    ).PerformanceObserver;

    if (Observer === undefined) {
      probe(`watch:no-observer:${type}`);

      return;
    }

    new Observer((list) => {
      for (const entry of list.getEntries()) take(entry);
    }).observe({
      type,
      buffered: true,
      ...(threshold === undefined ? undefined : { durationThreshold: threshold }),
    });
    probe(`watch:observing:${type}`);
  } catch (cause) {
    probe(`watch:observe-failed:${type}`, String(cause));
  }
}

observe("longtask", (entry) => longTasks.push([entry.startTime, entry.duration]));
observe(
  "event",
  (entry) =>
    events.push({
      n: entry.name,
      t: entry.startTime,
      d: entry.duration,
      ...(entry.processingStart === undefined
        ? undefined
        : { ps: entry.processingStart, pe: entry.processingEnd }),
    }),
  16,
);

let profiling = false;

/** React Native's own start of this launch, which every mark is timed from (`launch-probe.ts`). */
function startOf(): number | undefined {
  return (
    (performance as unknown as { rnStartupTiming?: { startTime?: number | null } }).rnStartupTiming
      ?.startTime ?? undefined
  );
}

/** When each clock mark ran, by `performance.now()`, so each profile's own clock can be lined up with the marks; the first is the launch profile's. */
const clockMarks: Array<{ start: number; end: number }> = [];

/** Spins the JS thread for 20 ms under its own name, which the profile's samples show, at a time the watch keeps. */
function probeClockMark(): void {
  const start = performance.now();
  let spun = 0;

  while (performance.now() - start < 20) spun += 1;
  clockMarks.push({ start, end: performance.now() });
  probe("watch:clock-mark", { spun });
}

try {
  const started = sentry?.startProfiling(false);
  profiling = started?.started === true;
  probe("watch:profile-start", { started: profiling, error: started?.error });
} catch (cause) {
  probe("watch:profile-start-failed", String(cause));
}

/** Writes the long tasks and events so far under `watchFile`, and stops the profile running into `profileFile`, where one runs. */
function written(watchFile: string, profileFile: string): void {
  try {
    new File(Paths.document, watchFile).writeSync(
      JSON.stringify({ zero: startOf(), clockMark: clockMarks[0], clockMarks, longTasks, events }),
    );

    if (!profiling) return;
    const stopped = sentry?.stopProfiling();
    profiling = false;

    if (stopped?.profile !== undefined) {
      new File(Paths.document, profileFile).writeSync(stopped.profile);
    }
    probe("watch:profile-written", {
      profileFile,
      chars: stopped?.profile?.length,
      error: stopped?.error,
    });
  } catch (cause) {
    probe("watch:write-failed", String(cause));
  }
}

/** Starts a second profile a minute in, with its own clock mark, for what still runs after the first minute. */
function profileAgain(): void {
  try {
    const started = sentry?.startProfiling(false);
    profiling = started?.started === true;
    probe("watch:profile-again", { started: profiling, error: started?.error });
    setTimeout(probeClockMark, 50);
  } catch (cause) {
    probe("watch:profile-again-failed", String(cause));
  }
}

// Note that the mark runs after the profile starts, once the bundle's own evaluation is done.
setTimeout(probeClockMark, 50);
// Note that the moving-account run (STAG-3917's catch-up trace) is watched for three minutes: three profiles of 60 s each, the long tasks and events written beside each.
setTimeout(() => written("launch-watch-60.json", "launch-profile-0.json"), 60_000);
setTimeout(profileAgain, 61_000);
setTimeout(() => written("launch-watch-120.json", "launch-profile-60.json"), 120_000);
setTimeout(profileAgain, 121_000);
setTimeout(() => written("launch-watch-180.json", "launch-profile-120.json"), 180_000);
