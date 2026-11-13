/**
 * turn-files-wire.ts -- the files a coding agent's turn changed, as its runner diffed its checkout when the turn ended, read off the runner's event, kept on the turn's row, and handed to a window on the reply the turn wrote.
 *
 * The runner reads them by the one diff script the Changes view reads a
 * turn's patch by (`@repo/agent-runner/checkout-diff`), so a turn's summary
 * and its Turn changes tab name the same files. One schema reads them
 * wherever they cross: off the runner's IDLE or END, into the turn's
 * column, and onto the transcript, each bounded, so a runner that sends too
 * much has its summary left out rather than its end refused.
 */

import { TURN_FILES_BOUNDS } from "@repo/agent-runner/protocol";
import { Schema } from "effect";

/** The most characters a file's path may spell; git's own bound is the system's. */
const TURN_FILE_PATH_CHARS = 4096;

const countSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One file the turn changed, where it stands after the turn, with the lines the turn added to it and removed from it. */
export const TurnFileSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(TURN_FILE_PATH_CHARS)),
  additions: countSchema,
  deletions: countSchema,
});

/** The first files the turn changed, at most `TURN_FILES_BOUNDS.MAX_FILES`, and how many files and lines it changed over all of them. */
export const TurnFilesSummarySchema = Schema.Struct({
  files: Schema.Array(TurnFileSchema).check(Schema.isMaxLength(TURN_FILES_BOUNDS.MAX_FILES)),
  total: countSchema,
  additions: countSchema,
  deletions: countSchema,
});

export type TurnFilesSummaryView = typeof TurnFilesSummarySchema.Type;
