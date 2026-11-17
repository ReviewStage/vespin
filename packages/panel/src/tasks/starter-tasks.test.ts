import { describe, expect, it } from "vitest";
import { STARTER, startersFor } from "./starter-tasks.js";

describe("startersFor", () => {
  it.each([
    {
      has: { repository: false, connectable: false, mac: false },
      offered: [
        [STARTER.SITE_WALKTHROUGH, true],
        [STARTER.LIVE_APP, true],
      ],
    },
    {
      has: { repository: false, connectable: true, mac: true },
      offered: [
        [STARTER.AGENT_HISTORY, true],
        [STARTER.SITE_WALKTHROUGH, true],
        [STARTER.DAILY_BRIEFING, false],
        [STARTER.RACE_FIXES, false],
        [STARTER.SMALL_FIX, false],
        [STARTER.LIVE_APP, true],
      ],
    },
    {
      has: { repository: true, connectable: false, mac: false },
      offered: [
        [STARTER.SITE_WALKTHROUGH, true],
        [STARTER.DAILY_BRIEFING, true],
        [STARTER.RACE_FIXES, true],
        [STARTER.SMALL_FIX, true],
        [STARTER.LIVE_APP, true],
      ],
    },
  ])("offers what $has can run or connect for, in order", ({ has, offered }) => {
    expect(startersFor(has).map(({ task, runnable }) => [task.starter, runnable])).toEqual(offered);
  });
});
