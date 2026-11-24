/**
 * sliced-scheduler.ts -- an Effect scheduler whose rounds stay in the JS task they were asked in until a slice of it is spent, then wait one task, so what else waits on the thread runs between.
 */

import { Scheduler } from "effect";

/** A pause this long between two rounds means the thread did other work, or none, between them. */
const PAUSE_MS = 4;

/** How a sliced scheduler reads the time and hands its rounds to the event loop. */
export interface SliceSeams {
  /** The longest the rounds run in one task before the next waits for a task of its own. */
  readonly sliceMs: number;
  /** A monotonic clock, in milliseconds. */
  readonly now: () => number;
  /** Runs `run` among the current task's microtasks. */
  readonly microtask: (run: () => void) => void;
  /** Runs `run` in a task of its own, after whatever already waits, answering what cancels it. */
  readonly task: (run: () => void) => () => void;
}

/**
 * A scheduler that runs fibers' rounds as microtasks while the JS task they
 * run in has run them less than `sliceMs`, then hands the next round a task
 * of its own, which opens the next slice. Note that a round asked after the
 * thread paused opens a slice at once rather than waiting a task, so work a
 * native callback wakes starts in the callback's own task. Note that this is
 * for a runtime whose `setImmediate` is a microtask, as React Native's new
 * architecture makes it, where Effect's own scheduler never leaves the task
 * it began in, and a host's long work holds every render and timer behind it;
 * a task per round instead waits a timer each time, which stretched the same
 * work several times over.
 */
export function slicedScheduler(seams: SliceSeams): Scheduler.Scheduler {
  let sliceStart = Number.NEGATIVE_INFINITY;
  let roundEnded = Number.NEGATIVE_INFINITY;
  let inRound = false;

  const round = (run: () => void) => {
    inRound = true;

    try {
      run();
    } finally {
      inRound = false;
      roundEnded = seams.now();
    }
  };

  return new Scheduler.MixedScheduler("async", (run) => {
    const asked = seams.now();
    // Note that a round asked inside another is the same work going on, however long that round ran.
    const paused = !inRound && asked - roundEnded > PAUSE_MS;

    if (!paused && asked - sliceStart >= seams.sliceMs) {
      return seams.task(() => {
        sliceStart = seams.now();
        round(run);
      });
    }

    let canceled = false;

    seams.microtask(() => {
      if (canceled) return;
      const start = seams.now();

      if (start - roundEnded > PAUSE_MS) sliceStart = start;
      round(run);
    });

    return () => {
      canceled = true;
    };
  });
}
