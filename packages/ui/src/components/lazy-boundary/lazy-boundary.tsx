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
 * Note that Reload reloads the window where the surface's module never
 * landed, rather than draw it again in place, because a `lazy` whose import
 * failed answers that failure to every later draw, and Chromium keeps a
 * module whose fetch failed in the document's module map, answering the
 * same failure to every later import of it, so only a new document reads
 * the chunk afresh. A surface whose module landed and then threw while
 * drawing is drawn again in place; the surface's own loader says which
 * (`loaded`), since only it sees its `import()` settle.
 */

import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "../error-boundary/error-boundary.js";

/** The window's own reload: its document read again from the start, every chunk among it. */
function reloadDocument(): void {
  location.reload();
}

/**
 * Draws `children`, `fallback` while a lazy surface among them loads, and
 * Reload where one failed: the window's reload where `loaded` says its
 * module never landed, a draw again in place where it did. `reload` is the
 * window's own unless a test stands in for it.
 */
export function LazyBoundary({
  fallback,
  loaded,
  reload = reloadDocument,
  children,
}: {
  fallback: ReactNode;
  loaded: () => boolean;
  reload?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  // Only a new document reads a failed chunk again; a surface that landed is drawn again in place.
  const reloadUnlanded = (): void => {
    if (!loaded()) reload();
  };

  return (
    <Suspense fallback={fallback}>
      <ErrorBoundary onReload={reloadUnlanded}>{children}</ErrorBoundary>
    </Suspense>
  );
}
