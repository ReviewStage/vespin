import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { MOTION_TOKEN, tokenTiming } from "../../motion-timing.js";
import { ANNOUNCE, Announcer, useAnnounce } from "../announcer/announcer.js";

/**
 * toast-stack.tsx -- the toasts standing, in the window's bottom-right corner, and the window's `Announcer` that says them.
 *
 * The stack is a landmark over whatever docks at the window's foot, taking no
 * pointer itself, so only a toast with something to press stands in the way
 * of what is under it. Each toast a change moves glides from where it was
 * drawn to where it now stands, on the spring small elements ride, read from
 * the tokens at the stack so reduced motion and a capture run play nothing.
 *
 * What each toast says reaches assistive tech through the window's one pair
 * of live regions, the `Announcer` the stack mounts beside it, since the
 * host mounts the stack with the window rather than with any toast: what was
 * done or is asked politely, and what was refused as an alert, each said
 * once the words the host hands it change. Where the stack mounts (a portal
 * to the body, say) is the host's.
 */

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/**
 * How far a toast's top stands above the stack's foot as laid out, which no
 * transform moves: neither its own arrival nor a glide still playing, so a
 * redraw that moved nothing reads the same rise however far either has run.
 * The foot is where the stack is pinned, so a toast added under another
 * raises that one's rise as the stack grows upward.
 */
function riseOf(list: HTMLElement, toast: HTMLElement): number {
  // Note that a toast's offset is the list's own where the list is positioned, and their shared parent's where it is not.
  const top = toast.offsetParent === list ? toast.offsetTop : toast.offsetTop - list.offsetTop;
  return list.offsetHeight - top;
}

/**
 * Glides each toast a change moved from where it was drawn to where it now
 * stands. Note that it starts from where the toast shows on screen this
 * frame, its arrival or an earlier glide included, so a move made mid-motion
 * carries on from there rather than jumping back to where it was laid out.
 */
function useStackGlide(): RefObject<HTMLOListElement | null> {
  const list = useRef<HTMLOListElement>(null);
  const drawn = useRef(new Map<Element, number>());
  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
    // Note that an empty stack, as it stands nearly always, reads nothing: reading the tokens or a box lays out the whole window, and the stack is drawn again with everything around it.
    if (root.children.length === 0) {
      if (drawn.current.size > 0) drawn.current = new Map();
      return;
    }
    const timing = tokenTiming(root, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST);
    const next = new Map<Element, number>();
    const foot = root.getBoundingClientRect().bottom;
    for (const toast of root.children) {
      if (!(toast instanceof HTMLElement)) continue;
      const rise = riseOf(root, toast);
      const was = drawn.current.get(toast);
      next.set(toast, rise);
      if (was === undefined || Math.abs(rise - was) < STILL || timing === undefined) continue;
      // Where it shows now, against where it is laid out, then back by as far as the change moved it.
      const shown = toast.getBoundingClientRect().top - (foot - rise);
      const from = shown + rise - was;
      toast.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], timing);
    }
    drawn.current = next;
  });
  return list;
}

/** The stack, named as a landmark, its toasts oldest first, and the window's `Announcer`, told what the newest toasts say. */
export function ToastStack({
  label,
  polite,
  alert,
  children,
}: {
  /** What the stack is called, as a landmark among the window's regions. */
  label: string;
  /** What the polite region says: what was done or is asked, or nothing. */
  polite: string;
  /** What the alert region says: what was refused, or nothing. */
  alert: string;
  /** The toasts, each a `Toast`, oldest first. */
  children: ReactNode;
}): React.JSX.Element {
  const list = useStackGlide();
  useAnnounce(ANNOUNCE.POLITE, polite);
  useAnnounce(ANNOUNCE.ALERT, alert);
  return (
    <>
      <section className="ui-toast-stack pointer-events-none fixed z-toast" aria-label={label}>
        <ol ref={list} className="m-0 flex list-none flex-col gap-toast-gap p-0">
          {children}
        </ol>
      </section>
      <Announcer />
    </>
  );
}
