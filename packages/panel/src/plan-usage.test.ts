import assert from "node:assert/strict";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { PROGRESS_TONE } from "@repo/ui";
import { test } from "vitest";
import { planUsageMeters } from "./plan-usage.js";

const NOW = Date.UTC(2026, 10, 10, 12);
const MINUTE = 60_000;

const PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
  addedAt: 0,
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: 0,
  id: "plan",
  position: 0,
};

test("a plan's windows are named by their length, shortest first, a full one in the attention ink, and a reading past fifteen minutes says when it was heard", () => {
  const meters = planUsageMeters(
    {
      ...PLAN,
      // Note that the week comes first here, as a provider's secondary window may.
      usageWindows: [
        { usedPercent: 64, windowMins: 10_080, resetsAt: NOW + 5 * 24 * 60 * MINUTE },
        { usedPercent: 100, windowMins: 300, resetsAt: NOW + 90 * MINUTE },
      ],
      usageHeardAt: NOW - 2 * 60 * MINUTE,
    },
    NOW,
  );

  assert.deepEqual(meters, {
    rows: [
      { label: "5-hour", usedPercent: 100, resets: "in 1h", tone: PROGRESS_TONE.ATTENTION },
      { label: "Weekly", usedPercent: 64, resets: "in 5d", tone: PROGRESS_TONE.WORKING },
    ],
    heard: "Updated 2h ago",
  });
  assert.equal(
    planUsageMeters({ ...PLAN, usageWindows: [], usageHeardAt: NOW - MINUTE }, NOW),
    undefined,
  );
});
