import { sandboxUsageChecksHandler } from "@repo/service/billing/usage-queues";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The sandbox-usage-checks queue's consumer, a function of its own that the
 * queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/billing/usage-queues.ts`; this file
 * only hands it the runtime's services.
 */
export default routeFromWebServices(sandboxUsageChecksHandler);
