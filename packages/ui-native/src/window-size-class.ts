// window-size-class.ts -- the size class a window's width and height put it in, which decides whether list and detail stand side by side.

export const WINDOW_SIZE_CLASS = {
  COMPACT: "compact",
  REGULAR: "regular",
} as const;

export type WindowSizeClass = (typeof WINDOW_SIZE_CLASS)[keyof typeof WINDOW_SIZE_CLASS];

/**
 * The least width and height, in points, of a window that stands list and
 * detail side by side. An iPad's window, the unfolded iPhone Duo's inner
 * display, and a Split View pane of half an iPad are over it both ways. An
 * iPhone's window is under it, and so is the folded Duo's outer display: both
 * stay compact on their sides too, where they are wide but about 400 to 470
 * points tall, too short for two columns under a bar, as Apple's own size
 * classes keep them compact. The layout is decided by the window alone, never
 * by the device's model, so a fold, a rotation, or a resize moves it on its own.
 */
const REGULAR_MIN_POINTS = 600;

/** The size class of a window `width` by `height` points. */
export function windowSizeClass(width: number, height: number): WindowSizeClass {
  return width >= REGULAR_MIN_POINTS && height >= REGULAR_MIN_POINTS
    ? WINDOW_SIZE_CLASS.REGULAR
    : WINDOW_SIZE_CLASS.COMPACT;
}

/**
 * The size class of a window's height alone, as iOS's vertical size class: an
 * iPhone on its side, about 400 to 440 points tall, is compact, where its bar
 * and the keyboard leave about a hundred points between them; every iPad
 * window and an iPhone upright are regular.
 */
export function heightClass(height: number): WindowSizeClass {
  return height >= REGULAR_MIN_POINTS ? WINDOW_SIZE_CLASS.REGULAR : WINDOW_SIZE_CLASS.COMPACT;
}
