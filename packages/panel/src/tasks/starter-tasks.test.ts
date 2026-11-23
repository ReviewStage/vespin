import { describe, expect, it } from "vitest";
import { STARTER, STARTER_TASKS, draftWithStarter, startersFor } from "./starter-tasks.js";

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

describe("draftWithStarter", () => {
  const starter = (name: string) => {
    const task = STARTER_TASKS.find((each) => each.starter === name);

    if (task === undefined) throw new Error(`no starter ${name}`);

    return task;
  };

  const first = starter(STARTER.SITE_WALKTHROUGH);
  const second = starter(STARTER.LIVE_APP);

  it.each([
    { typed: "  ", task: first, draft: first.prompt },
    { typed: first.prompt, task: second, draft: second.prompt },
    { typed: "Add a health check endpoint\n", task: second, draft: `Add a health check endpoint\n\n${second.prompt}` },
  ])("keeps what was typed and swaps a starter's own words", ({ typed, task, draft }) => {
    expect(draftWithStarter(typed, task)).toBe(draft);
  });
});
