import assert from "node:assert/strict";
import { test } from "vitest";
import { OUT_OF_MEMORY_OFFER, outOfMemoryOffer } from "./sandbox-size.js";

test.each([
  {
    case: "the next size up",
    killedGb: 4,
    vcpus: 2,
    offer: { kind: OUT_OF_MEMORY_OFFER.RAISE, vcpus: 4, memoryGb: 8 },
  },
  {
    case: "the size it already chose, larger than the command ran with",
    killedGb: 4,
    vcpus: 8,
    offer: { kind: OUT_OF_MEMORY_OFFER.RAISED, memoryGb: 16 },
  },
  {
    case: "nothing past the largest size",
    killedGb: 16,
    vcpus: 8,
    offer: { kind: OUT_OF_MEMORY_OFFER.NONE },
  },
])("a command killed out of memory offers $case", ({ killedGb, vcpus, offer }) => {
  assert.deepEqual(outOfMemoryOffer(killedGb, vcpus), offer);
});
