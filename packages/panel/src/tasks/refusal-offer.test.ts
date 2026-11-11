import assert from "node:assert/strict";
import { type CatalogModel, MODEL_PROVIDER } from "@repo/features/models-wire";
import { test } from "vitest";
import { refusalOffer } from "./refusal-offer.js";

/**
 * refusal-offer.test.ts -- the model a refused turn offers to continue on:
 * the other harness where the reader runs it, else the same harness's other
 * model with the other harness to connect.
 */

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "xhigh", "max"],
};
const SONNET: CatalogModel = {
  id: "anthropic/claude-sonnet-5.5",
  name: "Claude Sonnet 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "max"],
};
const GPT: CatalogModel = {
  id: "openai/gpt-6.1-sol",
  name: "GPT-6.1 Sol",
  provider: MODEL_PROVIDER.OPENAI,
  efforts: ["low", "medium", "high", "xhigh"],
};

test("a Claude turn refused offers the Codex model a new agent starts on, at the nearest effort it lists", () => {
  const offer = refusalOffer([OPUS, SONNET, GPT], { model: OPUS.id, effort: "max" });

  assert.deepEqual(offer, {
    choice: { model: GPT.id, effort: "xhigh" },
    connect: undefined,
  });
});

test("with nothing paying for Codex, a refused Claude turn offers another Claude model and names Codex to connect", () => {
  const unpaid = { ...GPT, credentialMissing: true };
  const offer = refusalOffer([OPUS, SONNET, unpaid], { model: OPUS.id, effort: "xhigh" });

  assert.deepEqual(offer, {
    choice: { model: SONNET.id, effort: "high" },
    connect: MODEL_PROVIDER.OPENAI,
  });
});
