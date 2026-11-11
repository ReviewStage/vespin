import { Schema as EffectSchema } from "effect";

/**
 * page-zoom.ts -- how large a plan's page is drawn in its tab: the sizes it steps between, a pinch's change to it, the script that draws the page at it, and the messages the side panel and the frame pass to drive it.
 *
 * A page is drawn in a frame with an opaque origin, so nothing in the panel
 * reaches its document to scale it. Every server of a page therefore answers
 * it with one more script of our own ahead of the agent's HTML
 * (`withPageScripts`), which draws the page at whatever size the panel
 * hands it, as CSS `zoom` on its root, so the page lays out again at that
 * size as a browser's own zoom does rather than being magnified as a
 * picture. Every box the page's scripts read comes back on the screen's
 * scale, so the pins comments stand over the page by keep their places.
 *
 * The size is the panel's, held by the page's tab, so a reload or another
 * version is drawn at it too: the script asks for it as the page is read,
 * and the panel answers and sends it again whenever it changes. The script
 * hands the panel ⌘+, ⌘−, and ⌘0 pressed in the page, and a pinch (a wheel
 * turned with Control held, as every browser reports a trackpad's pinch),
 * which would otherwise zoom the whole window or nothing at all.
 * The script runs among the page's own, so whatever the frame posts is the
 * page's word, not ours: the panel takes a message only from the frame it
 * drew and only in the shape below, and all it can ask is a size for its
 * own page, held within the bounds below.
 */

/** The mark every message of the zoom wears, setting it apart from whatever else the page posts. */
const PAGE_ZOOM_TYPE = "app-page-zoom";

/** Which way a press asks the size to go. */
export const PAGE_ZOOM_KEY = {
  IN: "in",
  OUT: "out",
  ACTUAL: "actual",
} as const;

export type PageZoomKey = (typeof PAGE_ZOOM_KEY)[keyof typeof PAGE_ZOOM_KEY];

/** The size a page is drawn at untouched. */
export const PAGE_ZOOM_ACTUAL = 1;

/** The smallest and largest sizes, as factors: Chrome's own bounds but for its extremes. */
const PAGE_ZOOM_MIN = 0.5;
const PAGE_ZOOM_MAX = 3;

/** The sizes the keys and the menu step between, smallest first: Chrome's steps between the bounds. */
const PAGE_ZOOM_STEPS = [
  PAGE_ZOOM_MIN,
  0.67,
  0.75,
  0.8,
  0.9,
  PAGE_ZOOM_ACTUAL,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  PAGE_ZOOM_MAX,
] as const;

/** The most of a wheel's turn one event counts, so a mouse wheel's notch steps about as far as a pinch's motion rather than leaping. */
const PINCH_DELTA_LIMIT = 10;

/** How far a wheel's turn of one pixel scales the page: a pinch's change compounds, so in and out by the same motion land where they began. */
const PINCH_RATE = 0.01;

/** A message the panel posts to the frame: draw the page at this size. */
export interface PageZoomTell {
  readonly type: typeof PAGE_ZOOM_TYPE;
  readonly zoom: number;
}

/** A message the frame posts to the panel: the page asking its size, a zoom key pressed in it, or a pinch's turn. */
export const pageZoomAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_ZOOM_TYPE),
    ask: EffectSchema.Literal(true),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_ZOOM_TYPE),
    key: EffectSchema.Literals(Object.values(PAGE_ZOOM_KEY)),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_ZOOM_TYPE),
    pinch: EffectSchema.Finite.check(
      EffectSchema.isGreaterThanOrEqualTo(-PINCH_DELTA_LIMIT),
      EffectSchema.isLessThanOrEqualTo(PINCH_DELTA_LIMIT),
    ),
  }),
]);

/** The message that draws the page at `zoom`. */
export function pageZoomTell(zoom: number): PageZoomTell {
  return { type: PAGE_ZOOM_TYPE, zoom };
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, PAGE_ZOOM_MIN), PAGE_ZOOM_MAX);
}

/**
 * The size a press asks for from `zoom`: the next step above or below it, so
 * a size a pinch left between steps goes to the nearest step that way, held
 * at the smallest and the largest; or the actual size.
 */
export function pageZoomAfter(zoom: number, key: PageZoomKey): number {
  if (key === PAGE_ZOOM_KEY.ACTUAL) return PAGE_ZOOM_ACTUAL;
  // Note that a step a hair from `zoom` is `zoom` itself, so float drift never leaves a press standing still.
  const near = 0.001;
  if (key === PAGE_ZOOM_KEY.IN)
    return PAGE_ZOOM_STEPS.find((step) => step > zoom + near) ?? PAGE_ZOOM_MAX;
  return PAGE_ZOOM_STEPS.findLast((step) => step < zoom - near) ?? PAGE_ZOOM_MIN;
}

/** The size a pinch's turn of `delta` leaves `zoom` at, a turn toward the reader (negative, as a pinch outward reports) drawing larger. */
export function pageZoomPinched(zoom: number, delta: number): number {
  return clampZoom(zoom * Math.exp(-delta * PINCH_RATE));
}

/** Whether a press of `key` would change `zoom`, which the menu dims an item by. */
export function pageZoomMoves(zoom: number, key: PageZoomKey): boolean {
  return pageZoomAfter(zoom, key) !== zoom;
}

/** The size as a person reads it: a whole percentage. */
export function pageZoomWords(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * The script the frame runs, ahead of the page's own. It is plain JavaScript
 * in a string because it runs in the page, apart from every bundle of ours.
 * It asks the panel for the size as the page is read and draws the page at
 * each size the panel alone sends, within the bounds, keeping the place the
 * page is scrolled to as its length scales. It hands on ⌘+ (or ⌘=), ⌘−, and
 * ⌘0, with Control in place of Command as other systems press them, and each
 * Control-held wheel event, held to a turn's limit, and claims each so
 * neither the window nor the browser zooms as well.
 */
export const PAGE_ZOOM_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_ZOOM_TYPE)};
  const MIN = ${PAGE_ZOOM_MIN};
  const MAX = ${PAGE_ZOOM_MAX};
  const LIMIT = ${PINCH_DELTA_LIMIT};
  const KEYS = { "=": ${JSON.stringify(PAGE_ZOOM_KEY.IN)}, "+": ${JSON.stringify(PAGE_ZOOM_KEY.IN)}, "-": ${JSON.stringify(PAGE_ZOOM_KEY.OUT)}, "0": ${JSON.stringify(PAGE_ZOOM_KEY.ACTUAL)} };
  let zoom = 1;

  const post = (message) => parent.postMessage(Object.assign({ type: TYPE }, message), "*");

  const draw = (next) => {
    if (typeof next !== "number" || !(next >= MIN && next <= MAX) || next === zoom) return;
    const ratio = next / zoom;
    const x = scrollX;
    const y = scrollY;
    zoom = next;
    document.documentElement.style.zoom = next === 1 ? "" : String(next);
    scrollTo(x * ratio, y * ratio);
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (data === null || typeof data !== "object" || data.type !== TYPE) return;
    draw(data.zoom);
  });

  addEventListener("keydown", (event) => {
    if (event.metaKey === event.ctrlKey || event.altKey) return;
    const key = Object.prototype.hasOwnProperty.call(KEYS, event.key) ? KEYS[event.key] : undefined;
    if (key === undefined) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    post({ key });
  }, true);

  addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    post({ pinch: Math.max(-LIMIT, Math.min(LIMIT, event.deltaY)) });
  }, { capture: true, passive: false });

  post({ ask: true });
})();`;
