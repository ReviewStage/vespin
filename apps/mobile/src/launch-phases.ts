// launch-phases.ts -- how long a launch's host took to stand, noted as the host starts and stands, for `app:ready` to count beside its own time.

/** React Native's own startup marks, which its `performance` holds beside the web's and its types leave out. */
interface StartupPerformance {
  readonly rnStartupTiming?: { readonly startTime?: number | null };
}

/** How long after the launch's start this launch's host stood; none before it stands. */
let stood: { readonly ms: number | undefined } | undefined;

/**
 * The time since React Native's own start of this launch, in milliseconds, or
 * none where the runtime keeps no start. Note that the start is
 * `APP_STARTUP_START`, which React Native marks just before Hermes runs the
 * bundle, so the native launch before it isn't in the time.
 */
export function sinceLaunch(): number | undefined {
  // Note that React Native's startup timing is read inside a guard, since a runtime that keeps none throws on the read.
  try {
    // SAFETY: React Native's `performance` holds `rnStartupTiming` (react-native/src/private/webapis/performance/Performance.js); every member is read as optional.
    const start = (performance as Performance & StartupPerformance).rnStartupTiming?.startTime;

    return start === null || start === undefined ? undefined : performance.now() - start;
  } catch {
    return undefined;
  }
}

/** Notes that the host starts, clearing what an earlier start noted. */
export function noteHostStarting(): void {
  stood = undefined;
}

/** Notes, once the host stood, how long it took. */
export function noteHostStood(): void {
  stood = { ms: sinceLaunch() };
}

/** How long this launch's host took to stand, once it stood; none before. */
export function launchStood(): typeof stood {
  return stood;
}
