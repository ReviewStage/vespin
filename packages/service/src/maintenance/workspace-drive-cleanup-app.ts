/**
 * workspace-drive-cleanup-app.ts -- the daily workspace drive cleanup as Vercel's cron calls it, under the deployment's `CRON_SECRET`.
 *
 * The cleanup (`agents/workspace-drive-cleanup.ts`) only publishes, one
 * message a workspace on the workspace drive queue, whose consumer prunes
 * each drive. It is called as every daily job is (`scheduled-call-app.ts`),
 * and answers how many cleanups it published.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { WorkspaceDriveBuildServices } from "../agents/workspace-drive-builds.js";
import { publishWorkspaceDriveCleanups } from "../agents/workspace-drive-cleanup.js";
import type { HostedEnvironment } from "../environment.js";
import type { WebRoutes } from "../route.js";
import { WORKSPACE_DRIVE_CLEANUP_PATH } from "./maintenance-bounds.js";
import { scheduledCallApp } from "./scheduled-call-app.js";

/** The cleanup's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function workspaceDriveCleanupApp(): WebRoutes<
  DatabaseServices | WorkspaceDriveBuildServices | HostedEnvironment
> {
  return scheduledCallApp(WORKSPACE_DRIVE_CLEANUP_PATH, publishWorkspaceDriveCleanups());
}
