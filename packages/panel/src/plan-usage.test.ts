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
const WEEK_MINS = 7 * 24 * 60;

const PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  hint: "…41d0",
  addedAt: 0,
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: 0,
  id: "plan",
  position: 0,
};

test("a plan's windows are named by their length and any one model they count, a session's reset a countdown and a week's its weekday and time, a full one in the attention ink, and a reading past fifteen minutes says when it was heard", () => {
  const weekResetsAt = NOW + 4 * 24 * 60 * MINUTE;
  const meters = planUsageMeters(
    {
      ...PLAN,
      usageWindows: [
        { usedPercent: 100, windowMins: 300, resetsAt: NOW + 90 * MINUTE },
        { usedPercent: 64, windowMins: WEEK_MINS, resetsAt: weekResetsAt },
        { usedPercent: 12, windowMins: WEEK_MINS, model: "Opus", resetsAt: weekResetsAt },
      ],
      usageHeardAt: NOW - 2 * 60 * MINUTE,
    },
    NOW,
  );

  assert.deepEqual(
    meters?.rows.map((row) => [row.label, row.usedPercent, row.tone]),
    [
      ["5-hour", 100, PROGRESS_TONE.ATTENTION],
      ["Weekly", 64, PROGRESS_TONE.WORKING],
      ["Weekly (Opus)", 12, PROGRESS_TONE.WORKING],
    ],
  );
  const [session, week, opus] = meters?.rows.map((row) => row.resets) ?? [];
  assert.equal(session, "in 1h");
  // Note that the weekday and hour are the reader's own time zone's, so the words are held to their shape: "Sat 12:00 PM".
  assert.match(week ?? "", /^[A-Z][a-z]{2} \d{1,2}:\d{2}\s[AP]M$/u);
  assert.equal(opus, week);
  assert.equal(meters?.heard, "Updated 2h ago");
  assert.equal(
    planUsageMeters({ ...PLAN, usageWindows: [], usageHeardAt: NOW - MINUTE }, NOW),
    undefined,
  );
});
