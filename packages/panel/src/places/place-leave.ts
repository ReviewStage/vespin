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
  useEffect(() => {
    if (blocker.status !== "blocked") return;
    const ask = standing.current;
    if (ask === undefined) {
      blocker.proceed();
      return;
    }
    ask(() => {
      release(ask);
      blocker.proceed();
    }, blocker.reset);
  }, [blocker, release]);
  return doors.place;
}
