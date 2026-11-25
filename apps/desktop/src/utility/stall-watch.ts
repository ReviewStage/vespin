/**
 * stall-watch.ts -- the worker thread beside main that catches main stalling: it waits on main's ticks, pauses main for its stack where one comes late, and tells main once it ticks again.
 *
 * Main runs this from its own text (`STALL_WATCH_WORKER`, which
 * `scripts/build.mjs` bundles), handing it the count its loop timer adds
 * one to at every tick (`main-loop-stalls.ts`'s `mainTicks`). The worker
 * sleeps on that count (`Atomics.wait`) rather than on a timer of its own,
 * so it wakes only as main ticks, ten times a second, or once a tick is
 * `MAIN_STALL.STALL_MS` late, which is the stall.
 *
 * Note that main's inspector is reached in process (`connectToMainThread`),
 * which opens no port and needs none of the Node switches the packaged app
 * burns off, so nothing outside the app can reach it. The debugger is
 * enabled once, as the watch starts, since enabling it during a stall would
 * lengthen the stall; it sets no breakpoint, so main runs as it would
 * without it until a pause. The inspector's replies wait while the worker
 * sleeps and are read once a stall wakes it, in the order they came, so
 * every script main loaded is known before the pause is. Main is let go as
 * soon as its stack is read, with no value of any frame.
 *
 * A pause lands at the next JavaScript main runs, so where main stood still
 * in native code the stack is where it came back; one that lands once the
 * stall is over is dropped, since it would name whatever ran next.
 */

import { Session } from "node:inspector";
import { parentPort, workerData } from "node:worker_threads";
import { MAIN_STALL, type MainStall, type StallFrame, stallFrames } from "@repo/host/main-stall";

/** What main hands the watch: the memory its tick count stands in, and how often it ticks, in milliseconds. */
export interface StallWatchData {
  readonly ticks: SharedArrayBuffer;
  readonly tickMs: number;
}

// SAFETY: main starts this worker only through `watchMainStalls`, which hands it exactly this shape.
const { ticks: tickMemory, tickMs } = workerData as StallWatchData;

/** How long the worker sleeps on main's count before main has stalled: a tick, and `STALL_MS` past it. */
const STALLED_AFTER_MS = tickMs + MAIN_STALL.STALL_MS;
const ticks = new Int32Array(tickMemory);
const session = new Session();

/** Each script main has loaded, by the id the inspector names it by, to the address it was loaded from. */
const scripts = new Map<string, string>();

/** When main last ticked before it stalled, by this thread's clock, and its count then; none while it answers. */
let stalled: { readonly since: number; readonly count: number } | undefined;

/** The stack the stall standing was caught in, once a pause has landed during it. */
let caught: readonly StallFrame[] | undefined;

/** Sleeps on main's count until a tick comes late, then pauses main and waits for it to tick again. */
function waitForStall(): void {
  let ticked = Date.now();

  for (;;) {
    const seen = Atomics.load(ticks, 0);

    if (Atomics.wait(ticks, 0, seen, STALLED_AFTER_MS) === "timed-out") break;

    ticked = Date.now();
  }

  stalled = { since: ticked, count: Atomics.load(ticks, 0) };
  caught = undefined;
  session.post("Debugger.pause");
  waitForTick();
}

/** Looks for main's next tick, on this thread's loop so the inspector's replies are read meanwhile, and tells main of the stall once it comes. */
function waitForTick(): void {
  if (stalled === undefined) return;

  if (Atomics.load(ticks, 0) === stalled.count) {
    setTimeout(waitForTick, MAIN_STALL.POLL_MS);

    return;
  }

  const stall: MainStall = { durationMs: Date.now() - stalled.since - tickMs, frames: caught };

  stalled = undefined;
  parentPort?.postMessage(stall);
  setImmediate(waitForStall);
}

session.connectToMainThread();

session.on("Debugger.scriptParsed", ({ params }) => {
  scripts.set(params.scriptId, params.url);
});

// Main is let go at once, its stack kept only where the pause landed while it still stood still.
session.on("Debugger.paused", ({ params }) => {
  const stillStalled = stalled !== undefined && Atomics.load(ticks, 0) === stalled.count;

  if (stillStalled) caught = stallFrames(params.callFrames, scripts);

  session.post("Debugger.resume");
});

session.post("Debugger.enable");

setImmediate(waitForStall);
