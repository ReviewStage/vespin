import { useLayoutEffect, useReducer, useRef } from "react";

/**
 * use-held-order.ts -- a list's rows held in the places they were first
 * drawn in while the list is in sight, so the row the reader is on stays
 * where it is.
 *
 * While the list is shown and drawn under the same view (`sameOrder`: its
 * grouping, its order, and whatever filters it), every row it drew keeps
 * the place it was first drawn in, as the caller reads a place
 * (`placesOf`), so an update that would sort it elsewhere moves nothing.
 * Hidden, or drawn under another view, it is drawn again where each row
 * stands now; a list kept drawn while hidden (React's `Activity`) lets its
 * places go as its effects are taken down, as one unmounted would. A row
 * the list no longer draws lets its place go, so once it is drawn again it
 * stands where it is then, and a row it never drew stands where it is now.
 * The caller draws from the places it is handed (`draw`), each row with
 * none where it stands now; a row the reader's own press moved is one whose
 * place the caller takes anew (`placesOf`), so it moves at once.
 *
 * A list the pointer holds (`usePointerHold`) holds its rows only while the
 * pointer stands over it, which it reads as it draws rather than drawing for:
 * the pointer coming and going draws nothing, since the rows on screen are
 * where they were drawn, unless a draw while it stood held a row back, which
 * its leaving draws again where each row stands now.
 */

/** No row's place held: every row stands where it is now. */
const NO_PLACES: ReadonlyMap<string, never> = new Map<string, never>();

/** The list last drawn in sight: the view it was drawn under and where each of its rows stands, by row. */
interface Held<V, P> {
  readonly view: V;
  readonly places: ReadonlyMap<string, P>;
}

/** How a list held still is drawn: when a view keeps its order, how the rows are drawn from the places held, and where each drawn row stands. */
export interface HeldOrder<V, P, L> {
  /** Whether a list drawn under one view stands its rows as it would under another. */
  readonly sameOrder: (was: V, now: V) => boolean;
  /** The list drawn from the places held, each other row where it stands now; `was` is the view the list was last drawn under in sight, none where it was hidden. */
  readonly draw: (places: ReadonlyMap<string, P>, was: V | undefined) => L;
  /** Where each row the list drew stands, the place held for it kept where it has one and its own press did not move it. */
  readonly placesOf: (drawn: L, held: ReadonlyMap<string, P>) => ReadonlyMap<string, P>;
}

/** A hold the pointer keeps on a list while it stands over it, its doors handed to the box the pointer comes over. */
export interface PointerHold {
  /** Whether the pointer stands over the list, read as the list draws. */
  readonly over: React.RefObject<boolean>;
  /** Whether the list on screen was drawn with a row held back, which the pointer leaving draws again. */
  readonly heldBack: React.RefObject<boolean>;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
}

/**
 * The hold the pointer keeps on a list, handed to `useHeldOrder` and its
 * doors to the list's box. Note that the pointer is kept in a ref rather
 * than state, because a pointer crossing the list's edge must not draw the
 * list and every row in it again; only its leaving a list drawn with a row
 * held back draws it, to let that row go.
 */
export function usePointerHold(): PointerHold {
  const over = useRef(false);
  const heldBack = useRef(false);
  const [, letGo] = useReducer((draws: number) => draws + 1, 0);

  return {
    over,
    heldBack,
    onPointerEnter: () => {
      over.current = true;
    },
    onPointerLeave: () => {
      over.current = false;

      if (heldBack.current) letGo();
    },
  };
}

/** The list drawn under `view`, its rows held still as the module's head says while `shown`, and while the pointer stands over it where `pointer` holds it. */
export function useHeldOrder<V, P, L>(
  view: V,
  shown: boolean,
  order: HeldOrder<V, P, L>,
  pointer?: PointerHold,
): L {
  const held = useRef<Held<V, P> | undefined>(undefined);
  const holding = shown && (pointer === undefined || pointer.over.current);
  const last = holding ? held.current : undefined;
  const places = last !== undefined && order.sameOrder(last.view, view) ? last.places : NO_PLACES;
  const drawn = order.draw(places, last?.view);
  // Note that what was drawn is held once it is on screen, so a render React drops holds nothing,
  // and held while the pointer is away too, so the pointer coming holds the rows as they are on screen.
  useLayoutEffect(() => {
    held.current = shown ? { view, places: order.placesOf(drawn, places) } : undefined;

    if (pointer !== undefined) pointer.heldBack.current = places.size > 0;

    return () => {
      held.current = undefined;
    };
  });

  return drawn;
}
