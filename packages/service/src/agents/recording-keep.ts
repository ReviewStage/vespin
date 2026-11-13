/**
 * recording-keep.ts -- a stopped recording kept beside the transcript, and the words its refusals say, whichever tool recorded it: the `browser`'s video of its pages, or the `computer`'s of an app on the developer's Mac.
 *
 * Both tools answer `stop_recording` alike: how long the video ran, its
 * caption, where it stays on the agent's machine until the next recording,
 * where it can be posted from, and the video as the transcript kept it,
 * which the transcript plays, or why it was not kept and its size. The
 * video is kept as a picture is (`keepConversationPicture`), under the same
 * bounds, deleted with its conversation, and never handed to the model.
 * The words a refusal says are shared where both tools mean the same, so
 * an agent reads one set; each tool adds its own for what is its alone.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import type { ConversationTarget } from "@repo/database/models/writer";
import {
  type CONVERSATION_MEDIA_TYPE,
  type KeptPicture,
  PICTURE_OMISSION,
} from "@repo/features/conversation-picture-wire";
import { RECORDING_FAILURE } from "@repo/features/recording-wire";
import { Effect, Option } from "effect";
import { logStoreFailure } from "../http/store-failure.js";

/** Why a recording did not start or stop, in words the model can act on, wherever both tools mean the same. */
export const RECORDING_WORDS = {
  [RECORDING_FAILURE.RUNNING]: "a recording already runs: stop it with stop_recording first",
  [RECORDING_FAILURE.NONE]: "no recording runs: start one with record",
  [RECORDING_FAILURE.ENCODER]: "the recording could not be encoded",
  [RECORDING_FAILURE.SLOW]: "the recording is still being encoded; call stop_recording again",
  UNKEPT: "the recording could not be kept just now; call stop_recording again",
} as const;

/** What a recording past its byte bound answers, naming that bound. */
export function recordingTooLarge(maxBytes: number): string {
  return `the recording would not fit in ${maxBytes / 1_000_000} MB even made small; record a shorter flow`;
}

/** The types a recording is kept as: a browser's WebM, or a Mac's H.264 MP4. */
type RecordingType = typeof CONVERSATION_MEDIA_TYPE.WEBM | typeof CONVERSATION_MEDIA_TYPE.MP4;

/** A stopped recording's video: its bytes, the type they were checked to be, its size, and a WebM's MP4 copy where one was made. */
export interface RecordingVideo<Type extends RecordingType> {
  readonly bytes: Uint8Array;
  readonly contentType: Type;
  readonly width: number;
  readonly height: number;
  readonly mp4Bytes?: Uint8Array | undefined;
}

/** What a stop says of its recording beside the video: how long it ran, its caption, and where it stays until the next recording, where it does. */
export interface RecordingTake {
  readonly seconds: number;
  readonly caption?: string | undefined;
  readonly path?: string | undefined;
}

/** What a stop answers of its take: its seconds, and its caption and path where it has them, never a key standing for nothing. */
interface ToldTake {
  seconds: number;
  caption?: string;
  path?: string;
}

/** A stopped recording as both tools answer it: the take, and the video as the transcript kept it, or why not and its size. */
export type KeptRecording<Type extends RecordingType> = {
  readonly seconds: number;
  readonly caption?: string;
  readonly path?: string;
} & (
  | { readonly picture: KeptPicture & { readonly mediaType: Type } }
  | { readonly omitted: typeof PICTURE_OMISSION.LIMIT; readonly byteCount: number }
);

/**
 * The recording kept beside the transcript the call is written to, as a
 * picture is: named by what was kept, or, where the transcript has no room
 * left, by why not and its size; failed with `UNKEPT`'s words where the
 * store failed, which is logged by its kind alone.
 */
export function keepRecording<Type extends RecordingType>(
  transcript: ConversationTarget,
  video: RecordingVideo<Type>,
  take: RecordingTake,
): Effect.Effect<KeptRecording<Type>, string, DatabaseServices> {
  const told: ToldTake = { seconds: take.seconds };

  if (take.caption !== undefined) told.caption = take.caption;

  if (take.path !== undefined) told.path = take.path;

  return keepConversationPicture(transcript, video).pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError(() => RECORDING_WORDS.UNKEPT),
    Effect.map(
      (kept): KeptRecording<Type> =>
        Option.isNone(kept)
          ? { ...told, omitted: PICTURE_OMISSION.LIMIT, byteCount: video.bytes.byteLength }
          : { ...told, picture: { ...kept.value, mediaType: video.contentType } },
    ),
  );
}
