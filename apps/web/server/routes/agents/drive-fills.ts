import { workspaceDriveFillsHandler } from "@repo/service/agents/workspace-drive";
import { nativeAgents } from "../../native-agents.js";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The workspace-drive-fills queue's consumer, a function of its own that the
 * queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/agents/workspace-drive.ts`; this file
 * only hands it the runtime's services, and beside them the fills, which
 * open the fill's sandbox on the agents' image.
 */
export default routeFromWebServices(workspaceDriveFillsHandler, nativeAgents);
