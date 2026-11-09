/**
 * reported-failure.ts -- a failure as an app would hand it to a component that says it in place, recording each time it was said shown, copying into a list, and, where it offers Investigate, how often that was pressed, so a test reads what the component reported, copied, and started.
 */

import type { ReportedFailure } from "../reported-failure.js";

/** A recorded failure: what a component was handed, how often it said it was shown, and what was copied of it. */
export interface RecordedFailure {
  readonly failure: ReportedFailure;
  readonly shown: () => number;
  readonly copied: readonly string[];
  /** How many times Investigate was pressed, where it is offered. */
  readonly investigated: () => number;
}

/** A failure whose details are `details`, offering Investigate where `investigable`, recording what is said of it. */
export function recordedFailure(
  details = "time: 2026-10-29T18:20:03.198Z",
  { investigable = false }: { readonly investigable?: boolean } = {},
): RecordedFailure {
  let shown = 0;
  let investigated = 0;
  const copied: string[] = [];
  return {
    failure: {
      shown: () => {
        shown += 1;
        return details;
      },
      hidden: () => undefined,
      copy: (text) => {
        copied.push(text);
        return Promise.resolve();
      },
      investigation: () =>
        investigable
          ? () => {
              investigated += 1;
            }
          : undefined,
    },
    shown: () => shown,
    copied,
    investigated: () => investigated,
  };
}
