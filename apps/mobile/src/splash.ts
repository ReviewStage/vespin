// splash.ts -- the launch splash, held over the app from its first module until its first screen has drawn, and let go then, or at a deadline.

import { atForeground, foregroundAfter } from "@repo/runtime/effect";
import { hide, preventAutoHideAsync, setOptions } from "expo-splash-screen";
import { useSyncExternalStore } from "react";
import { LAUNCH_PHASE, noteLaunchPhase } from "./launch-phases.js";
import { foregroundClock } from "./launch-state.js";

/** The longest the splash stands in front, so a host that never answers can't hold it forever. */
const SPLASH_DEADLINE_MS = 10_000;

/** How long the splash takes to fade into the first screen. */
const SPLASH_FADE_MS = 200;

/** Stops the deadline that lets the splash go if nothing else does; nothing before it is set. */
let stopDeadline: () => void = () => undefined;

/** Whether the splash has been let go this launch. */
let released = false;

/** Those told when the splash is let go. */
const releaseHeard = new Set<() => void>();

/** Says on the console that the splash could not be held, so the launch falls back to expo-router's own hide. */
function saidOnConsole(cause: Error): void {
  console.error("The splash could not be held.", cause);
}

/**
 * Holds the native splash past expo-router's own hide, which comes a frame
 * after its navigation is ready, long before the host's first reading draws
 * a screen. Note that it's called once, as the root module loads, and that
 * the deadline lets the splash go on its own after 10 seconds of the app's
 * foreground clock (`launch-state.ts`), so a launch woken in the background
 * still holds it once it comes to the front.
 */
export function holdSplash(): void {
  setOptions({ fade: true, duration: SPLASH_FADE_MS });
  preventAutoHideAsync().catch(saidOnConsole);

  stopDeadline = atForeground(
    foregroundClock,
    foregroundAfter(foregroundClock.now(), SPLASH_DEADLINE_MS),
    releaseSplash,
  );
}

/** Lets the splash go, fading into whatever stands under it, noted as the launch's screens drawn; a second call does nothing. */
export function releaseSplash(): void {
  if (released) return;
  released = true;
  stopDeadline();
  noteLaunchPhase(LAUNCH_PHASE.SCREENS);
  hide();

  for (const heard of releaseHeard) heard();
}

/** Hears the splash let go. */
function hearRelease(heard: () => void): () => void {
  releaseHeard.add(heard);

  return () => releaseHeard.delete(heard);
}

/**
 * Whether the splash has been let go this launch, so work nobody waits on,
 * such as the Spotlight index or the share sheet's snapshot, starts once the
 * first screen stands rather than holding it.
 */
export function useSplashReleased(): boolean {
  return useSyncExternalStore(hearRelease, () => released);
}

/** Lets the splash go a frame after the first screen mounts, so its SwiftUI views have laid out under the fade. */
export function releaseSplashAfterFrame(): () => void {
  const frame = requestAnimationFrame(releaseSplash);

  return () => cancelAnimationFrame(frame);
}
