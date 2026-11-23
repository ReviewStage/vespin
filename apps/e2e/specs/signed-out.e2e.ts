// signed-out.e2e.ts -- the web app, served by the local server over the suite's database, offers a visitor with no session a way to sign in.

import { expect, test } from "@playwright/test";

test("the app asks a visitor with no session to sign in", async ({ page }) => {
  await page.goto("/app");

  const signIn = page.getByRole("region", { name: /^Sign in to / });
  await expect(signIn.getByRole("heading", { level: 1, name: /^Sign in to / })).toBeVisible();
  await expect(signIn.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
});
