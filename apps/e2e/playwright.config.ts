// playwright.config.ts -- the journeys Playwright Test runs, and the servers they load.

import { defineConfig, devices } from "@playwright/test";
import { DATABASE_URL_FILE, RUN_SECRETS } from "./support/run-secrets.js";

const PORT = 4317;

const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * The packaged desktop app's executable the `desktop` project launches, an
 * end-to-end build (`APP_E2E_BUILD=1 pnpm package:dir`), set only on a Mac
 * that built one (`.github/workflows/e2e-desktop.yml`). Without it the project
 * is not declared at all, so the suite on Linux runs no desktop journey.
 */
const DESKTOP_EXECUTABLE = process.env.APP_E2E_DESKTOP_EXECUTABLE;

/** The journeys under `specs/desktop/`, which drive the packaged app rather than a browser alone. */
const DESKTOP_SPECS = "desktop/**";

/**
 * The local server's environment: the run's secrets (`run-secrets.ts`), made
 * new each run so none is committed or outlives it, and shared with the
 * workers' fixtures, which seal a member's key under the same ring. Beside
 * them, the switch that serves the site from a fresh `vite build`.
 */
const LOCAL_SERVER_ENV = {
  LOCAL_SERVER_BUILT_PAGES: "true",
  ...RUN_SECRETS,
  BETTER_AUTH_URL: ORIGIN,
  APP_DEPLOYMENT_ORIGIN: ORIGIN,
};

/**
 * Specs are `*.e2e.ts`, a name no vitest config collects, so `vitest run`
 * never picks a journey up. A failed test is never retried, so a flaky one
 * fails the run rather than passing on a second try, and is fixed or
 * deleted. On CI the run reports to the job's log and annotations (`github`)
 * and writes the HTML report, which carries each failed test's trace and
 * video for the job to upload.
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
 * The second server is the web app's local server (`apps/web/server/README.md`,
 * "The local server"): the hosted routes and the site's pages on one
 * loopback port, over the suite's database, started through
 * `server/e2e-server.ts` so its sandboxes, agents' sessions, and model
 * catalog are the suite's fakes. It runs with `LOCAL_SERVER_BUILT_PAGES`,
 * so the pages a journey loads are `vite build`'s, built as it starts, as a
 * deployment serves them, while the routes are imported from source. Note
 * that its command reads the URL file in the shell, because the URL is only
 * known once the database is up, which is after this config is read. It sets no `VERCEL*` variable,
 * since the local server refuses to start beside one. It counts as up once
 * it answers the signed-out app page, which waits on that build (about a
 * minute in an agent sandbox, hence its timeout), and is never reused,
 * since a server already on the port would stand over another run's
 * database.
 */
export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.e2e.ts",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: DESKTOP_SPECS, use: { ...devices["Desktop Chrome"] } },
    ...(DESKTOP_EXECUTABLE === undefined
      ? []
      : [
          {
            name: "desktop",
            testMatch: `${DESKTOP_SPECS}/*.e2e.ts`,
            // Note that the app holds a single-instance lock and one Keychain entry, so its journeys run one at a time.
            fullyParallel: false,
            use: { ...devices["Desktop Chrome"] },
          },
        ]),
  ],
  webServer: [
    {
      name: "postgres",
      command: `mkdir -p .build && node ../../tools/demo-postgres/demo-postgres.ts --url-file ${DATABASE_URL_FILE}`,
      wait: { stdout: /^Postgres 18 on port \d+/m },
      gracefulShutdown: { signal: "SIGTERM", timeout: 60_000 },
      timeout: 180_000,
    },
    {
      name: "local-server",
      command: `DATABASE_URL="$(cat ${DATABASE_URL_FILE})" DATABASE_URL_UNPOOLED="$(cat ${DATABASE_URL_FILE})" pnpm e2e-server --port ${PORT}`,
      env: LOCAL_SERVER_ENV,
      url: `${ORIGIN}/app`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      timeout: 300_000,
    },
  ],
});
