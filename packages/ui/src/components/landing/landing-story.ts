import { type RefObject, useEffect, useState } from "react";
import { heldStill } from "./landing-paint.js";

/**
 * landing-story.ts -- the clock the landing's scenes play their stories on, and the moment their times count back from.
 *
 * A story is a count of steps, each held for a beat. Its clock runs only
 * while the scene is on screen, so a reader scrolling to it meets its start,
 * starts over at its end, and where motion is held stands at its last step,
 * where the whole story is told. Every time a scene shows counts back from
 * one fixed moment, so a page drawn on any day says the same ages, and a
 * prerendered page and the browser agree.
 */

/** The moment every scene's times count back from. */
export const STORY_NOW = Date.UTC(2026, 10, 2, 21, 52);

export const MINUTE = 60_000;

/** Nothing: no part of a scene is ever pressed. */
export function still(): void {}

/**
 * A story's step, from 0 to `count - 1`, held `beat` milliseconds each, on a
 * clock that runs only while the element `ref` names is on screen, or the
 * last step where motion is held.
 */
export function useStory(
  ref: RefObject<HTMLDivElement | null>,
  count: number,
  beat: number,
): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const scene = ref.current;

    if (!scene) return undefined;

    if (heldStill()) {
      setStep(count - 1);

      return undefined;
    }

    let shown = false;
    let played = 0;
    let previous: number | undefined;
    let frame = 0;

    const watch = new IntersectionObserver(([entry]) => {
      shown = entry?.isIntersecting ?? false;
    });

    watch.observe(scene);

    // Note that time only counts while the scene is shown, so a reader scrolling to it meets the story's start.
    const tick = (ms: number): void => {
      if (shown && previous !== undefined) played += ms - previous;
      previous = ms;
      setStep(Math.floor(played / beat) % count);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [ref, count, beat]);

  return step;
}

/**
 * A timeline's beat, from 0 to `durations.length - 1`, each held its own
 * duration in milliseconds, on the same clock as `useStory`: running only
 * while the element `ref` names is on screen, looping at its end, and
 * standing at its last beat where motion is held.
 */
export function useTimeline(
  ref: RefObject<HTMLDivElement | null>,
  durations: readonly number[],
): number {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const scene = ref.current;

    if (!scene) return undefined;

    if (heldStill()) {
      setBeat(durations.length - 1);

      return undefined;
    }

    const total = durations.reduce((sum, duration) => sum + duration, 0);
    let shown = false;
    let played = 0;
    let previous: number | undefined;
    let frame = 0;

    const watch = new IntersectionObserver(([entry]) => {
      shown = entry?.isIntersecting ?? false;
    });

    watch.observe(scene);

    // Note that we walk the durations to find the beat the loop's time falls in, since each beat holds its own.
    const tick = (ms: number): void => {
      if (shown && previous !== undefined) played += ms - previous;
      previous = ms;
      let left = played % total;
      let at = 0;

      while (at < durations.length - 1 && left >= (durations[at] ?? 0)) {
        left -= durations[at] ?? 0;
        at += 1;
      }

      setBeat(at);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [ref, durations]);

  return beat;
}

/**
 * How much of `words` a hand has typed: none before `typing`, a character at
 * a time while it is, at an uneven pace that lingers at each space, and all
 * of it once `typed`.
 */
export function useTyping(words: string, typing: boolean, typed: boolean): string {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!typing) return undefined;
    setCount(0);
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Note that each key's wait is drawn from its place in the words, so every loop types alike.
    const next = (at: number): void => {
      if (at > words.length) return;
      setCount(at);
      const key = words.charAt(at);
      const wait = (key === " " ? 70 : 24) + ((at * 37) % 30);
      timer = setTimeout(() => next(at + 1), wait);
    };

    next(0);

    return () => clearTimeout(timer);
  }, [words, typing]);

  if (typing) return words.slice(0, count);

  return typed ? words : "";
}
