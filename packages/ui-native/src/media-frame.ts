// media-frame.ts -- the one rule a picture or a recording stands by in a thread, a transcript and an ask: its own shape, never past its own size, and never wider or taller than a phone's message keeps one.

/**
 * The most a picture or a recording stands at, in points: near the width
 * Messages draws a photo at, so one never fills the screen and the words
 * around it stay in view, and short enough that a portrait screenshot
 * leaves room for them too, as the panel caps a picture at a screenful's
 * worth (`picture-most`).
 */
export const MEDIA_BOUNDS = { WIDTH: 280, HEIGHT: 360 } as const;

/** The aspect a picture or a recording stands at while its own is unknown: a film's, as a screen recording most often stands. */
export const UNSIZED_ASPECT = 16 / 9;

/** How large a picture or a recording is on its own, in points. */
export interface MediaSize {
  readonly width: number;
  readonly height: number;
}

/** How a piece of media stands: its width, which its column may narrow further, and its shape, which sets its height from that width. */
export interface MediaFrame {
  readonly width: number;
  readonly aspectRatio: number;
}

/**
 * Where a piece of media stands: at its own shape, scaled down only, to fit
 * `MEDIA_BOUNDS`, so a small icon stands at its own size rather than blown
 * up and blurred, and a tall screenshot stands no taller than the bound.
 * Note that the width is the most it stands at, so a narrower column, such
 * as an ask card's, narrows it again with the shape kept (`MediaBox`); that
 * media of no known size stands at `UNSIZED_ASPECT` as wide as the bound
 * allows; and that a size is taken in the pixels a picture or a player
 * reports, one pixel to a point, as the panel takes one to a CSS pixel.
 */
export function mediaFrame(natural: MediaSize | null | undefined): MediaFrame {
  // Note that a player that could not read its track's size answers none as `null`, which stands as a size unknown.
  if (natural == null || natural.width <= 0 || natural.height <= 0) {
    return { width: MEDIA_BOUNDS.WIDTH, aspectRatio: UNSIZED_ASPECT };
  }

  const aspectRatio = natural.width / natural.height;
  const width = Math.min(natural.width, MEDIA_BOUNDS.WIDTH, MEDIA_BOUNDS.HEIGHT * aspectRatio);

  return { width, aspectRatio };
}
