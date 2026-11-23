// static-page.e2e.ts -- the web app's static page for an agent's page frame loads as a browser draws it.

import { expect, test } from "@playwright/test";

test("the page frame's static page tells the reader to open the page in the Mac app", async ({
  page,
}) => {
  await page.goto("/page-in-mac-app.html");

  await expect(page).toHaveTitle("Open in the Mac app");
  await expect(page.getByRole("paragraph")).toContainText("Pages open in the Mac app for now.");
});
