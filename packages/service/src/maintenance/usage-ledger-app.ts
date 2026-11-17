/**
 * usage-ledger-app.ts -- the daily read of Vercel's sandbox sessions into the usage ledger, as Vercel's cron calls it under the deployment's `CRON_SECRET`.
 *
 * The read (`billing/sandbox-session-charges.ts`) charges every ended
 * session of a sandbox we opened for a workspace to it. It is called as
 * every daily job is (`scheduled-call-app.ts`), and answers how many
 * sessions it read, charged, and passed by.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Sandbox } from "@repo/sandbox";
import { chargeEndedSandboxSessions } from "../billing/sandbox-session-charges.js";
import type { HostedEnvironment } from "../environment.js";
import type { WebRoutes } from "../route.js";
import { USAGE_LEDGER_PATH } from "./maintenance-bounds.js";
import { scheduledCallApp } from "./scheduled-call-app.js";

/** The ledger's daily read: its one path, and the hosted vocabulary's own refusal for any other. */
export function usageLedgerApp(): WebRoutes<DatabaseServices | Sandbox | HostedEnvironment> {
  return scheduledCallApp(USAGE_LEDGER_PATH, chargeEndedSandboxSessions());
}
