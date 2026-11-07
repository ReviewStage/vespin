/**
 * lazy-surface.tsx -- a surface split off the bundle every window parses, imported the first time it is drawn, or earlier where the pointer says it is about to be.
 *
 * A window parses its whole entry as it opens, so a surface most launches
 * never open, and no route draws, is a chunk of its own: drawn through
 * `Surface` under a `Suspense` whose fallback is the surface's own frame,
 * which its caller names. `prefetch` starts the same import from a hover or a
 * hint of intent, so the press that follows finds the chunk landed; the
 * import is shared, so the chunk is read once whichever asks first. An import
 * that failed is thrown to the `ErrorBoundary` `Surface` stands, which says
 * so with Reload in the surface's place, and the rest of the window stands.
 *
 * Note that this is not `React.lazy`, because `lazy` (React 19.2) suspends
 * on the first draw of a module it has not read yet even where the import
 * already landed: it hears of the module only through the promise's `then`,
 * a microtask later, so the draw commits the fallback and React's retry
 * throttle holds it for up to 300ms. `Surface` reads the import as `lazy`
 * does, suspending on it while it is out, but draws at once from an import
 * already landed; the import is marked settled as React marks a thenable it
 * reads, before React hears of it, so the draw React retries on finds it
 * settled.
 *
 * Note too that Reload after a failed import reloads the window, rather
 * than start the import again in place, because Chromium keeps a module
 * whose fetch failed in the document's module map and answers the same
 * failure to every later import of it, and a chunk a deploy since replaced
 * is gone under its old name for good; a new document reads both afresh.
 * A surface that landed and then threw while drawing is drawn again in
 * place.
 */

import { type ComponentType, type ReactNode, type ReactPromise, Suspense } from "react";
import { ErrorBoundary } from "../error-boundary/error-boundary.js";

/** What `Surface` takes beside the surface's own props: the frame that stands while its chunk loads. */
interface LazySurfaceFrame {
  readonly fallback: ReactNode;
}

/** A surface reached through a dynamic import, drawn under its own boundary, and the door that starts that import early. */
export interface LazySurface<P> {
  readonly Surface: ComponentType<P & LazySurfaceFrame>;
  readonly prefetch: () => void;
}

/** The window's own reload: its document read again from the start, every chunk among it. */
function reloadDocument(): void {
  location.reload();
}

/**
 * The surface `load` answers, imported once whether its draw or a prefetch
 * asks first; `reload` is what Reload does once that import failed, the
 * window's own reload unless a test stands in for it.
 */
export function lazySurface<P extends object>(
  load: () => Promise<ComponentType<P>>,
  reload: () => void = reloadDocument,
): LazySurface<P> {
  let loading: ReactPromise<ComponentType<P>> | undefined;
  const imported = (): ReactPromise<ComponentType<P>> => {
    if (loading !== undefined) return loading;
    const started = load();
    started.then(
      (value) => {
        Object.assign(started, { status: "fulfilled", value });
      },
      (reason) => {
        Object.assign(started, { status: "rejected", reason });
      },
    );
    loading = Object.assign(started, { status: "pending" as const });
    return loading;
  };
  // Only a new document reads a failed chunk again; a surface that landed is drawn again in place.
  const reloadFailed = (): void => {
    if (loading?.status === "rejected") reload();
  };
  const Imported = (props: P): React.JSX.Element => {
    const module = imported();
    if (module.status === "rejected") throw module.reason;
    if (module.status !== "fulfilled") throw module;
    const Loaded = module.value;
    return <Loaded {...props} />;
  };
  // Note that the frame reaches the surface beside its own props, which no surface reads.
  const Surface = (props: P & LazySurfaceFrame): React.JSX.Element => (
    <Suspense fallback={props.fallback}>
      <ErrorBoundary onReload={reloadFailed}>
        <Imported {...props} />
      </ErrorBoundary>
    </Suspense>
  );
  return {
    Surface,
    prefetch: () => {
      imported();
    },
  };
}
