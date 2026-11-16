import { describe, expect, it } from "vitest";
import { STARTER, startersFor } from "./starter-tasks.js";

describe("startersFor", () => {
  it.each([
    {
      has: { repository: false, connectable: false, mac: false },
      offered: [
        [STARTER.LIVE_APP, true],
        [STARTER.SITE_WALKTHROUGH, true],
      ],
    },
    {
      has: { repository: false, connectable: true, mac: true },
      offered: [
        [STARTER.AGENT_HISTORY, true],
        [STARTER.LIVE_APP, true],
        [STARTER.SITE_WALKTHROUGH, true],
        [STARTER.RACE_FIXES, false],
        [STARTER.SMALL_FIX, false],
        [STARTER.DAILY_BRIEFING, false],
      ],
    },
    {
      has: { repository: true, connectable: false, mac: false },
      offered: [
        [STARTER.RACE_FIXES, true],
        [STARTER.SMALL_FIX, true],
        [STARTER.DAILY_BRIEFING, true],
        [STARTER.LIVE_APP, true],
        [STARTER.SITE_WALKTHROUGH, true],
      ],
    },
  ])("offers what $has can run first, then what needs GitHub connected", ({ has, offered }) => {
    expect(startersFor(has).map(({ task, runnable }) => [task.starter, runnable])).toEqual(offered);
  });
});
