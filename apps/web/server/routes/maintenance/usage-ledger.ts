import { usageLedgerApp } from "@repo/service/maintenance/usage-ledger-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The daily usage ledger read's one entry, called by Vercel's cron on the
 * cadence `vercel.json` fixes. It only publishes: the logic lives in
 * `packages/service/src/billing/sandbox-session-charges.ts`, behind the group
 * in `packages/service/src/maintenance/usage-ledger-app.ts`.
 */
export default routeFromHttpRouter(usageLedgerApp());
