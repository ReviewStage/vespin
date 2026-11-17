/**
 * usage-ledger-app.ts -- the daily read of Vercel's sandbox sessions into the usage ledger, and the ledger's unsent charges sent on to Metronome, as Vercel's cron calls it under the deployment's `CRON_SECRET`.
 *
 * The read (`billing/sandbox-session-charges.ts`) charges every ended
 * session of a sandbox we opened for a workspace to it; the send
 * (`billing/usage-sending.ts`) then sends every charge not yet sent, the
 * read's own among them, to its workspace's Metronome contract. Vercel calls
 * it just after midnight UTC, so a month's last day is sent within the
 * 24 hours Metronome waits before it finalizes the month's invoice. It is
 * called as every daily job is (`scheduled-call-app.ts`), and answers how
 * many sessions it read, charged, and passed by, and how many charges it
 * sent.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Sandbox } from "@repo/sandbox";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { BillingEnvironment } from "../billing/billing-environment.js";
import { chargeEndedSandboxSessions } from "../billing/sandbox-session-charges.js";
import { sendUnsentUsage } from "../billing/usage-sending.js";
import type { HostedEnvironment } from "../environment.js";
import type { WebRoutes } from "../route.js";
import { USAGE_LEDGER_PATH } from "./maintenance-bounds.js";
import { scheduledCallApp } from "./scheduled-call-app.js";

/** The ledger's daily read and send: its one path, and the hosted vocabulary's own refusal for any other. */
export function usageLedgerApp(): WebRoutes<
  DatabaseServices | Sandbox | HostedEnvironment | BillingEnvironment | HttpClient.HttpClient
> {
  return scheduledCallApp(
    USAGE_LEDGER_PATH,
    Effect.gen(function* () {
      const charged = yield* chargeEndedSandboxSessions();
      const sent = yield* sendUnsentUsage();

      return { ...charged, sent };
    }),
  );
}
