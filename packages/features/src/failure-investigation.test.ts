import assert from "node:assert/strict";
import { test } from "vitest";
import { failureInvestigation } from "./failure-investigation.js";
import { FAILURE_KIND, FAILURE_SURFACE, type ShownFailureReport } from "./shown-failure.js";

/**
 * failure-investigation.test.ts -- an investigation's prompt holds the
 * failure's message and name, the frames of its stack, the surface and act it
 * was shown on, the platform, version, build, and route, a frame's long path
 * kept whole; and a
 * credential-shaped run in the cause's message, its stack, the route's path,
 * or the build's branch is replaced, while the details' own ids are kept.
 * Synthetic throughout.
 */

/** A key shaped like a provider's, which the redaction takes whole. */
const KEY = `sk-${"x".repeat(24)}`;

/** A frame of a packaged build, whose path holds runs long enough to pass for a credential's were it redacted whole. */
const PACKAGED_FRAME =
  "file:///Applications/Vespin.app/Contents/Resources/app.asar/dist/renderer/assets/index-B3x9kQ.js:12:345";

/** A Sentry event id, which the agent needs to find the issue, as the copied details carry it. */
const EVENT_ID = "0123456789abcdef0123456789abcdef";

test("the prompt holds the failure and where it was shown, its credentials replaced and its ids kept", () => {
  const cause = new TypeError(`Cannot read properties of undefined (key ${KEY})`);
  cause.stack = `TypeError: Cannot read properties of undefined (key ${KEY})\n    at startAgent (agent-start.ts:12:3)\n    at run (${PACKAGED_FRAME})`;
  const report: ShownFailureReport = {
    surface: FAILURE_SURFACE.AGENT_START,
    kind: FAILURE_KIND.UNEXPECTED,
    cause,
    about: {},
    act: "agents.start",
    state: { online: true, account: "signed-in" },
  };
  const { name, prompt } = failureInvestigation(report, {
    details: `failure.surface: agent.start\nsentry.event_id: ${EVENT_ID}`,
    platform: "darwin",
    version: "0.24.0",
    build: { sha: "6578b07", dirty: false, branch: `fix/${KEY}` },
    packaged: true,
    route: { pattern: "/$workspace/task/$taskId", path: `/stage/task/${KEY}` },
  });
  assert.equal(name, "Investigate agent.start: TypeError");
  for (const held of [
    "Cannot read properties of undefined",
    "TypeError",
    "at startAgent (agent-start.ts:12:3)",
    "dist/renderer/assets/index-B3x9kQ.js:12:345",
    "`agent.start`",
    "`agents.start`",
    "macOS desktop app",
    "0.24.0 (release, commit 6578b07",
    "`/$workspace/task/$taskId`",
    "/stage/task/",
    EVENT_ID,
    "open a pull request",
  ]) {
    assert.ok(prompt.includes(held), `the prompt holds ${held}`);
  }
  assert.ok(!prompt.includes(KEY), "no credential reaches the prompt");
});
