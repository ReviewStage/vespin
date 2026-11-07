/**
 * lazy-boundary.tsx -- the boundary a surface split off the bundle stands under: its own frame while its chunk loads, and Reload where it failed.
 *
 * A surface most launches never open, and no route draws, such as a side
 * panel's tab, is a chunk of its own read through `React.lazy`. It stands
 * under this boundary: a `Suspense` whose fallback is the surface's own
 * frame, which its caller names, over an `ErrorBoundary` that says a
 * failure with Reload in the surface's place, and the rest of the window
 * stands.
 *
 * Note that Reload reloads the window rather than draw the surface again in
 * place, because a `lazy` whose import failed answers that failure to every
 * later draw, and Chromium keeps a module whose fetch failed in the
 * document's module map, answering the same failure to every later import
 * of it, so only a new document reads the chunk afresh.
 */

import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "../error-boundary/error-boundary.js";

/** The window's own reload: its document read again from the start, every chunk among it. */
function reloadDocument(): void {
  location.reload();
}

/** Draws `children`, `fallback` while a lazy surface among them loads, and Reload, which reloads the window, where one failed. */
export function LazyBoundary({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Suspense fallback={fallback}>
      <ErrorBoundary onReload={reloadDocument}>{children}</ErrorBoundary>
    </Suspense>
  );
}
