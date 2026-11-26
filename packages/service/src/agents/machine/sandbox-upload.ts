/**
 * sandbox-upload.ts -- the commands by which an agent's sandbox says what a file is and uploads it to the Blob store itself, by a presigned URL, so its bytes never pass through a function as base64.
 *
 * A file an agent shows or posts is probed first (`probeFileAsk`): its size
 * and its first bytes, enough for the service to sniff its type and hold it
 * to its bound before anything is uploaded. The service then presigns one
 * upload of that type, at most that size, to the one pathname the
 * attachment's id names, for a couple of minutes, and the sandbox puts the
 * file there with curl (`uploadFileAsk`). The phone's copy of a recording
 * or a clip is uploaded the same way by the script that makes it
 * (`phone-video.ts`), through the same function (`UPLOAD_FUNCTION`).
 *
 * The presigned URL is a bearer of that one upload. It reaches the command
 * in its environment (`UPLOAD_URL_VARIABLE`), never its arguments, and
 * curl reads it from its standard input, so it stands on no process's
 * command line where another process of the sandbox, or a trace of the
 * command, would read it; the command's span names its call alone. Note
 * that the agent's own code runs in the same sandbox, so the URL is treated
 * as one the model may see: it takes one upload, of one type and bound, to
 * one pathname, that replaces nothing, and is never handed out twice. What
 * curl answers is not trusted either way: the service reads back what the
 * store holds once the command ends, which is what the row is written from.
 */

import type { CommandAsk, CommandRun } from "@repo/sandbox";

/** The environment variable a command reads its presigned URL from. */
export const UPLOAD_URL_VARIABLE = "VESPIN_UPLOAD_URL";

/** How a probe or an upload ends where the path names no file the sandbox's user may read. */
const SANDBOX_UPLOAD_EXIT = { NO_FILE: 3 } as const;

/** The most seconds one upload may take, inside a tool call's own bound. */
const UPLOAD_SECONDS = 60;

/**
 * A bash function, `upload <file>`, that puts the file at the presigned URL
 * in the environment with the headers in the `headers` array; the caller
 * fills the array. Note that curl takes the URL as a config line on its
 * standard input (`-K -`), printed by bash's own `printf`, which spawns no
 * process, so the URL is in no argv.
 */
export const UPLOAD_FUNCTION = [
  "upload() {",
  `  printf 'url = "%s"\\n' "$${UPLOAD_URL_VARIABLE}" | timeout ${UPLOAD_SECONDS + 5} curl -sS --fail --max-time ${UPLOAD_SECONDS} -X PUT -T "$1" "\${headers[@]}" -o /dev/null -K -`,
  "}",
].join("\n");

/** The script a probe runs: the size on one line, then the first bytes as base64. */
const PROBE_SCRIPT = [
  "set -o pipefail",
  `[ -f "$1" ] && [ -r "$1" ] || exit ${SANDBOX_UPLOAD_EXIT.NO_FILE}`,
  'stat -c %s -- "$1"',
  `head -c "$2" -- "$1" | base64 | tr -d '\\n'`,
].join("\n");

/** The script an upload runs: the path, then each header as `name: value`. */
const UPLOAD_SCRIPT = [
  "set -o pipefail",
  'f="$1"; shift',
  `[ -f "$f" ] && [ -r "$f" ] || exit ${SANDBOX_UPLOAD_EXIT.NO_FILE}`,
  'headers=(); for h in "$@"; do headers+=(-H "$h"); done',
  UPLOAD_FUNCTION,
  'upload "$f"',
].join("\n");

/** The name the scripts run under, as `$0`. */
const PROBE_SCRIPT_NAME = "probe-file";
const UPLOAD_SCRIPT_NAME = "upload-file";

/** A presigned upload as a command carries it: the URL, which goes into its environment alone, and the headers it sends. */
export interface SandboxUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What a file is, as a probe read it: its size, and its first bytes. */
export interface FileProbe {
  readonly size: number;
  readonly head: Uint8Array;
}

/**
 * The URL as a config line takes it. Note that we refuse one that would
 * break out of its quotes, since a presigned URL is percent-encoded and
 * never holds a quote, a backslash, or a line break.
 */
function assertConfigSafe(url: string): void {
  if (/["\\\r\n]/.test(url)) {
    throw new Error("sandbox-upload: a presigned URL holds no quote, backslash, or line break.");
  }
}

/** The headers as curl's `-H` takes each: `name: value`. */
function headerArgs(headers: Readonly<Record<string, string>>): string[] {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
}

/** What an upload's command carries beside its script: the environment its URL stands in, and the headers it sends as trailing arguments. */
interface UploadCommandParts {
  readonly env: Readonly<Record<string, string>>;
  readonly headers: readonly string[];
}

/** The environment and trailing arguments an upload's command carries. */
export function uploadCommandParts(upload: SandboxUpload): UploadCommandParts {
  assertConfigSafe(upload.url);

  return { env: { [UPLOAD_URL_VARIABLE]: upload.url }, headers: headerArgs(upload.headers) };
}

/** Reads the file's size and first `headBytes` bytes, as the sandbox's default user; read its run with `fileProbeOf`. */
export function probeFileAsk(path: string, headBytes: number): CommandAsk {
  return {
    command: "bash",
    args: ["-c", PROBE_SCRIPT, PROBE_SCRIPT_NAME, path, String(headBytes)],
  };
}

/** What a probe printed; nothing where there was no file, or it printed no size. */
export function fileProbeOf(run: Pick<CommandRun, "exitCode" | "stdout">): FileProbe | undefined {
  if (run.exitCode !== 0) return undefined;
  const lineEnd = run.stdout.indexOf("\n");

  if (lineEnd < 0) return undefined;
  const size = Number(run.stdout.slice(0, lineEnd));

  if (!Number.isSafeInteger(size) || size < 0) return undefined;
  const head = new Uint8Array(Buffer.from(run.stdout.slice(lineEnd + 1).trim(), "base64"));

  return { size, head };
}

/** Uploads the file at the path to the presigned URL, as the sandbox's default user; what landed is read back from the store, never from the run. */
export function uploadFileAsk(path: string, upload: SandboxUpload): CommandAsk {
  const parts = uploadCommandParts(upload);

  return {
    command: "bash",
    args: ["-c", UPLOAD_SCRIPT, UPLOAD_SCRIPT_NAME, path, ...parts.headers],
    env: parts.env,
  };
}
