/**
 * offset-within.ts -- how far down a scroller's content an element stands, read from where each box is laid out, which no scroll or transform moves.
 */

/** How far down `element` stands from the box `ancestor` places it from, through every box placing it on the way; from the page where none does. */
function offsetTo(element: HTMLElement, ancestor: Element | null): number {
  let top = 0;
  let at: HTMLElement = element;

  for (;;) {
    top += at.offsetTop;
    const parent = at.offsetParent;

    if (!(parent instanceof HTMLElement) || parent === ancestor) return top;
    top += parent.clientTop;
    at = parent;
  }
}

/**
 * How far down the scroller's content `element` starts: read through the
 * boxes placing it up to the first that is the scroller or holds it, the
 * scroller's own place in that box taken off where it is not the scroller.
 * Note that a box placing the element may stand inside the scroller, as a
 * run of a list's rows does around each row, so the element's own offset
 * alone is not its place.
 */
export function offsetWithin(element: HTMLElement, scroller: HTMLElement): number {
  let holder = element.offsetParent;

  while (holder instanceof HTMLElement && holder !== scroller && !holder.contains(scroller)) {
    holder = holder.offsetParent;
  }

  return holder === scroller
    ? offsetTo(element, scroller)
    : offsetTo(element, holder) - offsetTo(scroller, holder) - scroller.clientTop;
}
