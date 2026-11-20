/**
 * wait.ts -- how a timer runs in `@repo/ui` and `@repo/panel`: an Effect forked at an edge, owned by whoever needs it, writing a TanStack `Store` where it yields a value.
 *
 * This is the seam every timer goes through, so the rules a reader needs
 * are here:
 *
 * - The work is an Effect, forked at a runtime edge: `@repo/ui`'s
 *   (`ui-runtime.ts`'s `forkEffect`) by default, or one the caller hands as
 *   `fork`, as `@repo/panel` hands `rendererFork`. Nothing arms a
 *   `setTimeout` or a `setInterval`, and a test hands the edge a `TestClock`
 *   (`@repo/ui/testing/effect-services`) to move it.
 * - A value the work yields lives in a plain TanStack `Store`, written with
 *   `setState` (`streamInto` writes each value a stream emits) and read with
 *   `useSelector(store, selector)`, as TanStack Store's quick start shows
 *   (https://tanstack.com/store/latest/docs/framework/react/quick-start).
 *   Store 0.11 has no subscribe lifecycle hooks, so a store never starts or
 *   stops its own work: its owner does.
 * - The owner is whoever needs the work to run, and its life is the work's.
 *   A component owns it from a `useEffect`, forking on mount or as its deps
 *   change and interrupting in the cleanup. A value many components read
 *   (the clock's ticks, `components/time/time-clock.ts`) is owned by one
 *   component the window mounts once. Work that must outlive the component
 *   that asked for it, such as a toast's life or a draft's write, is owned
 *   by its module.
 * - A one-off wait (a hint's rest, a copy's hold, a pane's exit) holds no
 *   value, so it is no store: it is a `Wait`, which runs one Effect at a
 *   time, each `start` interrupting the last. `createWait` makes one a module
 *   holds for the whole window, and `useWait` makes one a component holds
 *   and interrupts as it leaves. A family of waits, one per id, is a `Map`
 *   of them keyed by the id itself.
 * - A rest on one of many things a pointer crosses (a sidebar's rows) is a
 *   `Rest`, not a `Wait` restarted at every one: the pointer moving only
 *   re-aims it, and one fiber sleeps until the last thing aimed at has
 *   stood aimed for the whole span, so a sweep across a list forks once
 *   rather than once a row.
 */

import type { Store } from "@tanstack/react-store";
import { Clock, Context, Duration, Effect, Stream } from "effect";
import { useEffect, useRef, useState } from "react";
import { effectServices, forkEffect } from "./ui-runtime.js";

/** Runs an Effect as a fiber of its own at an edge and answers the way to interrupt it. */
export type ForkEffect = (effect: Effect.Effect<void>) => () => void;

/** The work of writing each value `stream` emits into `store` as it lands. */
export function streamInto<A>(stream: Stream.Stream<A>, store: Store<A>): Effect.Effect<void> {
  return Stream.runForEach(stream, (value) => Effect.sync(() => store.setState(() => value)));
}

/** One wait at a time: `start` runs an Effect, interrupting the one before, and `stop` interrupts whichever runs. */
export interface Wait {
  readonly start: (effect: Effect.Effect<void>) => void;
  readonly stop: () => void;
}

/** A wait its maker holds, a module for the whole window among them, so a wait begun anywhere calls off the one before. */
export function createWait(fork: ForkEffect = forkEffect): Wait {
  let running: (() => void) | undefined;

  const stop = () => {
    running?.();
    running = undefined;
  };

  return {
    start: (effect) => {
      stop();
      running = fork(effect);
    },
    stop,
  };
}

/** A wait a component holds, the same one across its renders, interrupted as it leaves. */
export function useWait(fork?: ForkEffect): Wait {
  const [wait] = useState(() => createWait(fork));
  useEffect(() => wait.stop, [wait]);

  return wait;
}

/** A rest re-aimed as the pointer moves: `aim` names what it rests on now, or none to call it off. */
export interface Rest<A> {
  readonly aim: (subject: A | undefined) => void;
  readonly stop: () => void;
}

/**
 * A rest that lands `subject` once it has stood aimed at it for `span`, on
 * `@repo/ui`'s edge, whose clock both the aim and the fiber read.
 *
 * Note that an aim forks nothing while the fiber sleeps: it notes the
 * subject and the time, and the fiber, waking, sleeps again for what is
 * left of the span from the last aim, so it lands exactly a span after the
 * pointer came to rest. Calling it off leaves the fiber to wake and end on
 * its own, because a pointer leaving one row is entering the next.
 */
export function createRest<A>(span: Duration.Input, land: (subject: A) => void): Rest<A> {
  const spanMillis = Duration.toMillis(span);
  let aimed: { readonly subject: A; readonly at: number } | undefined;
  // The fork sleeping now, by its count, so only its own end lets it go, and one that ends before its fork answers leaves none.
  let forks = 0;
  let sleeping: number | undefined;
  let interrupt: (() => void) | undefined;

  const settle = Effect.gen(function* () {
    for (let resting = aimed; resting !== undefined; resting = aimed) {
      const left = resting.at + spanMillis - (yield* Clock.currentTimeMillis);

      if (left <= 0) {
        aimed = undefined;
        land(resting.subject);

        return;
      }

      yield* Effect.sleep(left);
    }
  });

  return {
    aim: (subject) => {
      aimed =
        subject === undefined
          ? undefined
          : {
              subject,
              at: Context.get(effectServices.state, Clock.Clock).currentTimeMillisUnsafe(),
            };

      if (aimed === undefined || sleeping !== undefined) return;
      forks += 1;
      const own = forks;
      sleeping = own;
      interrupt = forkEffect(
        Effect.ensuring(
          settle,
          Effect.sync(() => {
            if (sleeping === own) sleeping = undefined;
          }),
        ),
      );
    },
    stop: () => {
      aimed = undefined;
      sleeping = undefined;
      interrupt?.();
      interrupt = undefined;
    },
  };
}

/** A rest a component holds, the same one across its renders, landing on its latest `land` and called off as it leaves. */
export function useRest<A>(span: Duration.Input, land: (subject: A) => void): Rest<A> {
  const landing = useRef(land);
  landing.current = land;
  const [rest] = useState(() => createRest<A>(span, (subject) => landing.current(subject)));
  useEffect(() => rest.stop, [rest]);

  return rest;
}
