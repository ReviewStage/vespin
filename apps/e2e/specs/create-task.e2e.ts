// create-task.e2e.ts -- a member past setup, with no task, creates one from New task and sees it listed and opened.

import { expect, test } from "../support/signed-in.js";

test.use({ memberAsk: { setupFinished: true } });

/**
 * The regression this catches: task creation broken anywhere between the
 * UI, the oRPC route, and the database, so New task makes no task, or one
 * the list and its page never read back. The member presses New task, which
 * on Home puts the focus in its composer, and ⌘Return on the empty box,
 * which starts a bare task: no agent, so no model key is needed, named
 * Untitled until someone names it (`new-task-composer.tsx`). Its address
 * turning to the task's number says the service answered, and a fresh load
 * of the app then reads the task back from the database rather than from
 * the page's own copy of its start, and opens it from that list.
 *
 * Note that the fresh load is Home's rather than the task's own address,
 * because a task's page loaded straight from its address stays on "Reading
 * the task" in the suite today, a fault outside this journey.
 */
test("a member creates a task and sees it listed and opened", async ({ page, signedIn }) => {
  expect(signedIn.taskId).toBeUndefined();

  await page.goto("/app");
  await expect(page.getByText("No tasks yet.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New task" }).click();
  await expect(page.getByRole("textbox", { name: "Task prompt" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");

  const listed = page
    .getByRole("navigation", { name: "My tasks" })
    .getByRole("button", { name: /^Untitled\b/ });

  const heading = page.getByRole("main").getByRole("heading", { level: 1 });

  await expect(page).toHaveURL(/\/task\/[^/]+$/);
  await expect(listed).toBeVisible();
  await expect(heading).toHaveText("Untitled");
  // The address names the task by its number once the service answers the create, since only the service numbers a task.
  await expect(page).toHaveURL(/\/task\/\d+$/);

  await page.goto("/app");

  await expect(listed).toHaveCount(1);
  await listed.click();
  await expect(page).toHaveURL(/\/task\/\d+$/);
  await expect(heading).toHaveText("Untitled");
});
