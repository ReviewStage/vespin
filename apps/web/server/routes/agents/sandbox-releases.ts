import { sandboxReleasesHandler } from "@repo/service/agents/session-sandboxes";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The sandbox-releases queue's consumer, a function of its own that the
 * queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/agents/session-sandboxes.ts`; this
 * file only hands it the runtime's services.
 */
export default routeFromWebServices(sandboxReleasesHandler);
