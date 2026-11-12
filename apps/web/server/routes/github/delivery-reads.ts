import { githubDeliveryReadsHandler } from "@repo/service/github/github-webhook-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The github-delivery-reads queue's consumer, a function of its own that the
 * queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/github/github-webhook-app.ts`; this
 * file only hands it the runtime's services, the native harnesses beside
 * them, which a wake it tells may launch a runner on.
 */
export default routeFromWebServices(githubDeliveryReadsHandler, nativeAgents);
