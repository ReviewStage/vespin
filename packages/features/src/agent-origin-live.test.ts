import assert from "node:assert/strict";
import { test } from "vitest";
import { agentOriginOfLive } from "./agent-origin-live.js";

/**
 * agent-origin-live.test.ts -- the run a Sentry automation fired names the
 * issue it was about, linked, as a GitHub event's names its issue or pull
 * request, so the agent's page shows what it was started on.
 */

test("an agent a Sentry issue's firing started names the issue by its title and address", () => {
  const rows = [
    {
      origin: {
        firing: {
          kind: "integration",
          provider: "sentry",
          event: "issue-created",
          subject: {
            id: "4512",
            title: "TypeError: Cannot read properties of undefined (reading 'id')",
            url: "https://acme.sentry.io/issues/4512/",
          },
        },
        prompt: "Find the cause and open a fix.",
      },
      runnerName: null,
    },
  ];

  assert.deepEqual(agentOriginOfLive(rows), {
    prompt: "Find the cause and open a fix.",
    issue: {
      provider: "sentry",
      title: "TypeError: Cannot read properties of undefined (reading 'id')",
      url: "https://acme.sentry.io/issues/4512/",
    },
  });
});
