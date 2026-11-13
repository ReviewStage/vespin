/**
 * launchd-job.ts -- a launchd job as `launchctl print` describes it: how many times launchd has started it, and how its last run exited, which together tell a job that dies each time it starts.
 *
 * `launchctl print gui/<uid>/<label>` prints a job as indented `key = value`
 * lines, among them `runs = 1373` and `last exit code = 1`, or `last exit
 * code = (never exited)` before its first run ends. Apple calls the format
 * unstable, so a print missing the run count reads as no job at all, and
 * nothing is inferred from it.
 */

import { Option } from "effect";

/** The run count a print states, as its own line. */
const RUNS = /^\s*runs = (\d+)\s*$/mu;

/** The last exit a print states, a code where the job has exited. */
const LAST_EXIT = /^\s*last exit code = (-?\d+)/mu;

/** How many more runs than the read before, each ending in a failure, mark a job that dies as it starts; launchd starts a dead job again once its throttle passes. */
const QUITS_TO_TELL = 3;

/** A launchd job: how many times launchd started it, and the code its last run exited with, none before one has. */
export interface LaunchdJob {
  readonly runs: number;
  readonly lastExit: number | undefined;
}

/** The job a `launchctl print` describes; none where it states no run count. */
export function launchdJobOf(printed: string): Option.Option<LaunchdJob> {
  const runs = RUNS.exec(printed)?.[1];
  const lastExit = LAST_EXIT.exec(printed)?.[1];

  if (runs === undefined) return Option.none();

  return Option.some({
    runs: Number(runs),
    lastExit: lastExit === undefined ? undefined : Number(lastExit),
  });
}

/**
 * Whether a job keeps quitting: launchd started it `QUITS_TO_TELL` times or
 * more since the read before, and its last run failed. Note that one restart,
 * as an update's, or runs that exit cleanly, never read as quitting.
 */
export function keepsQuitting(before: LaunchdJob, now: LaunchdJob): boolean {
  return (
    now.runs - before.runs >= QUITS_TO_TELL && now.lastExit !== undefined && now.lastExit !== 0
  );
}
