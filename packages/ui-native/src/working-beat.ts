// working-beat.ts -- the one beat every working mark on screen steps on: a step each 200 ms, kept running only while a mark listens.

import { changeSignal } from "./held-value.js";

/** How long a step of the beat lasts, in milliseconds: the panel's 200 ms. */
const BEAT_MS = 200;

const signal = changeSignal();

/** The steps taken since the app opened. */
let beat = 0;

/** The marks listening, which keep the beat running. */
let listening = 0;

let timer: ReturnType<typeof setInterval> | undefined;

/** Takes one step and tells every mark listening. */
function step(): void {
  beat += 1;
  signal.tell();
}

/**
 * Hears each step until the returned function stops it, as
 * `useSyncExternalStore` subscribes. Note that the beat runs only while a
 * mark listens, so a screen with no agent at work keeps no timer.
 */
export function subscribeWorkingBeat(listener: () => void): () => void {
  const stop = signal.subscribe(listener);
  listening += 1;

  if (timer === undefined) timer = setInterval(step, BEAT_MS);

  return () => {
    stop();
    listening -= 1;

    if (listening > 0 || timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };
}

/** The step the beat stands on now. */
export function readWorkingBeat(): number {
  return beat;
}
