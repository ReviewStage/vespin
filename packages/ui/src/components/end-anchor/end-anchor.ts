/**
 * end-anchor.ts -- keeps a log at its end from the moment it opens until the reader scrolls away, whatever else moves.
 *
 * A log, an agent's transcript or a chat, opens on its newest line and keeps
 * to it as lines land and grow, until the reader scrolls up; it goes back to
 * keeping to it once the reader scrolls to its end again or asks to
 * (`stick`). Whether it keeps to its end is a state the reader sets, never a
 * distance from the end: a log stuck to its end is put back at it whatever
 * moved it, and a log the reader scrolled away from is never moved by the
 * anchor at all.
 *
 * It is the model mature chat logs converge on, `use-stick-to-bottom`'s
 * among them: a stuck flag, true as the log opens; only the reader's own
 * input clears it; and while it stands, every change of size, the scroller's
 * own or anything inside it, takes the log back to its end, read from the
 * page at that moment, with no window after which it stops. Note three
 * differences from that library, each a way its users found it lose the
 * end or the reader:
 *
 * - The reader is heard by their input, never guessed from a scroll's
 *   direction: a wheel turned up, a finger dragging the lines down, a key
 *   that scrolls, or a press held on the scroller (its scroll bar, or a
 *   selection dragged past its edge) while the log moves up. So a scroll the
 *   reader did not make (a virtualizer correcting its rows, the browser
 *   clamping a scroll, a router restoring a place it kept) never lets go of
 *   the end, and a log stuck to it is taken back there.
 * - The size heard is the scroller's as well as what it holds, so a box
 *   that shrinks under a phone's keyboard or a growing composer keeps its
 *   newest line.
 * - The log is moved through the caller's `toEnd` where it has one, so a
 *   virtualizer that writes the scroller's position itself
 *   (`@repo/ui/virtual-rows`) stays its one writer.
 *
 * What the log itself scrolls to away from its end, as a link to one of its
 * lines does, lets go first (`release`).
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** How near its end, in pixels, a log the reader scrolled counts as having reached it again: the rounding of a scroll that did. */
const END_PX = 2;

/** The keys that scroll a box the reader is in, each of which says the scroll after it is the reader's. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Tab",
]);

/** How far, in pixels, a box stands above its end. */
function gapOf(box: HTMLElement): number {
  return box.scrollHeight - box.clientHeight - box.scrollTop;
}

/** Takes a box to its end itself, where the caller scrolls it no way of its own. */
function boxToEnd(box: HTMLElement): void {
  box.scrollTop = box.scrollHeight - box.clientHeight;
}

/** What a log anchored to its end answers its caller. */
export interface EndAnchor {
  /** Whether the log keeps to its end, as the way back to its newest line asks. */
  readonly stuck: boolean;
  /** Takes the log to its end and keeps it there, as a press on the way back or a line the reader sent does. */
  readonly stick: () => void;
  /** Lets go of the end before the log is scrolled elsewhere for the reader, as a link to one of its lines scrolls it. */
  readonly release: () => void;
}

/**
 * Anchors the log `scroller` scrolls to its end, as this file's header
 * says: `content` is what it holds, heard as it grows and shrinks; `toEnd`
 * takes it to its end and answers whether it could, the box's own scroll
 * taking it there where it could not or none is handed.
 */
export function useEndAnchor({
  scroller,
  content,
  toEnd,
}: {
  scroller: RefObject<HTMLElement | null>;
  content: RefObject<HTMLElement | null>;
  toEnd?: (() => boolean) | undefined;
}): EndAnchor {
  const [stuck, setStuck] = useState(true);
  const held = useRef(true);
  const moveTo = useRef(toEnd);
  moveTo.current = toEnd;

  const hold = useCallback((at: boolean) => {
    held.current = at;
    setStuck(at);
  }, []);

  const pin = useCallback(() => {
    const box = scroller.current;

    if (box === null || box.clientHeight === 0 || gapOf(box) <= 0) return;

    if (moveTo.current?.() !== true) boxToEnd(box);
  }, [scroller]);

  const stick = useCallback(() => {
    hold(true);
    pin();
  }, [hold, pin]);

  const release = useCallback(() => hold(false), [hold]);

  // Every change of size, the box's own or what it holds, takes a log stuck to its end back to it; the first, as each is first heard, opens it there.
  useEffect(() => {
    const box = scroller.current;

    if (box === null) return undefined;

    const heard = new ResizeObserver(() => {
      if (held.current) pin();
    });

    // Note that what it holds is heard by its border box, so its padding growing, as room at its end does, moves the end too.
    heard.observe(box);
    const inside = content.current;

    if (inside !== null) heard.observe(inside, { box: "border-box" });

    return () => heard.disconnect();
  }, [scroller, content, pin]);

  // The reader's input, and the scrolls it makes, let go of the end or reach it again; any other scroll off the end is undone while the log is stuck.
  useEffect(() => {
    const box = scroller.current;

    if (box === null) return undefined;
    let last = box.scrollTop;
    let touchY: number | undefined;
    let pressed = false;
    let keyed = false;

    const away = () => {
      if (held.current) hold(false);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && box.scrollHeight > box.clientHeight) away();
    };

    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };

    // Note that a finger moving down the screen scrolls the lines up, away from the end.
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;

      if (touchY !== undefined && y !== undefined && y > touchY) away();
      touchY = y;
    };

    const onTouchEnd = () => {
      touchY = undefined;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) pressed = true;
    };

    const onPointerUp = () => {
      pressed = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) keyed = true;
    };

    const onKeyUp = () => {
      keyed = false;
    };

    // Note that a scroll made while the reader's finger, press, or key drives it is theirs; any other that leaves the end of a log stuck to it is undone.
    const onScroll = () => {
      const top = box.scrollTop;
      const up = top < last;
      last = top;
      const reading = pressed || keyed || touchY !== undefined;

      if (reading && up) away();

      if (gapOf(box) <= END_PX) {
        if (!held.current) hold(true);
      } else if (held.current && !reading) {
        pin();
      }
    };

    box.addEventListener("wheel", onWheel, { passive: true });
    box.addEventListener("touchstart", onTouchStart, { passive: true });
    box.addEventListener("touchmove", onTouchMove, { passive: true });
    box.addEventListener("touchend", onTouchEnd, { passive: true });
    box.addEventListener("pointerdown", onPointerDown);
    box.addEventListener("keydown", onKeyDown);
    box.addEventListener("keyup", onKeyUp);
    box.addEventListener("scroll", onScroll, { passive: true });
    globalThis.addEventListener("pointerup", onPointerUp);
    globalThis.addEventListener("pointercancel", onPointerUp);

    return () => {
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("touchstart", onTouchStart);
      box.removeEventListener("touchmove", onTouchMove);
      box.removeEventListener("touchend", onTouchEnd);
      box.removeEventListener("pointerdown", onPointerDown);
      box.removeEventListener("keydown", onKeyDown);
      box.removeEventListener("keyup", onKeyUp);
      box.removeEventListener("scroll", onScroll);
      globalThis.removeEventListener("pointerup", onPointerUp);
      globalThis.removeEventListener("pointercancel", onPointerUp);
    };
  }, [scroller, hold, pin]);

  return { stuck, stick, release };
}
