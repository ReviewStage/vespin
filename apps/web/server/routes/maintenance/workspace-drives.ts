import { workspaceDriveCleanupApp } from "@repo/service/maintenance/workspace-drive-cleanup-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The daily workspace drive cleanup's one entry, called by Vercel's cron on
 * the cadence `vercel.json` fixes. It only publishes: the logic lives in
 * `packages/service/src/agents/workspace-drive-cleanup.ts`, behind the group in
 * `packages/service/src/maintenance/workspace-drive-cleanup-app.ts`, and each
 * drive is pruned by the workspace drive queue's consumer
 * (`packages/service/src/agents/workspace-drive-builds.ts`).
 */
export default routeFromHttpRouter(workspaceDriveCleanupApp());
