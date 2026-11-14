// splash.ts -- the launch splash, held over the app from its first module until its first screen has drawn, and let go then, or at a deadline.

import { hide, preventAutoHideAsync, setOptions } from "expo-splash-screen";

/** The longest the splash stands, so a host that never answers can't hold it forever. */
const SPLASH_DEADLINE_MS = 10_000;

/** How long the splash takes to fade into the first screen. */
const SPLASH_FADE_MS = 200;

/** The deadline that lets the splash go if nothing else does. */
let deadline: ReturnType<typeof setTimeout> | undefined;

/** Whether the splash has been let go this launch. */
let released = false;

/** Says on the console that the splash could not be held, so the launch falls back to expo-router's own hide. */
function saidOnConsole(cause: Error): void {
  console.error("The splash could not be held.", cause);
}

/**
 * Holds the native splash past expo-router's own hide, which comes a frame
 * after its navigation is ready, long before the host's first reading draws
 * a screen. Note that it's called once, as the root module loads, and that
 * the deadline lets the splash go on its own after 10 seconds.
 */
export function holdSplash(): void {
  setOptions({ fade: true, duration: SPLASH_FADE_MS });
  preventAutoHideAsync().catch(saidOnConsole);
  deadline = setTimeout(releaseSplash, SPLASH_DEADLINE_MS);
}

/** Lets the splash go, fading into whatever stands under it; a second call does nothing. */
export function releaseSplash(): void {
  if (released) return;
  released = true;
  clearTimeout(deadline);
  hide();
}

/** Lets the splash go a frame after the first screen mounts, so its SwiftUI views have laid out under the fade. */
export function releaseSplashAfterFrame(): () => void {
  const frame = requestAnimationFrame(releaseSplash);

  return () => cancelAnimationFrame(frame);
}
