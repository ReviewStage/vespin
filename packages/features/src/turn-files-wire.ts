/**
 * turn-files-wire.ts -- how many files a coding agent's turn changed and its lines over them, as its runner diffed its checkout when the turn ended, read off the runner's event, kept on the turn's row, and handed to a window on the reply the turn wrote.
 *
 * The runner counts them by the one diff script the Changes view reads a
 * turn's patch by (`@repo/agent-runner/checkout-diff`), so a turn's summary
 * and its Turn changes tab count the same files. The summary names none:
 * the tab reads them from the diff. One schema reads it wherever it
 * crosses: off the runner's IDLE or END, into the turn's column, and onto
 * the transcript, so a runner that sends one it cannot read has its summary
 * left out rather than its end refused.
 */

import { Schema } from "effect";

const countSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** How many files the turn changed, and the lines it added and removed over all of them. Note that a summary kept before it named no file still carries its first files, which a read leaves out. */
export const TurnFilesSummarySchema = Schema.Struct({
  total: countSchema,
  additions: countSchema,
  deletions: countSchema,
});

export type TurnFilesSummaryView = typeof TurnFilesSummarySchema.Type;
