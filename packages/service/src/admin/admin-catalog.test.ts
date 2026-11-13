import assert from "node:assert/strict";
import { ADMIN_TURN_PIPELINE } from "@repo/features/admin-catalog-wire";
import { test } from "vitest";
import { buildAdminCatalog } from "./admin-catalog.js";

/**
 * The catalog's own reckoning: each prompt's sections add up to the whole
 * of it under the headings its text names, and the pipeline is the queue the
 * deployment's environment picks.
 */

test("a prompt's sections add up to its text, the coding agent's named by their headings", () => {
  const catalog = buildAdminCatalog(0, undefined);

  for (const prompt of catalog.prompts) {
    const total = prompt.sections.reduce((sum, section) => sum + section.chars, 0);

    assert.equal(total, prompt.chars, prompt.label);
  }

  const instructions = catalog.prompts[0];

  assert.ok(instructions?.sections.some((section) => section.heading === "How to work"));
});

test("a production or preview deployment queues its turns, and any other runs them in process", () => {
  assert.equal(buildAdminCatalog(0, "preview").pipeline, ADMIN_TURN_PIPELINE.VERCEL_QUEUES);
  assert.equal(buildAdminCatalog(0, undefined).pipeline, ADMIN_TURN_PIPELINE.IN_PROCESS);
});
