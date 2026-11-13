/**
 * sentry-line.test.ts -- a reported line reaches Sentry at the level its words and its try call for, as our own words alone.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { ReportAttributes } from "./effect/seams.js";
import { type SentryLineSink, sendLineToSentry } from "./sentry-line.js";

/** What a fake Sentry was sent, by the call it was sent through. */
const sentTo = (message: string, attributes?: ReportAttributes) => {
  const sent: { call: string; message: string; data: ReportAttributes }[] = [];

  const sink: SentryLineSink = {
    captureMessage: (line, context) => {
      sent.push({ call: "error", message: line, data: context.extra });

      return "event";
    },
    logger: {
      info: (line, data) => sent.push({ call: "info", message: line, data }),
      warn: (line, data) => sent.push({ call: "warn", message: line, data }),
    },
  };

  sendLineToSentry(sink, message, attributes);

  return sent;
};

it.each([
  {
    case: "a step tried again is a warning before it persists",
    message: "this Mac's host: could not register it, so it is tried again",
    attributes: { reason: "macOS did not register it: not-registered", attempt: 4 },
    call: "warn",
  },
  {
    case: "a step still failing at its 5th try is an error",
    message: "this Mac's host: could not register it, so it is tried again",
    attributes: { reason: "macOS did not register it: not-registered", attempt: 5 },
    call: "error",
  },
  {
    case: "a failure not tried again is an error",
    message: "this Mac's host: could not remove it",
    attributes: undefined,
    call: "error",
  },
  {
    case: "a line that says nothing failed is a log line",
    message: "this Mac's host was registered",
    attributes: undefined,
    call: "info",
  },
])("$case", ({ message, attributes, call }) => {
  assert.deepEqual(sentTo(message, attributes), [{ call, message, data: { ...attributes } }]);
});

it("sends a line only up to what its step said of itself, leaving what a command printed behind", () => {
  assert.deepEqual(sentTo("this Mac's host: could not install it: curl: (6) host not found"), [
    { call: "error", message: "this Mac's host: could not install it", data: {} },
  ]);
});
