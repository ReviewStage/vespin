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
 * move kept at the ask leaves the window as it stood. A door that moves the
 * window nowhere the router sees, as the new workspace's screen, which has no
 * address, asks up front before it changes anything (`askUpFront`).
 *
 * A move along the router's history, the window's Back and Forward, a step
 * of their lists, Escape, and the mouse's own buttons, goes through one door
 * (`along`), because the router's history asks its blockers only of a push
 * or a replace: `@tanstack/history`'s `tryNavigation` passes a `go`, `back`,
 * or `forward` by, and its memory history, the desktop's, never asks of one,
 * while its browser history, the web's, asks of a browser's own Back and
 * Forward on their `popstate`. So `along` asks up front where its step
 * leaves the draft standing, and then moves past the blocker, so the web
 * asks no second time; a browser's own Back still asks through the blocker.
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
   * `landed` asks first, since what it changes may still leave the page; its
   * Leave lets go of the ask, unless the move `stays` where the window stands,
   * whose Leave leaves no page. `move` is told whether nothing holds it, so a
   * write past the router's blocker, as the history's visit, leaves no page
   * unasked only then.
   */
  readonly arrive: (move: (free: boolean) => void, landed: () => void) => void;
  /** Says the move under way stays where the window stands, as a door asking for the place already standing does (`places/routed-exits.ts`'s `stay`). */
  readonly stays: () => void;
  /**
   * Whether the move whose landing runs now said it `stays` where the window
   * stands, read from within `arrive`'s `landed`, so a landing that would
   * leave the place standing leaves it standing where its move asked for it;
   * false outside a landing.
   */
  readonly stayed: () => boolean;
  /**
   * Moves the window `delta` entries along its router's history, to the step
   * at the path `to`: first asking, while an ask stands, where that step
   * leaves the draft standing, whose Leave lets go of the ask, and then past
   * the router's blocker, since that step has asked already. The window
   * stands what the entry it lands on saved (`window-history.ts`).
   */
  readonly along: (delta: number, to: string) => void;
}

/** How `along` moves the router's history: past the blocker, since its own ask was made up front. */
const PAST_BLOCKER = { ignoreBlocker: true } as const;

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
  // Whether the move under way said it stays where the window stands, which a Leave of it then leaves nothing by.
  const stayed = useRef(false);
  // Whether the move whose landing runs now said it stays, which only a landing reads.
  const landingStays = useRef(false);
  // The moves the blocker was asked about and where the last one went, and what is done once a move held lands, by
  // where it goes, in the order the doors were made.
  const moves = useRef(0);
  const askedTo = useRef<string | undefined>(undefined);
  // The last move the blocker held, by its count.
  const heldMove = useRef(0);

  const landings = useRef<
    { readonly move: number; readonly to: string | undefined; readonly landed: () => void }[]
  >([]);

  // What the last ask made up front by a door that could not move first lets go on Leave.
  const waiting = useRef<(() => void)[]>([]);
  const heard = useRef(onStanding);
  heard.current = onStanding;
  const accessNow = useRef(access);
  accessNow.current = access;

  // Whether a move from the path `from` to the path `to` leaves the draft standing: another path, holding no one draft with it.
  const leavesDraft = useCallback(
    (from: string, to: string) =>
      from !== to &&
      !sameDraftAt(router.matchRoutes(from), router.matchRoutes(to), accessNow.current),
    [router],
  );

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

    // Lands what a move does once there, telling it whether the move stayed where the window stands.
    const land = (stays: boolean, landed: () => void) => {
      const outer = landingStays.current;
      landingStays.current = stays;

      try {
        landed();
      } finally {
        landingStays.current = outer;
      }
    };

    // A door that moves nowhere the router sees, as the new workspace's screen, which has no address, or a task the window
    // holds no address for yet, asks before it lands. Note that a Leave of a move that stays where the window stands
    // leaves no page, so the page's ask stands on; any other lets go of it, since its move may land only later, as a
    // task's once it is bound.
    const askUpFront = (ask: LeaveAsk, landed: () => void) => {
      const due = [landed];
      const stays = stayed.current;
      waiting.current = due;
      ask(() => {
        if (!stays) release(ask);
        pass(() =>
          land(stays, () => {
            for (const each of due) each();
          }),
        );
      }, NOTHING);
    };

    const place: PlaceLeave = {
      stand: (ask) => {
        standing.current = ask;
        setHeld(true);
        heard.current?.((leave) => ask(leave, NOTHING));

        // Note that an ask taken down while it stands was never answered, so the moves it held land only where the
        // question it still has out is answered Leave.
        return () => {
          if (standing.current === ask) landings.current = [];
          release(ask);
        };
      },
      pass,
      arrive: (move, landed) => {
        if (standing.current === undefined || passing.current) {
          stayed.current = false;
          move(true);
          land(stayed.current, landed);

          return;
        }

        // Note that the blocker is asked within the router's navigation, so a move that asked nothing navigated nowhere.
        const asked = moves.current;
        const waitingBefore = waiting.current;
        stayed.current = false;
        move(false);

        if (moves.current !== asked) {
          // Note that a move held while an earlier one waited takes its question, so only the later one is let go.
          const move = moves.current;

          const kept =
            heldMove.current === move
              ? landings.current.filter((each) => each.move === move)
              : landings.current;

          landings.current = [...kept, { move, to: askedTo.current, landed }];

          return;
        }

        // Note that a door within `move` that asked already holds this one too, since the page holds one question.
        if (waiting.current !== waitingBefore) {
          waiting.current.push(landed);

          return;
        }

        askUpFront(standing.current, landed);
      },
      stays: () => {
        stayed.current = true;
      },
      stayed: () => landingStays.current,
      along: (delta, to) => {
        if (delta === 0) return;
        const { history } = router;

        // Note that what the window wrote before it is flushed first, so the move counts from the entry it stands on.
        const go = () => {
          history.flush();
          history.go(delta, PAST_BLOCKER);
        };

        const ask = standing.current;

        if (ask === undefined || passing.current || !leavesDraft(history.location.pathname, to)) {
          go();

          return;
        }

        ask(() => {
          release(ask);
          go();
        }, NOTHING);
      },
    };

    return { place, release };
  }, [router, leavesDraft]);

  // A move asks while an ask stands, unless it is passed, stays on its address, or stays within one draft.
  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ current, next }) => {
      moves.current += 1;
      askedTo.current = next.pathname;

      if (standing.current === undefined || passing.current) return false;
      const held = leavesDraft(current.pathname, next.pathname);

      if (held) heldMove.current = moves.current;

      return held;
    },
    [leavesDraft],
  );

  const blocker = useBlocker({
    shouldBlockFn,
    withResolver: true,
    enableBeforeUnload: false,
    disabled: !held,
  });

  const { release } = doors;
  // A move held at the ask lands on the router's history, where what its door does once there follows it. Note that
  // any move settles every landing waiting, since one that went elsewhere means the move held never will.
  const { history } = router;
  useEffect(
    () =>
      history.subscribe(({ location }) => {
        const due = landings.current;
        landings.current = [];

        for (const { to, landed } of due) if (to === location.pathname) landed();
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

    // Note that Leave lands what this question held, though the page took its ask down while its question still stood
    // or the history wrote in place meanwhile, either of which lets the landings waiting go.
    const held = landings.current;
    ask(
      () => {
        release(ask);
        landings.current = held;
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
