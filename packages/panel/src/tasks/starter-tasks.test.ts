import { describe, expect, it } from "vitest";
import { STARTER, startersFor } from "./starter-tasks.js";

describe("startersFor", () => {
  it.each([
    {
      has: { repository: false, mac: false },
      offered: [STARTER.LIVE_APP, STARTER.SITE_WALKTHROUGH],
    },
    {
      has: { repository: true, mac: false },
      offered: [STARTER.RACE_FIXES, STARTER.DAILY_BRIEFING, STARTER.LIVE_APP],
    },
    {
      has: { repository: false, mac: true },
      offered: [STARTER.CODEX_HISTORY, STARTER.LIVE_APP, STARTER.SITE_WALKTHROUGH],
    },
  ])("offers only what $has can run, at most three", ({ has, offered }) => {
    expect(startersFor(has).map((task) => task.starter)).toEqual(offered);
  });
});
