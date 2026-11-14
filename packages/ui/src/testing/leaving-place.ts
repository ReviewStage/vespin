/**
 * leaving-place.ts -- where a row `ListMotion` takes out of the layout stands, read as list-motion.css lays it out, for a test's layout given, since jsdom reads no stylesheet.
 *
 * A leaving row is laid over its place by the motion's own properties while
 * its exit plays (`data-leaving="placed"`), or gone at once
 * (`data-leaving="gone"`); any other row stands where its own layout puts it.
 */

/** A leaving row's place in its list, in CSS pixels; none for a row the motion does not lay out. */
export interface LeavingPlace {
  readonly top: number;
  readonly left: number;
}

/** Where `element` stands as it leaves: laid over its place, or nowhere where it is gone; none for an element not leaving or not yet placed. */
export function leavingPlace(element: Element): LeavingPlace | "gone" | undefined {
  if (!(element instanceof HTMLElement)) return undefined;
  const leaving = element.getAttribute("data-leaving");

  if (leaving === "gone") return "gone";

  if (leaving !== "placed") return undefined;
  const at = (property: string) => Number.parseFloat(element.style.getPropertyValue(property));

  return { top: at("--ui-leaving-top"), left: at("--ui-leaving-left") };
}
