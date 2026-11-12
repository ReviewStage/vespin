/**
 * conductor-import-sweep.ts -- the scheduled sweep's part of the Conductor import: every run's key cleared a day after the run began, and every run deleted a week after.
 *
 * A run clears its own key once nothing of it is queued
 * (`conductor-import-store.ts`'s `settleConductorImportItem`); this is the
 * bound for one that never ends, such as one whose queue lost a message.
 */

import { sweepConductorImportRuns } from "@repo/database/models/conductor-import-store";
import { Duration, Effect } from "effect";

/** How long a run's progress is kept for the form to read. */
const RUN_KEEP = Duration.days(7);

/** Clears the keys past their day and deletes the runs past their keep, answering how many keys it cleared. */
export const sweepConductorImportKeys = (now: number) =>
  Effect.map(
    sweepConductorImportRuns(new Date(now), new Date(now - Duration.toMillis(RUN_KEEP))),
    (swept) => swept.keysCleared,
  );
