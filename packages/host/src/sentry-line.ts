/**
 * sentry-line.ts -- a line the host reports, sent to Sentry up to what its step said of itself, as an error, a warning, or a log line.
 *
 * A step that is tried again until it lands (`ReportAttributes.attempt`) is
 * a warning at each try, so a failure that heals on its own opens no issue,
 * and an error once, at its `ESCALATES_AT`th try, so one that persists
 * still does. A line that says something failed and is not tried again is
 * an error, and any other line is a log line. Why and which try go beside
 * the line as data, so one kind of failure stays one issue.
 *
 * Only the line's own words leave: what a command or a file printed after
 * them stays where the line was written.
 */

import type { ReportAttributes } from "./effect/seams.js";

/** The try at which a step still failing is sent as an error: the 5th, about five minutes in on This Mac's backoff. */
const ESCALATES_AT = 5;

/** Whether a line says something failed. */
const FAILING = /could not|couldn't|failed|refused/i;

const LINE_LEVEL = { ERROR: "error", WARNING: "warning", INFO: "info" } as const;

type LineLevel = (typeof LINE_LEVEL)[keyof typeof LINE_LEVEL];

/** The calls of a process's Sentry SDK a line is sent through, as `@sentry/node` and `@sentry/electron/main` both export them. */
export interface SentryLineSink {
  /** The event's id. */
  readonly captureMessage: (
    message: string,
    context: { readonly level: "error"; readonly extra: ReportAttributes },
  ) => string;
  readonly logger: {
    readonly info: (message: string, attributes: ReportAttributes) => void;
    readonly warn: (message: string, attributes: ReportAttributes) => void;
  };
}

/** A reported line up to what a step said of itself: `this Mac's host: could not install it` of `…: <stderr>`. */
function ownWords(message: string): string {
  return message.split(": ").slice(0, 2).join(": ");
}

/** The level a line is sent at, by which try it was where it is tried again, and by its words otherwise. */
function levelOf(ours: string, attempt: number | undefined): LineLevel {
  if (attempt !== undefined)
    return attempt === ESCALATES_AT ? LINE_LEVEL.ERROR : LINE_LEVEL.WARNING;

  return FAILING.test(ours) ? LINE_LEVEL.ERROR : LINE_LEVEL.INFO;
}

/** A line sent to Sentry: an error event, a warning log, or an info log, with its attributes beside it. */
export function sendLineToSentry(
  sentry: SentryLineSink,
  message: string,
  attributes?: ReportAttributes,
): void {
  const ours = ownWords(message);
  const data = { ...attributes };
  const level = levelOf(ours, attributes?.attempt);

  if (level === LINE_LEVEL.ERROR) sentry.captureMessage(ours, { level: "error", extra: data });
  else if (level === LINE_LEVEL.WARNING) sentry.logger.warn(ours, data);
  else sentry.logger.info(ours, data);
}
