// signed-in.e2e.ts -- a fresh member signed in through the local sign-in lands on the web app and sees their empty task list.

import { expect, test } from "../support/signed-in.js";

/**
 * The regression this catches: the web app failing to load or authenticate
 * a session end to end, whether the session cookie, Better Auth's reading of
 * it, or the first signed-in render breaks, or a fresh account, which holds
 * no task, failing to draw its empty task list.
 */
test("a fresh member signs in and sees their empty task list", async ({ page, signedIn }) => {
  // Note that the first signed-in page reads the service once per list, which takes several seconds on a cold server.
  test.setTimeout(60_000);
  expect(signedIn.taskId).toBeUndefined();

  await page.goto("/app");

  // The greeting names the member by their first name, which only a session read as theirs knows.
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome.*, Journey$/ })).toBeVisible();
  await expect(page.getByText("No tasks yet.")).toBeVisible();
});
