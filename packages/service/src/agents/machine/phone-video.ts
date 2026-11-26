/**
 * phone-video.ts -- the commands that make an H.264 MP4 of an agent's WebM recording, or an AAC M4A of its Ogg sound clip, in the agent's own sandbox, for a player that plays neither, and the copy each run prints.
 *
 * iOS's player (AVPlayer) plays no WebM, which is all an agent records, so
 * the service keeps an MP4 of each recording beside it, and the attachment
 * reads answer it to a caller that asks for a playable video. It is made
 * where the WebM was, in the sandbox the agent recorded or saved it in:
 * the file is the agent's own, so ffmpeg reads bytes the agent wrote, if
 * crafted, in that agent's sandbox alone, never in a function of the
 * service, and nothing leaves the deployment. Playwright's ffmpeg, which
 * the recorder encodes with, writes WebM alone, so this one is the image's
 * own (`apps/web/agent-image/Dockerfile`); a sandbox resumed from a
 * snapshot of an older image has none, and its recordings keep their WebM
 * alone, as a Mac's do, which reads as none.
 *
 * The input is read as a Matroska file through the file protocol alone,
 * whatever its path spells, and encoded at ever smaller sizes until one
 * fits the bound, the movie's index moved ahead of its media
 * (`+faststart`) so the phone plays it as it arrives. A recording's first
 * sound track, where it has one, as a clip an agent made to be heard does,
 * goes into the copy as AAC; a screen recording has none, and its copy none
 * either. The run prints it as base64 on one line, as the machine's other
 * reads do, or, handed a presigned upload, puts it in the Blob store itself
 * (`sandbox-upload.ts`) and prints its size alone, so a copy made in a
 * sandbox never passes through a function as base64.
 *
 * iOS's player plays no Ogg either, which a sound clip an agent made may
 * be, so beside an Ogg clip the service keeps an AAC M4A of it, made the
 * same way by a sibling command (`phoneAudioAsk`): the input read as an Ogg
 * file through the file protocol alone, its first sound track encoded as
 * AAC at ever lower bit rates until one fits the bound, its index moved
 * ahead of its media.
 */

import { mp4IsSoundOnly, PHONE_VIDEO_BOUNDS, streamableMp4 } from "@repo/features/video-signature";
import type { CommandAsk, CommandRun } from "@repo/sandbox";
import {
  type SandboxUpload,
  UPLOAD_FUNCTION,
  UPLOAD_URL_VARIABLE,
  uploadCommandParts,
} from "./sandbox-upload.js";

/** How a run ends where it made no copy. */
const PHONE_VIDEO_EXIT = {
  NO_FILE: 3,
  NO_ENCODER: 4,
  ENCODER: 5,
  TOO_LARGE: 6,
} as const;

/** The bit rate a recording's sound is kept at in the copy, AAC's, which iOS's player plays. */
const AUDIO_BITRATE = "64k";

/** The name the script runs under, as `$0`. */
const PHONE_VIDEO_SCRIPT_NAME = "phone-video";

/** The name the clip's script runs under, as `$0`. */
const PHONE_AUDIO_SCRIPT_NAME = "phone-audio";

/** The bit rates a clip's AAC copy is tried at in turn, each smaller than the last. */
const AUDIO_ENCODINGS = ["128k", "64k", "32k"] as const;

/** The most seconds one encoding may take, inside a tool call's own bound. */
const ENCODE_SECONDS = 60;

/**
 * The encodings tried in turn, each smaller than the last: H.264's quality
 * (`crf`) and the height scaled to, none for the recording's own. Each
 * keeps both sides even, which 4:2:0 H.264 needs.
 */
const ENCODINGS = [
  { crf: 28, scale: "trunc(iw/2)*2:trunc(ih/2)*2" },
  { crf: 34, scale: "-2:'min(720,trunc(ih/2)*2)'" },
  { crf: 40, scale: "-2:'min(480,trunc(ih/2)*2)'" },
] as const;

/**
 * What every copy's script opens with: its positional parameters, the
 * source's path, the copy's most bytes, and any headers an upload sends, and
 * `deliver <file>`, which prints the copy as base64, or, where the
 * environment carries a presigned URL, uploads it and prints its size.
 */
const COPY_PREAMBLE = [
  "set -u -o pipefail",
  'src="$1" max="$2"; shift 2',
  'headers=(); for h in "$@"; do headers+=(-H "$h"); done',
  UPLOAD_FUNCTION,
  `deliver() { if [ -n "\${${UPLOAD_URL_VARIABLE}:-}" ]; then upload "$1" && stat -c %s -- "$1"; else base64 -w 0 <"$1"; fi; }`,
];

/**
 * The script, as positional parameters take it: the WebM's path and the
 * copy's most bytes, then an upload's headers. Its scratch folder is its own
 * and removed however it ends.
 */
