// playwright.config.ts -- the journeys Playwright Test runs, and the server they load.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;

/**
 * Specs are `*.e2e.ts`, a name no vitest config collects, so `vitest run`
 * never picks a journey up. The server is the web app's `public/` folder as
 * Vite's preview serves a built site: plain files, no build, no service and
 * no database, which is all a static page needs. Locally a server already on
 * the port is reused; under CI one is always started.
 */
export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.e2e.ts",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite preview --outDir ../web/public --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/page-in-mac-app.html`,
    reuseExistingServer: !process.env.CI,
  },
});
