// signed-out.e2e.ts -- the web app, served by the local server over the suite's database, offers a visitor with no session a way to sign in.

import { expect, test } from "../support/test.js";

/**
 * How long the first load may take. Note that it is seconds rather than one,
 * because the local server's Vite compiles the app's modules as the page
 * first asks for them: 15s to 25s in an agent sandbox, near Playwright's
 * 30s default. Built pages (E2E 3b) take that away.
 */
const FIRST_LOAD_TIMEOUT = 90_000;

test("the app asks a visitor with no session to sign in", async ({ page }) => {
  test.setTimeout(FIRST_LOAD_TIMEOUT);
  await page.goto("/app");

  const signIn = page.getByRole("region", { name: /^Sign in to / });
  await expect(signIn.getByRole("heading", { level: 1, name: /^Sign in to / })).toBeVisible();
  await expect(signIn.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
});
