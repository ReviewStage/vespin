import type { ReportAttributes } from "../effect/seams.js";

/**
 * Writes one line to stderr, and loses it rather than throwing when stderr is
 * gone. A development launch's stderr is a pipe to the terminal that started
 * it, and stopping the app from that terminal closes the pipe before the quit
 * finishes tearing down; a write then fails with EIO or EPIPE, and an
 * uncaught one would end the quit in Electron's error dialog. A line that has
 * nobody left to read it is the one thing this reporter may drop.
 */
function writeLine(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Nothing reads a closed pipe; the quit goes on.
  }
}

/** A reported line as a log keeps it: the line, and why and which try it was after it where it says. */
export function reportedLine(message: string, attributes?: ReportAttributes): string {
  const said = [
    attributes?.reason,
    attributes?.attempt === undefined ? undefined : `attempt ${attributes.attempt}`,
  ].filter((part) => part !== undefined);

  return said.length === 0 ? message : `${message} (${said.join(", ")})`;
}

/** The reporter every caller holds: the line as `reportedLine` writes it. */
export function reportToStderr(message: string, attributes?: ReportAttributes): void {
  writeLine(reportedLine(message, attributes));
}

/**
 * A pipe can also fail after the write was accepted, and Node raises that on
 * the stream as an `error` event, which is uncaught unless something listens.
 */
export function tolerateClosedStderr(): void {
  process.stderr.on("error", () => undefined);
}
