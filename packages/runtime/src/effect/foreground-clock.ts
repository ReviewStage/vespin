/**
 * foreground-clock.ts -- time the app has stood in front, which stops while the system suspends it: the one clock every deadline of the host and the app is measured on.
 *
 * A deadline stands for time in which something could have happened: an
 * answer heard, a screen drawn, a beat said. Time the app spent suspended
 * holds none of that, so a deadline measured across it judges a wait nobody
 * sat through, as a return from the background taken for a stalled sync id
 * did (`@repo/host`'s `live-follow.ts`). So each such deadline is an instant
 * on this clock (`ForegroundMillis`), which a wall-clock or monotonic time
 * never is, since the brand keeps a plain number out.
 *
 * A runtime's monotonic time already stands still while its machine sleeps
 * (a Mac's `mach_absolute_time`, Linux's `CLOCK_MONOTONIC`), so it is this
 * clock wherever the process is not suspended on its own, and is the clock
 * a host reads where its platform hands it none (`ForegroundClock`'s
 * default). iOS suspends an app in the background while the device runs on,
 * so the app's clock (`foregroundClockOver`) is also stopped from the moment
 * the app goes behind (`away`) to the moment it is active again (`back`).
 */

import { Brand, Context, Duration } from "effect";

/** An instant on the foreground clock, in milliseconds from the clock's own origin. */
export type ForegroundMillis = number & Brand.Brand<"ForegroundMillis">;

const foregroundMillis = Brand.nominal<ForegroundMillis>();

/** Time the app has stood in front, and whether it runs now. */
export interface ForegroundClock {
  /** The instant now. */
  now(): ForegroundMillis;
  /** Whether the clock runs, which it does while the app stands in front. */
  running(): boolean;
  /** Hears the clock run again after it stood still; the stop handed back lets go. */
  onRunning(listener: () => void): () => void;
}

/** A foreground clock its platform stops as the app goes behind and starts as it comes back. */
export interface StoppingForegroundClock extends ForegroundClock {
  /** Stops the clock, the app having gone behind; nothing where it stands still already. */
  away(): void;
  /** Runs the clock again, the app being active; nothing where it runs already. */
  back(): void;
}

/**
 * A foreground clock over `monotonic`, a time in milliseconds that never
 * goes back, which stands still from each `away` to the `back` after it,
 * and starts standing still where the app is not in front (`front`).
 */
export function foregroundClockOver(
  monotonic: () => number,
  front: boolean,
): StoppingForegroundClock {
  /** How long the clock has stood still in all, by `monotonic`, before the stop it stands in now. */
  let stood = 0;
  /** When the clock stopped, by `monotonic`; none while it runs. */
  let stoppedAt: number | undefined = front ? undefined : monotonic();
  const listeners = new Set<() => void>();

  return {
    now: () => foregroundMillis((stoppedAt ?? monotonic()) - stood),
    running: () => stoppedAt === undefined,
    onRunning: (listener) => {
      listeners.add(listener);

      return () => void listeners.delete(listener);
    },
    away: () => {
      stoppedAt ??= monotonic();
    },
    back: () => {
      if (stoppedAt === undefined) return;
      stood += monotonic() - stoppedAt;
      stoppedAt = undefined;

      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * The foreground clock a host measures its deadlines on: the one its
 * platform hands it, or, where it is handed none, the runtime's monotonic
 * time, which stands still while the machine sleeps and never otherwise.
 */
export const ForegroundClock = Context.Reference<ForegroundClock>("@repo/runtime/ForegroundClock", {
  defaultValue: () => foregroundClockOver(() => performance.now(), true),
});

/** The instant `duration` of foreground time after `at`. */
export function foregroundAfter(at: ForegroundMillis, duration: Duration.Input): ForegroundMillis {
  return foregroundMillis(at + Duration.toMillis(duration));
}

/** Whether `clock` stands past `deadline`. */
export function foregroundPassed(clock: ForegroundClock, deadline: ForegroundMillis): boolean {
  return clock.now() > deadline;
}

/**
 * Calls `then` once, as `clock` reaches `deadline`; the stop handed back
 * keeps it from being called. Note that the wait is armed only while the
 * clock runs and armed again where it ends short of the deadline, because a
 * timer runs on while the app is behind and the clock does not.
 */
export function atForeground(
  clock: ForegroundClock,
  deadline: ForegroundMillis,
  then: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unheard: () => void = () => undefined;

  const wait = (): void => {
    if (!clock.running()) {
      unheard = clock.onRunning(() => {
        unheard();
        wait();
      });

      return;
    }

    timer = setTimeout(
      () => (clock.now() >= deadline ? then() : wait()),
      Math.max(0, deadline - clock.now()),
    );
  };

  wait();

  return () => {
    clearTimeout(timer);
    unheard();
  };
}

/** Calls `then` each time `every` of foreground time passes on `clock`, from now; the stop handed back ends it. */
export function everyForeground(
  clock: ForegroundClock,
  every: Duration.Input,
  then: () => void,
): () => void {
  let stop: () => void = () => undefined;

  const next = () => {
    stop = atForeground(clock, foregroundAfter(clock.now(), every), () => {
      then();
      next();
    });
  };

  next();

  return () => stop();
}
