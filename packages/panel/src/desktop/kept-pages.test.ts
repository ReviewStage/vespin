import assert from "node:assert/strict";
import { pageTab } from "@repo/ui/tab-strip-model";
import { test } from "vitest";
import { keptPagesAfter } from "./kept-pages.js";

/**
 * kept-pages.test.ts -- a panel keeps at most three page tabs drawn, letting
 * go of the one shown longest ago, and draws those it keeps in the order it
 * first kept them.
 */

const [FUNNEL, RETENTION, PRICING, ONBOARDING] = [
  "funnel",
  "retention",
  "pricing",
  "onboarding",
].map((id) => pageTab(id));

test("a fourth page shown lets go of the page shown longest ago, and those kept stay in the order they were first kept", () => {
  assert.ok(FUNNEL && RETENTION && PRICING && ONBOARDING);
  const open = [FUNNEL, RETENTION, PRICING, ONBOARDING];

  // The funnel, the retention, and the pricing pages are shown in turn, then the funnel again.
  const kept = [FUNNEL, RETENTION, PRICING, FUNNEL].reduce(
    (was, shown) => keptPagesAfter(was, open, shown),
    keptPagesAfter([], open, undefined),
  );

  const after = keptPagesAfter(kept, open, ONBOARDING);
  assert.deepEqual(
    after.map((each) => each.tab),
    [FUNNEL, PRICING, ONBOARDING],
  );
});
