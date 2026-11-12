import assert from "node:assert/strict";
import { test } from "vitest";
import { hostedContract } from "./index.js";

test("a released desktop's task start whose agent names repositories beside the task's is taken", async () => {
  const [input] = hostedContract.plans.create["~orpc"].inputSchemas ?? [];
  assert.ok(input !== undefined);

  const read = await input["~standard"].validate({
    name: "Relay",
    agent: {
      idempotencyKey: "start-1",
      prompt: "Fix the relay",
      alsoRepositories: [{ repository: "octo-member/side" }],
    },
  });

  assert.equal(read.issues, undefined);
});
