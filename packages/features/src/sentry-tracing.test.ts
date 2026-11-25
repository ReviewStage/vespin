/**
 * sentry-tracing.test.ts -- which requests a window traces, every one but its own reports to main, and the stall a request's span says.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  SENTRY_LOOP_STALL_ATTRIBUTE,
  sentryTracesRequest,
  spanWithLoopStall,
} from "./sentry-tracing.js";

test("a renderer's report to main is never traced", () => {
  assert.equal(sentryTracesRequest("sentry-ipc://envelope/sentry_key"), false);
  assert.equal(sentryTracesRequest("sentry-ipc://scope/sentry_key"), false);
  assert.equal(sentryTracesRequest("SENTRY-IPC://envelope/sentry_key"), false);
});

test("every other request is traced", () => {
  assert.equal(sentryTracesRequest("https://ui-avatar.livekit.cloud/rtc/v1/validate"), true);
  assert.equal(sentryTracesRequest("/marks/codex-16.png"), true);
});

test("a request that only names the scheme elsewhere is still traced", () => {
  assert.equal(sentryTracesRequest("https://example.com/?next=sentry-ipc://envelope"), true);
});

test("a request's span says the longest stall within its own times, in milliseconds, and no other span is touched", () => {
  // A process that stood still the whole of any stretch it is asked about.
  const stoodStill = (from: number, to: number) => to - from;

  // Sentry times a span in seconds: this request lasted 1.25 s.
  const request = {
    start_timestamp: 1_700_000_000.25,
    end_timestamp: 1_700_000_001.5,
    attributes: { "sentry.op": "http.client" },
  };

  const mirror = { ...request, attributes: { "sentry.op": "default" } };

  assert.deepEqual(spanWithLoopStall(request, stoodStill).attributes, {
    "sentry.op": "http.client",
    [SENTRY_LOOP_STALL_ATTRIBUTE]: 1_250,
  });
  assert.equal(spanWithLoopStall(mirror, stoodStill), mirror);
});
