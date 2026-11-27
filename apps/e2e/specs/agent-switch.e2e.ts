// agent-switch.e2e.ts -- a member switches between a task's agents, and each transcript opens on its newest line.

import type { Page } from "@playwright/test";
import { expect, test } from "../support/signed-in.js";

const TASK_NAME = "Switch between agents";

/** The scripted turns long enough that a transcript scrolls, the second twice the first (`scripted-agent-sessions.ts`), and each one's last words. */
const LONG_TURN = {
  SHORTER: { CUE: "[script:long]", LAST_WORDS: "Step 24 of 24 is done." },
  LONGER: { CUE: "[script:longer]", LAST_WORDS: "Step 48 of 48 is done." },
} as const;

test.use({ memberAsk: { taskName: TASK_NAME, credential: true, setupFinished: true } });

/** How far, in pixels, the shown transcript stands above its end. */
function gapToEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const log = [...document.querySelectorAll<HTMLElement>('[role="log"]')].find(
      (each) => each.clientHeight > 0,
    );

    return log === undefined
      ? Number.POSITIVE_INFINITY
      : log.scrollHeight - log.clientHeight - log.scrollTop;
  });
}

/** Starts an agent from the task's New agent pane on a long turn, and waits for the turn's end. */
async function startAgent(page: Page, cue: string): Promise<void> {
  const start = page.getByRole("region", { name: "New agent" });
  await start
    .getByRole("textbox", { name: "Message to the agent" })
    .fill(`Walk through it. ${cue}`);
  await start.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log").getByText(/^Worked for /)).toBeVisible();
}

/** Waits until the window has drawn twice more, so whatever a step does after its first frame has landed. */
function twoFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/**
 * The regression this catches: a transcript opened from another agent's tab
 * standing short of its newest line, as one did once the room at a log's end
 * (`--conversation-log-end`, which the log reads only once it has drawn) came
 * in under it after its opening scroll had settled, moving the end and not
 * the log. The member starts two agents on the same task, the second on a
 * turn twice as long, so both transcripts scroll; shown the first, then the
 * second, each stands at its end. The gap is read once the newest words are
 * in view and the window has drawn twice more, since what moves the end
 * lands after the log's own opening scroll. Then the reader turns the wheel
 * up, which the log keeps to, offering the way back to its end; and moves
 * focus, then a selection, to an earlier line with no key or wheel, as a
 * screen reader and a find in the page do, which the log keeps to as well.
 */
test("a transcript opened from another agent's tab opens on its newest line", async ({
  page,
  signedIn,
}) => {
  expect(signedIn.taskId).toBeDefined();

  await page.goto("/app");
  await page
    .getByRole("navigation", { name: "My tasks" })
    .getByRole("button", { name: new RegExp(`^${TASK_NAME}\\b`) })
    .click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(TASK_NAME);

  await startAgent(page, LONG_TURN.SHORTER.CUE);
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await startAgent(page, LONG_TURN.LONGER.CUE);

  // The second agent, just started, is the one shown.
  const agentTabs = page.getByRole("tablist", { name: "Agents" }).getByRole("tab");
  await expect(agentTabs).toHaveCount(2);

  const shown = await agentTabs.evaluateAll((tabs) =>
    tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"),
  );

  const [longer, shorter] = [agentTabs.nth(shown), agentTabs.nth(1 - shown)];

  // Note that the switch is made twice, since what moves the end races the log's own opening scroll and lands after it most times, not every time.
  for (let round = 0; round < 2; round += 1) {
    await shorter.click();
    await expect(page.getByRole("log").getByText(LONG_TURN.SHORTER.LAST_WORDS)).toBeVisible();
    await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);

    await longer.click();
    await expect(page.getByRole("log").getByText(LONG_TURN.LONGER.LAST_WORDS)).toBeVisible();
    await twoFrames(page);
    expect(await gapToEnd(page)).toBeLessThanOrEqual(1);
  }

  // The reader turns the wheel up: the log stays where they took it and offers the way back, which takes it to its end.
  const log = page.getByRole("log");
  await log.hover();
  await page.mouse.wheel(0, -400);
  const back = page.getByRole("button", { name: "Scroll to the newest line" });
  await expect(back).toBeVisible();
  await twoFrames(page);
  expect(await gapToEnd(page)).toBeGreaterThan(100);
  await back.click();
  await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);

  // Focus moved to an earlier message with no key, as a screen reader moves it, keeps the log on it, offering the way back.
  await log.getByRole("button", { name: "Copy message" }).first().focus();
  await expect(back).toBeVisible();
  await twoFrames(page);
  expect(await gapToEnd(page)).toBeGreaterThan(100);
  await back.click();
  await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);

  // So does a selection moved to an earlier line and scrolled to, as a find in the page does.
  await log.getByText("Step 1 of 48 is done.").evaluate((line) => {
    const found = document.createRange();
    found.selectNodeContents(line);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(found);
    line.scrollIntoView({ block: "center" });
  });
  await expect(back).toBeVisible();
  await twoFrames(page);
  expect(await gapToEnd(page)).toBeGreaterThan(100);
});
