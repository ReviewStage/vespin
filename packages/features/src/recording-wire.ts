/**
 * recording-wire.ts -- what a recording an agent makes is held to, whichever tool makes it: how long it runs, its caption, and why one came to no video.
 *
 * An agent records a flow it drove to show the developer, its browser with
 * the `browser` tool (`browser-agent-actions.ts`) or an app on the
 * developer's Mac with the `computer` tool (`machine-command-wire.ts`), each
 * with `record` and `stop_recording`: one runs across calls until it is
 * stopped or its time runs out, and the stop keeps it, with its caption, in
 * the transcript. The two tools name the same limits and the same reasons
 * here, so an agent learns one way to record.
 */

import { describeWire } from "@repo/wire/effect";
import { Schema } from "effect";

export const RECORDING_LIMITS = {
  /** The longest a recording runs before it stops on its own, in seconds. */
  MAX_SECONDS: 120,
  /** The longest caption a recording is kept with. */
  CAPTION_MAX_CHARS: 300,
} as const;

/** Why a recording came to no video, as its recorder says. */
export const RECORDING_FAILURE = {
  /** No recording runs or waits to be read. */
  NONE: "none",
  /** A recording already runs, so another cannot start. */
  RUNNING: "running",
  /** What was recorded drew nothing while it ran. */
  EMPTY: "empty",
  /** The encoder failed. */
  ENCODER: "encoder",
  /** No size the recorder tried fit the byte bound. */
  TOO_LARGE: "too-large",
  /** The recorder never reached what it records. */
  UNREACHABLE: "unreachable",
  /** The encoding did not finish within the stop's wait. */
  SLOW: "slow",
} as const;

export type RecordingFailure = (typeof RECORDING_FAILURE)[keyof typeof RECORDING_FAILURE];

/** A stop's caption, as both tools take it: one line the transcript shows under the video. */
export const recordingCaptionSchema = describeWire(
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(RECORDING_LIMITS.CAPTION_MAX_CHARS),
    Schema.isPattern(/^[^\r\n]*$/u),
  ),
  "What the recording shows, in one line, which the transcript shows under it.",
);
