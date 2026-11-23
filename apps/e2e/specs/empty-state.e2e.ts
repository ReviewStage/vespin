// empty-state.e2e.ts -- a fresh member past setup, with no task, signs in and lands on the app's empty state.

import { expect, test } from "../support/signed-in.js";

test.use({ memberAsk: { setupFinished: true } });

/**
 * The regression this catches: a signed-in member with no task never
 * reaching the app, because the web app fails to load, to authenticate end
 * to end, to read the account's finished setup, or to settle on an empty
 * task list. The member finished setup, so the window lets them in without
 * reading the models (`setupGate`). Note that this is why it does not catch
 * the zero-task render loop (STAG-3880, #10517): that loop ran through
 * setup's wait on the models' read, which a finished member never takes; a
 * journey of a member still owed setup holds it once the suite's server
 * answers the models' read.
 */
test("a fresh member with no task sees the empty state", async ({ page, signedIn }) => {
  expect(signedIn.taskId).toBeUndefined();

  await page.goto("/app");

  await expect(page.getByText("No tasks yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Welcome.*, Journey$/);
});
