import { workspaceDriveCleanupApp } from "@repo/service/maintenance/workspace-drive-cleanup-app";
import { agentImage } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { runWeb } from "../../runtime.js";

/**
 * The daily workspace drive cleanup's one entry, called by Vercel's cron on
 * the cadence `vercel.json` fixes. The logic lives in
 * `packages/service/src/agents/workspace-drive-cleanup.ts`, behind the group in
 * `packages/service/src/maintenance/workspace-drive-cleanup-app.ts`; this file
 * only hands the group the edge's runner and the agents' image.
 */
export default routeFromHttpRouter(workspaceDriveCleanupApp({ run: runWeb, image: agentImage }));
