import { workspaceDriveBuildsHandler } from "@repo/service/agents/workspace-drive-builds";
import { nativeAgents } from "../../native-agents.js";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The workspace-drive-builds queue's consumer, a function of its own that
 * the queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/agents/workspace-drive-builds.ts`;
 * this file only hands it the runtime's services, the native harnesses and
 * the drive's fills beside them, which fill the drive and boot the agents
 * that waited on it.
 */
export default routeFromWebServices(workspaceDriveBuildsHandler, nativeAgents);
