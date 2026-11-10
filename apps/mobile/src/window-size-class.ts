// window-size-class.ts -- the size class a window's width puts it in, which decides whether list and detail stand side by side.

export const WINDOW_SIZE_CLASS = {
  COMPACT: "compact",
  REGULAR: "regular",
} as const;

export type WindowSizeClass = (typeof WINDOW_SIZE_CLASS)[keyof typeof WINDOW_SIZE_CLASS];

/**
 * The narrowest window, in points, that stands list and detail side by side.
 * An iPhone's portrait window is under it, and an iPad's, the unfolded iPhone
 * Duo's inner display, and a Split View pane of half an iPad are over it. The
 * layout is decided by the window alone, never by the device's model, so a
 * fold, a rotation, or a resize moves it on its own.
 */
const REGULAR_WIDTH_MIN_POINTS = 600;

/** The size class of a window `width` points wide. */
export function windowSizeClass(width: number): WindowSizeClass {
  return width >= REGULAR_WIDTH_MIN_POINTS ? WINDOW_SIZE_CLASS.REGULAR : WINDOW_SIZE_CLASS.COMPACT;
}

/**
 * The narrowest window, in points, that stands three columns, such as a
 * list's groups beside the group's rows beside the row's page: an iPad's in
 * landscape is over it, and one in portrait, the unfolded iPhone Duo's, and
 * a Split View pane are under it, where two columns stand.
 */
const THREE_COLUMNS_MIN_POINTS = 1100;

/** Whether a window `width` points wide stands three columns. */
export function standsThreeColumns(width: number): boolean {
  return width >= THREE_COLUMNS_MIN_POINTS;
}
