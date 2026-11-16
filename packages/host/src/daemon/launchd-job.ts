/**
 * launchd-job.ts -- a launchd job as `launchctl print` describes it: how many times launchd has started it, and how its last run exited, which together tell a job that dies each time it starts.
 *
 * `launchctl print gui/<uid>/<label>` prints a job as indented `key = value`
 * lines, among them `runs = 1373` and `last exit code = 1`, or `last exit
 * code = (never exited)` before its first run ends; a run a signal ended
 * states `last terminating signal = Abort trap: 6` in its place, the signal's
 * number after its name. Apple calls the format unstable, so a print missing the run count reads as no job at all, and
 * nothing is inferred from it.
 */

import { Option } from "effect";

/** The run count a print states, as its own line. */
const RUNS = /^\s*runs = (\d+)\s*$/mu;

/** The last exit a print states, a code where the job has exited. */
const LAST_EXIT = /^\s*last exit code = (-?\d+)/mu;

/** The signal that ended the last run, by its number after its name, where one did. */
const LAST_SIGNAL = /^\s*last terminating signal = .*: (\d+)\s*$/mu;

/** How many more runs than the read before, each ending in a failure, mark a job that dies as it starts; launchd starts a dead job again once its throttle passes. */
const QUITS_TO_TELL = 3;

/** A launchd job: how many times launchd started it, the code its last run exited with, none before one has, and the signal that ended it, none where none did. */
export interface LaunchdJob {
  readonly runs: number;
  readonly lastExit: number | undefined;
  readonly lastSignal: number | undefined;
}

/** A number a print states, none where it states none. */
const numberOf = (stated: string | undefined) =>
  stated === undefined ? undefined : Number(stated);

/** The job a `launchctl print` describes; none where it states no run count. */
export function launchdJobOf(printed: string): Option.Option<LaunchdJob> {
  const runs = RUNS.exec(printed)?.[1];

  if (runs === undefined) return Option.none();

  return Option.some({
    runs: Number(runs),
    lastExit: numberOf(LAST_EXIT.exec(printed)?.[1]),
    lastSignal: numberOf(LAST_SIGNAL.exec(printed)?.[1]),
  });
}

/** How the job's last run failed, in our own words: the signal that ended it, else the code it exited with where that is not 0; none where it ran clean or has not ended. */
export function lastRunFailure(job: LaunchdJob): string | undefined {
  if (job.lastSignal !== undefined) return `last terminating signal ${job.lastSignal}`;

  return job.lastExit === undefined || job.lastExit === 0
    ? undefined
    : `last exit code ${job.lastExit}`;
}

/**
 * Whether a job keeps quitting: launchd started it `QUITS_TO_TELL` times or
 * more since the read before, and its last run failed, by a code or by a
 * signal (`lastRunFailure`). Note that one restart,
 * as an update's, or runs that exit cleanly, never read as quitting.
 */
export function keepsQuitting(before: LaunchdJob, now: LaunchdJob): boolean {
  return now.runs - before.runs >= QUITS_TO_TELL && lastRunFailure(now) !== undefined;
}
