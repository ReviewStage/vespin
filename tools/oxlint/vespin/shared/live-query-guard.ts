/**
 * live-query-guard.ts -- what the `live-query-through-window` rule reads: the
 * iOS app's and its design system's sources, where every read of a window of
 * rows goes through `useWindow`, and the one file that may call
 * `useLiveQuery` itself. A live query's `data` is empty both while it loads
 * and once it finds nothing, so a screen reading it directly could say a list
 * is empty, or a row missing, before its read answered; `useWindow` answers a
 * read state instead (`@repo/host/read-window`). The rule started clean, so it
 * takes no baseline and has no way past it.
 */
export const LIVE_QUERY_GUARD_RULE = "vespin/live-query-through-window";

/** The one file that calls `useLiveQuery`: the hook every window is read through. */
export const WINDOW_FILE = "apps/mobile/src/host/use-window.ts";

/** The library `useLiveQuery` is imported from. */
export const LIVE_QUERY_MODULE = "@tanstack/react-db";

/** The hook the rule keeps to `WINDOW_FILE`. */
export const LIVE_QUERY_HOOK = "useLiveQuery";

/** The source trees the rule reads: the iOS app's and its design system's. */
const WATCHED_TREES = ["apps/mobile/src/", "packages/ui-native/src/"] as const;

/** Whether the rule reads the file at the repository path `file`. */
export function isWindowedSource(file: string): boolean {
  return WATCHED_TREES.some((tree) => file.startsWith(tree)) && file !== WINDOW_FILE;
}
