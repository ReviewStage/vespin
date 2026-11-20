import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import { managerCreateRequestSchema } from "./manager-wire.js";

/** A workspace's id as the auth service mints an organization's: 32 letters and digits, no UUID. */
const WORKSPACE_ID = "Q7mXk2vR9tLpW4nB8cYhJ3dF6sGzA1eU";

test("a Manager's request names its workspace by the id the auth service minted", () => {
  const request = Schema.decodeUnknownSync(managerCreateRequestSchema)({
    idempotencyKey: "create-billing",
    workspaceId: WORKSPACE_ID,
    name: "Billing",
    repositories: ["acme/relay"],
    runsOn: { machine: "vercel" },
    model: "anthropic/claude-opus-5.5",
    effort: "high",
  });

  assert.equal(request.workspaceId, WORKSPACE_ID);
});
