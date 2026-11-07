/**
 * turn-deadline.ts -- the deadlines a coding agent's turn row holds for the state it stands in, which the minute sweep fails it by.
 *
 * A turn row is the one record of a turn (`@repo/database`'s
 * `models/turn-record.ts` is the one writer of its state): it is queued in
 * the same transaction as the line that opens it, started as a runner takes
 * that line, and settled, canceled, or failed with the word that says why
 * (`@repo/features/turn-run`'s `TURN_FAILURE`). Every state short of an end
 * carries a deadline on the row (`turns.lease_until`), and a turn still open
 * past it, or past its cap, is failed by the minute sweep
 * (`@repo/service`'s `coder-host/reconcile.ts`), never by a reader:
 *
 * - queued, awaiting a runner to take its line: `PICKUP_MS` from its
 *   queueing, failed `line_untaken` past it, as Temporal's schedule-to-start.
 *   It sits well above a sandbox's start and a hand-on's wait for the
 *   runner lease, so it never fails a line still on its way.
 * - running: `PROGRESS_MS` past its last progress, which only its progress
 *   pushes on (`@repo/service`'s `native-projection.ts`, `turnProgressed`),
 *   failed `no_progress` where its runner still runs, and `runner_lost`
 *   where it ended.
 * - stopping, once a Stop was asked of it: `STOP_MS` from the Stop at most,
 *   canceled past it, since its runner heard neither the Stop nor its force.
 * - and whatever it stands in, `CAP_MS` from its start, failed `deadline`
 *   past it, as Temporal's start-to-close.
 */

/** How long each state may stand, in milliseconds. */
export const TURN_DEADLINE = {
  /** How long a queued turn awaits a runner to take its line: twice the longest pickup production has seen, and well past a sandbox's start. */
  PICKUP_MS: 10 * 60 * 1000,
  /** How long past its last progress a running turn is held to be at work: three of its runner's heartbeats. */
  PROGRESS_MS: 15 * 60 * 1000,
  /** How far a progress deadline may run down before progress pushes it on, so a runner posting many batches a minute writes the row a few times an hour, never at each. */
  RENEW_AFTER_MS: 2 * 60 * 1000,
  /** How long a turn may stand open once a Stop was asked of it: a runner ends a turn within seconds of its Stop, and the Stop's own force ends it ten seconds on. */
  STOP_MS: 5 * 60 * 1000,
  /** The longest any turn may run from its start, whatever its progress: past the longest turn production has run to its end. */
  CAP_MS: 24 * 60 * 60 * 1000,
} as const;