const PHONE_VIDEO_SCRIPT = [
  ...COPY_PREAMBLE,
  `[ -f "$src" ] && [ -r "$src" ] || exit ${PHONE_VIDEO_EXIT.NO_FILE}`,
  `command -v ffmpeg >/dev/null 2>&1 || exit ${PHONE_VIDEO_EXIT.NO_ENCODER}`,
  "out=$(mktemp -d) || exit 1",
  "trap 'rm -rf \"$out\"' EXIT",
  ...ENCODINGS.flatMap(({ crf, scale }) => [
    `timeout ${ENCODE_SECONDS} ffmpeg -nostdin -loglevel error -protocol_whitelist file -f matroska -i "file:$src" -map 0:v:0 -map "0:a:0?" -c:v libx264 -preset veryfast -crf ${crf} -pix_fmt yuv420p -vf "scale=${scale}" -c:a aac -b:a ${AUDIO_BITRATE} -movflags +faststart -f mp4 -y "$out/copy.mp4" || exit ${PHONE_VIDEO_EXIT.ENCODER}`,
    '[ "$(stat -c %s "$out/copy.mp4")" -le "$max" ] && { deliver "$out/copy.mp4"; exit $?; }',
  ]),
  `exit ${PHONE_VIDEO_EXIT.TOO_LARGE}`,
].join("\n");

/**
 * The clip's script, as positional parameters take it: the Ogg's path and
 * the copy's most bytes, then an upload's headers, as the recording's takes
 * them.
 */
const PHONE_AUDIO_SCRIPT = [
  ...COPY_PREAMBLE,
  `[ -f "$src" ] && [ -r "$src" ] || exit ${PHONE_VIDEO_EXIT.NO_FILE}`,
  `command -v ffmpeg >/dev/null 2>&1 || exit ${PHONE_VIDEO_EXIT.NO_ENCODER}`,
  "out=$(mktemp -d) || exit 1",
  "trap 'rm -rf \"$out\"' EXIT",
  ...AUDIO_ENCODINGS.flatMap((bitrate) => [
    `timeout ${ENCODE_SECONDS} ffmpeg -nostdin -loglevel error -protocol_whitelist file -f ogg -i "file:$src" -map 0:a:0 -vn -c:a aac -b:a ${bitrate} -movflags +faststart -f mp4 -y "$out/copy.m4a" || exit ${PHONE_VIDEO_EXIT.ENCODER}`,
    '[ "$(stat -c %s "$out/copy.m4a")" -le "$max" ] && { deliver "$out/copy.m4a"; exit $?; }',
  ]),
  `exit ${PHONE_VIDEO_EXIT.TOO_LARGE}`,
].join("\n");

/** Makes an MP4 of the WebM at the absolute path, as the sandbox's default user; read its run with `phoneVideoOf`. */
export function phoneVideoAsk(path: string): CommandAsk {
  return {
    command: "bash",
    args: [
      "-c",
      PHONE_VIDEO_SCRIPT,
      PHONE_VIDEO_SCRIPT_NAME,
      path,
      String(PHONE_VIDEO_BOUNDS.MAX_BYTES),
    ],
  };
}

/** The copy a run printed; nothing where it made none, or what it printed is no MP4 the phone streams. */
export function phoneVideoOf(run: Pick<CommandRun, "exitCode" | "stdout">): Uint8Array | undefined {
  if (run.exitCode !== 0) return undefined;
  const bytes = new Uint8Array(Buffer.from(run.stdout.trim(), "base64"));

  if (bytes.byteLength > PHONE_VIDEO_BOUNDS.MAX_BYTES || !streamableMp4(bytes)) return undefined;

  return bytes;
}

/** Makes an AAC M4A of the Ogg clip at the absolute path, as the sandbox's default user; read its run with `phoneAudioOf`. */
export function phoneAudioAsk(path: string): CommandAsk {
  return {
    command: "bash",
    args: [
      "-c",
      PHONE_AUDIO_SCRIPT,
      PHONE_AUDIO_SCRIPT_NAME,
      path,
      String(PHONE_VIDEO_BOUNDS.MAX_BYTES),
    ],
  };
}

/** The clip's copy a run printed; nothing where it made none, or what it printed is no M4A of sound alone. */
export function phoneAudioOf(run: Pick<CommandRun, "exitCode" | "stdout">): Uint8Array | undefined {
  if (run.exitCode !== 0) return undefined;
  const bytes = new Uint8Array(Buffer.from(run.stdout.trim(), "base64"));

  if (bytes.byteLength > PHONE_VIDEO_BOUNDS.MAX_BYTES || !mp4IsSoundOnly(bytes)) return undefined;

  return bytes;
}

/** Makes an MP4 of the WebM at the absolute path and uploads it to the presigned URL, as the sandbox's default user; read its run with `uploadedCopySizeOf`. */
export function phoneVideoUploadAsk(path: string, upload: SandboxUpload): CommandAsk {
  const parts = uploadCommandParts(upload);

  return {
    command: "bash",
    args: [
      "-c",
      PHONE_VIDEO_SCRIPT,
      PHONE_VIDEO_SCRIPT_NAME,
      path,
      String(PHONE_VIDEO_BOUNDS.MAX_BYTES),
      ...parts.headers,
    ],
    env: parts.env,
  };
}

/** Makes an AAC M4A of the Ogg clip at the absolute path and uploads it to the presigned URL, as `phoneVideoUploadAsk` does a recording's. */
export function phoneAudioUploadAsk(path: string, upload: SandboxUpload): CommandAsk {
  const parts = uploadCommandParts(upload);

  return {
    command: "bash",
    args: [
      "-c",
      PHONE_AUDIO_SCRIPT,
      PHONE_AUDIO_SCRIPT_NAME,
      path,
      String(PHONE_VIDEO_BOUNDS.MAX_BYTES),
      ...parts.headers,
    ],
    env: parts.env,
  };
}

/** Whether an upload's run says it made and uploaded a copy; what landed is read back from the store, never taken from the run. */
export function copyUploaded(run: Pick<CommandRun, "exitCode">): boolean {
  return run.exitCode === 0;
}
