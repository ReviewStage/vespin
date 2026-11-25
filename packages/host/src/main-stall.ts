/**
 * main-stall.ts -- a stall of the desktop's main process, as the watcher beside it catches one: how long main stopped answering, and the stack it was caught in, as Sentry reads a stack.
 *
 * Main counts each tick of its loop timer into memory it shares with a
 * worker thread, which waits on it
 * (`apps/desktop/src/utility/stall-watch.ts`). Where a tick comes
 * `STALL_MS` late, the worker pauses main through main's own inspector, in
 * process, takes the stack it paused in, and lets it go on; once main ticks
 * again, the worker hands main how long it stood still and that stack, and
 * main reports it through its own Sentry, on its usage data switch and
 * token filters.
 *
 * A stack is the paused frames' function names and the files they ran
 * from, never a value a frame held: no scope is ever read.
 */

import { fileURLToPath } from "node:url";

/** How the watch is paced, in milliseconds. */
export const MAIN_STALL = {
  /** How late main's tick (`LOOP_TICK_MS`) may come before main has stalled. */
  STALL_MS: 150,
  /** How often the worker looks for main's next tick once it has stalled. */
  POLL_MS: 25,
} as const;

/** The most frames a stall's stack keeps, the innermost first to stay. */
const FRAMES_KEPT = 100;

/** The scheme the inspector names a file main loaded by. */
const FILE_URL = "file://";

/** One frame main paused in, as the inspector's `Debugger.paused` says it, its line and column from 0. */
export interface PausedFrame {
  readonly functionName: string;
  readonly location: {
    readonly scriptId: string;
    readonly lineNumber: number;
    readonly columnNumber?: number | undefined;
  };
}

/** One frame of a stall's stack, as Sentry reads a stack frame, its line and column from 1. */
export interface StallFrame {
  readonly filename: string;
  readonly function: string;
  readonly lineno: number;
  readonly colno: number;
  readonly in_app: boolean;
}

/** One stall, as the worker hands it to main: how long main stood still, and the stack it was caught in, if the pause landed while it did. */
export interface MainStall {
  readonly durationMs: number;
  readonly frames: readonly StallFrame[] | undefined;
}

/** A script's address as a stack names its file: a file's path, or the address as it stands. */
function filenameOf(url: string): string {
  return url.startsWith(FILE_URL) ? fileURLToPath(url) : url;
}

/**
 * The frames main paused in as a stall's stack, oldest first as Sentry
 * reads one, each named by the file `scripts` says its script was loaded
 * from. A frame of the app's own files is the app's; one of Node's, or of a
 * dependency's, is not.
 */
export function stallFrames(
  paused: readonly PausedFrame[],
  scripts: ReadonlyMap<string, string>,
): StallFrame[] {
  return paused
    .slice(0, FRAMES_KEPT)
    .map((frame) => {
      const url = scripts.get(frame.location.scriptId) ?? "";

      return {
        filename: url === "" ? "<anonymous>" : filenameOf(url),
        function: frame.functionName === "" ? "<anonymous>" : frame.functionName,
        lineno: frame.location.lineNumber + 1,
        colno: (frame.location.columnNumber ?? 0) + 1,
        in_app: url.startsWith(FILE_URL) && !url.includes("/node_modules/"),
      };
    })
    .reverse();
}
