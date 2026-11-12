import { baseDriveRefreshApp } from "@repo/service/maintenance/base-drive-refresh-app";
import { agentImage } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { runWeb } from "../../runtime.js";

/**
 * The daily workspace drive refresh's one entry, called by Vercel's cron on the
 * cadence `vercel.json` fixes. The logic lives in
 * `packages/service/src/agents/base-drive-refresh.ts`, behind the group in
 * `packages/service/src/maintenance/base-drive-refresh-app.ts`; this file only
 * hands the group the edge's runner and the agents' image.
 */
export default routeFromHttpRouter(baseDriveRefreshApp({ run: runWeb, image: agentImage }));
