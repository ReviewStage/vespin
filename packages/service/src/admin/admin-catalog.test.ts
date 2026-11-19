import assert from "node:assert/strict";
import { ADMIN_TURN_PIPELINE } from "@repo/features/admin-catalog-wire";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { test } from "vitest";
import { buildAdminCatalog } from "./admin-catalog.js";

/**
 * The catalog's own reckoning: each prompt's sections add up to the whole
 * of it, an agent's instructions are measured as an agent on a task is
 * told them, and the pipeline is the queue the deployment's environment picks.
 */

test("a prompt's sections add up to its text", () => {
  const catalog = buildAdminCatalog(0, undefined);

  for (const prompt of catalog.prompts) {
    const total = prompt.sections.reduce((sum, section) => sum + section.chars, 0);

    assert.equal(total, prompt.chars, prompt.label);
  }
});

test("an agent's instructions are measured as an agent on a task reads them, its page line among them", () => {
  const instructions = buildAdminCatalog(0, undefined).prompts.filter(
    (prompt) => prompt.source === "coderInstructions",
  );

  assert.notEqual(instructions.length, 0);

  for (const prompt of instructions) {
    assert.ok(prompt.text.includes(`\`${AGENT_TOOL.SHOW_PAGE}\``), prompt.label);
  }
});

test("a production or preview deployment queues its turns, and any other runs them in process", () => {
  assert.equal(buildAdminCatalog(0, "preview").pipeline, ADMIN_TURN_PIPELINE.VERCEL_QUEUES);
  assert.equal(buildAdminCatalog(0, undefined).pipeline, ADMIN_TURN_PIPELINE.IN_PROCESS);
});
