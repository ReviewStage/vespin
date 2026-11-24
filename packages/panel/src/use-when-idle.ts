import { afterPaint } from "@repo/ui/after-paint";
import { useEffect, useRef } from "react";

/**
 * use-when-idle.ts -- work the panel's first paint does not need, started once the renderer has nothing better to do.
 *
 * The first commit competes with whatever it starts: parsing the editor
 * bundle, the markdown parser, or the session recorder is main-thread time the
 * first interactions then wait behind. `useWhenIdle` holds such work back until
 * `requestIdleCallback` reports an idle moment, and no longer than `timeoutMs`
 * on a renderer that never goes idle, so it still happens.
 */

/** How long an idle callback may be held back before it runs regardless. */
export const IDLE_TIMEOUT_MS = {
  /** Session replay is how the team sees problems, so it starts within a few seconds on any renderer. */
  SESSION_REPLAY: 3000,
  /** Warming the editor and the markdown parser is a courtesy to a later click, so it yields to replay. */
  PREFETCH: 5000,
  /** The task list's indexes speed a later page's read of a task's agents and sub-tasks, so they yield to replay too. */
  TASK_LIST_INDEXES: 5000,
} as const;

/**
 * Calls `run` once, when the renderer is next idle or `timeoutMs` has passed,
 * whichever comes first, and answers what cancels it. A browser with no
 * `requestIdleCallback` (Safari) runs it after the first frame has painted,
 * or at once in a hidden tab, which paints none (`afterPaint`).
 */
export function runWhenIdle(run: () => void, timeoutMs: number): () => void {
  if ("requestIdleCallback" in globalThis) {
    const handle = globalThis.requestIdleCallback(run, { timeout: timeoutMs });

    return () => globalThis.cancelIdleCallback(handle);
  }

  return afterPaint(run);
}

/**
 * Calls `work` once, when the renderer is next idle or `timeoutMs` has passed,
 * whichever comes first; the call is canceled where the component leaves
 * first. A new `work` before then replaces the old one without restarting the wait.
 *
 * A browser with no `requestIdleCallback` (Safari) runs it after the first
 * frame has painted, or at once in a hidden tab, which paints none
 * (`afterPaint`).
 */
export function useWhenIdle(work: () => void, timeoutMs: number): void {
  const latest = useRef(work);
  useEffect(() => {
    latest.current = work;
  }, [work]);
  useEffect(() => runWhenIdle(() => latest.current(), timeoutMs), [timeoutMs]);
}
