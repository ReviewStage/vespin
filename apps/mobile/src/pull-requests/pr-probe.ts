// pr-probe.ts -- PROBE, not for merge: holds a fixture run's pull request parts back as long as `-prProbe` names, as the service's answers take, and logs when the page draws each section and what each render costs.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { launchPullRequestProbe } from "../host/launch-arguments.js";

const DELAYS = launchPullRequestProbe();

/** Each part's delay, in the order `-prProbe` names them. */
const PART_AT = { pullRequest: 0, checks: 1, conversation: 2 } as const;

type ProbePart = keyof typeof PART_AT;

function say(line: string): void {
  console.error(`[prprobe] ${line} wall=${Date.now()}`);
}

/** The parts as the screen would see them had each taken its delay from the screen's mount to land. */
export function useProbeParts<Parts extends Record<ProbePart, unknown>>(parts: Parts): Parts {
  const [mounted] = useState(() => performance.now());
  const [, setTick] = useState(0);
  const told = useRef(new Set<ProbePart>());

  useEffect(() => {
    if (DELAYS === undefined) return;
    const timers = DELAYS.map((ms) => setTimeout(() => setTick((n) => n + 1), ms));

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (DELAYS === undefined) return parts;
  const elapsed = performance.now() - mounted;
  const shown = { ...parts };

  for (const part of Object.keys(PART_AT) as ProbePart[]) {
    if (elapsed < DELAYS[PART_AT[part]]) {
      shown[part] = undefined as Parts[ProbePart];
    } else if (parts[part] !== undefined && !told.current.has(part)) {
      told.current.add(part);
      say(`landed part=${part} t=${elapsed.toFixed(1)}`);
    }
  }

  return shown;
}

/** Logs, on each commit that changes what the page draws, the time since its mount, the render's own cost, and the next frame. */
export function useProbeDrawn(drawn: readonly string[]): void {
  const renderStart = performance.now();
  const [mounted] = useState(() => {
    if (DELAYS !== undefined) say("mount t=0");

    return renderStart;
  });
  const last = useRef("");
  const key = drawn.join(",");

  useLayoutEffect(() => {
    if (DELAYS === undefined) return;
    const committed = performance.now();

    if (key === last.current) {
      say(
        `recommit t=${(committed - mounted).toFixed(1)} render=${(committed - renderStart).toFixed(1)}`,
      );

      return;
    }

    last.current = key;
    say(
      `commit t=${(committed - mounted).toFixed(1)} render=${(committed - renderStart).toFixed(1)} drew=${key}`,
    );
    requestAnimationFrame(() =>
      say(`frame t=${(performance.now() - mounted).toFixed(1)} drew=${key}`),
    );
  });
}
