// playwright.config.ts -- the journeys Playwright Test runs, and the servers they load.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;

/**
 * Where the suite's Postgres writes its connection string, relative to this
 * folder, for a server started after it to read (`DATABASE_URL` and
 * `DATABASE_URL_UNPOOLED` alike). The folder is gitignored scratch, and the
 * file exists only while the database runs.
 */
const DATABASE_URL_FILE = ".build/database-url";

/**
 * Specs are `*.e2e.ts`, a name no vitest config collects, so `vitest run`
 * never picks a journey up.
 *
 * The suite's database is the first server: `tools/demo-postgres`, a new
 * empty Postgres for the run, migrated and seeded, then stopped and deleted
 * with the run. It is a server rather than a global setup because Playwright
 * starts every server before it runs a global setup, and a server that reads
 * the database must start after it. It counts as up on the line
 * demo-postgres prints once migrations and the seed have passed and the URL
 * file is written, and it is stopped by SIGTERM, on which it stops Postgres
 * and deletes its folder; Playwright's default kill would leave both behind.
 *
 * The second server is the web app's `public/` folder as Vite's preview
 * serves a built site: plain files, no build and no service. Locally a
 * server already on its port is reused; under CI one is always started.
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
  webServer: [
    {
      name: "postgres",
      command: `mkdir -p .build && node ../../tools/demo-postgres/demo-postgres.ts --url-file ${DATABASE_URL_FILE}`,
      wait: { stdout: /^Postgres 18 on port \d+/m },
      gracefulShutdown: { signal: "SIGTERM", timeout: 60_000 },
      timeout: 180_000,
    },
    {
      command: `vite preview --outDir ../web/public --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}/page-in-mac-app.html`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
