/**
 * place-leave.ts -- the window's one ask before leaving a page that holds unsaved work, over TanStack Router's blocker.
 *
 * A page stands its ask for as long as it holds unsaved work (`stand`), and
 * every navigation the router makes while it stands asks first: a door's,
 * a link's, the window's own Back and Forward, and the browser's. The
 * blocker is `useBlocker` with its resolver, so the page draws the ask
 * itself, over its own confirm, and answers it: `leave` lets the move go,
 * `stay` keeps the window where it stands. A move within one draft, as
 * between an automation's setup and its runs, asks nothing, since it leaves
 * no page: whether two addresses hold one draft is their place's
 * declaration's answer (`routed-places.ts`'s `sameDraftAt`).
 *
 * The shell's own ways out, a window closed or reloaded and a browser tab
 * closed, hear the ask through `onStanding` (`AppPlatform.unsavedWork`), so
 * the router's own `beforeunload` is left off rather than asking a second time.
 *
 * A door that changes the window's state as well as moving it navigates
 * first and changes the rest once its move lands (`arrive`): at once where
 * nothing asks, after Leave where the move asks, and never after Stay, so a
 * move kept at the ask leaves the window as it stood.
 *
 * Transitional: a door that changes the window's state before it navigates
 * cannot be held by the router alone, because a blocked navigation leaves
 * what the door already changed. Each such door still asks up front through
 * `transitionalLeaveFirst` until it navigates first and lets its arrival
 * change the rest; the last one converted deletes it.
 */

import { type ShouldBlockFn, useBlocker, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouteAccess } from "../route-gates.js";
import { sameDraftAt } from "./routed-places.js";

/** Asks before the window leaves a page whose unsaved work would be lost: `leave` goes, `stay` keeps the window where it stands. */
export type LeaveAsk = (leave: () => void, stay: () => void) => void;

/** The ask as the shell hears it, which leaves the page by a way of its own. */
export type ShellLeaveAsk = (leave: () => void) => void;

/** The window's leave guard as a page and a door hold it. */
export interface PlaceLeave {
  /** Stands `ask` until the returned function takes it down. */
  readonly stand: (ask: LeaveAsk) => () => void;
  /** Takes a way out past the ask, as the page holding the work takes its own once it is saved or deleted. */
  readonly pass: (leave: () => void) => void;
  /**
   * Moves the window by `move`, router navigations, and does `landed` once the
   * move lands: at once where no ask stands or the move asks nothing, after
   * Leave where it asks, and never after Stay. Where `move` navigates nowhere
   * while an ask stands, as to a task the window holds no address for yet,
   * `landed` asks first, since what it changes may still leave the page.
   */
  readonly arrive: (move: () => void, landed: () => void) => void;
  /**
   * Transitional: a door that changes the window's state before it navigates,
   * asking first while an ask stands. Each door on it moves to a navigation
   * the router's blocker holds, and the last one deletes it.
   */
  readonly transitionalLeaveFirst: <Args extends readonly unknown[]>(
    leave: (...args: Args) => void,
  ) => (...args: Args) => void;
}

/** A way of answering that does nothing. */
const NOTHING = (): void => undefined;

/**
 * The window's one leave guard, made once where the window is. Note that
 * the ask standing and a pass under way are read through refs, because
 * the blocker reads them as the navigation is made, inside the press.
 *
 * Note that a leave once said to lets go of the ask that asked it, so a
 * door's later move, as a link's after its read lands, or the history's
 * following a Back it let go, asks no second time.
 */
export function usePlaceLeave(onStanding?: (ask: ShellLeaveAsk | undefined) => void): PlaceLeave {
  const router = useRouter();
  const access = useRouteAccess();
  const standing = useRef<LeaveAsk | undefined>(undefined);
  const passing = useRef(false);
  // The moves the blocker was asked about, and what is done once the move held lands, in the order the doors were made.
  const moves = useRef(0);
  const landings = useRef<(() => void)[]>([]);
  // What the last ask made up front by a door that could not move first lets go on Leave.
  const waiting = useRef<(() => void)[]>([]);
  const heard = useRef(onStanding);
  heard.current = onStanding;
  const accessNow = useRef(access);
  accessNow.current = access;
  // Whether an ask stands, which keeps the blocker on only while one does, since a blocker makes every move wait on it.
  const [held, setHeld] = useState(false);
  const doors = useMemo(() => {
    const release = (ask: LeaveAsk) => {
      if (standing.current !== ask) return;
      standing.current = undefined;
      setHeld(false);
      heard.current?.(undefined);
    };
    const pass = (leave: () => void) => {
      passing.current = true;
      try {
        leave();
      } finally {
        passing.current = false;
      }
    };
    const place: PlaceLeave = {
      stand: (ask) => {
        standing.current = ask;
        setHeld(true);
        heard.current?.((leave) => ask(leave, NOTHING));
        return () => release(ask);
      },
      pass,
      arrive: (move, landed) => {
        if (standing.current === undefined || passing.current) {
          move();
          landed();
          return;
        }
        // Note that the blocker is asked within the router's navigation, so a move that asked nothing navigated nowhere.
        const asked = moves.current;
        const waitingBefore = waiting.current;
        move();
        if (moves.current !== asked) {
          landings.current.push(landed);
          return;
        }
        // Note that a door within `move` that asked already holds this one too, since the page holds one question.
        if (waiting.current !== waitingBefore) {
          waiting.current.push(landed);
          return;
        }
        // A door that cannot move first, as to a task the window holds no address for yet, still asks before it acts.
        const ask = standing.current;
        const due = [landed];
        waiting.current = due;
        ask(() => {
          release(ask);
          pass(() => {
            for (const each of due) each();
          });
        }, NOTHING);
      },
      transitionalLeaveFirst:
        (leave) =>
        (...args) => {
          const ask = standing.current;
          if (ask === undefined || passing.current) {
            leave(...args);
            return;
          }
          ask(() => {
            release(ask);
            pass(() => leave(...args));
          }, NOTHING);
        },
    };
    return { place, release };
  }, []);
  // A move asks while an ask stands, unless it is passed, stays on its address, or stays within one draft.
  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ current, next }) => {
      moves.current += 1;
      if (standing.current === undefined || passing.current) return false;
      if (current.pathname === next.pathname) return false;
      return !sameDraftAt(
        router.matchRoutes(current.pathname),
        router.matchRoutes(next.pathname),
        accessNow.current,
      );
    },
    [router],
  );
  const blocker = useBlocker({
    shouldBlockFn,
    withResolver: true,
    enableBeforeUnload: false,
    disabled: !held,
  });
  const { release } = doors;
  // A move held at the ask lands on the router's history, where what its door does once there follows it.
  const { history } = router;
  useEffect(
    () =>
      history.subscribe(() => {
        const due = landings.current;
        landings.current = [];
        for (const landed of due) landed();
      }),
    [history],
  );
  useEffect(() => {
    if (blocker.status !== "blocked") return;
    const ask = standing.current;
    if (ask === undefined) {
      blocker.proceed();
      return;
    }
    ask(
      () => {
        release(ask);
        blocker.proceed();
      },
      () => {
        landings.current = [];
        blocker.reset();
      },
    );
  }, [blocker, release]);
  return doors.place;
}
