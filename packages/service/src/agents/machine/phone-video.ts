/**
 * phone-video.ts -- the command that makes an H.264 MP4 of an agent's WebM recording in the agent's own sandbox, for a player that plays no WebM, and the copy its run prints.
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
 * (`+faststart`) so the phone plays it as it arrives. The run prints it as
 * base64 on one line, as the machine's other reads do.
 */

import { PHONE_VIDEO_BOUNDS, streamableMp4 } from "@repo/features/video-signature";
import type { CommandAsk, CommandRun } from "@repo/sandbox";

/** How a run ends where it made no copy. */
export const PHONE_VIDEO_EXIT = {
  NO_FILE: 3,
  NO_ENCODER: 4,
  ENCODER: 5,
  TOO_LARGE: 6,
} as const;

/** The name the script runs under, as `$0`. */
const PHONE_VIDEO_SCRIPT_NAME = "phone-video";

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
 * The script, as positional parameters take it: the WebM's path and the
 * copy's most bytes. Its scratch folder is its own and removed however it
 * ends.
 */
const PHONE_VIDEO_SCRIPT = [
  "set -u -o pipefail",
  'src="$1" max="$2"',
  `[ -f "$src" ] && [ -r "$src" ] || exit ${PHONE_VIDEO_EXIT.NO_FILE}`,
  `command -v ffmpeg >/dev/null 2>&1 || exit ${PHONE_VIDEO_EXIT.NO_ENCODER}`,
  "out=$(mktemp -d) || exit 1",
  "trap 'rm -rf \"$out\"' EXIT",
  ...ENCODINGS.flatMap(({ crf, scale }) => [
    `timeout ${ENCODE_SECONDS} ffmpeg -nostdin -loglevel error -protocol_whitelist file -f matroska -i "file:$src" -an -map 0:v:0 -c:v libx264 -preset veryfast -crf ${crf} -pix_fmt yuv420p -vf "scale=${scale}" -movflags +faststart -f mp4 -y "$out/copy.mp4" || exit ${PHONE_VIDEO_EXIT.ENCODER}`,
    '[ "$(stat -c %s "$out/copy.mp4")" -le "$max" ] && { base64 -w 0 <"$out/copy.mp4"; exit 0; }',
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
