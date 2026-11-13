/**
 * workspace-drive-cleanup.ts -- once a day, a cleanup published for each workspace whose drive holds a repository none of its agents started in for a while.
 *
 * A fill only adds repositories (`workspace-drive.ts`), so a drive keeps one
 * its workspace stopped using. Vercel's scheduler calls the cleanup once a
 * day (the root `vercel.json`; `maintenance/workspace-drive-cleanup-app.ts`).
 * It reads the workspaces whose drives hold a repository no agent of the
 * workspace started in within `UNUSED_AFTER`
 * (`unusedWorkspaceDriveRepositories`) and publishes one cleanup for each on
 * the workspace drive queue (`workspace-drive-builds.ts`), whose consumer
 * prunes that drive and comes again where a fill holds it. A publish that
 * fails is said in the log, and the next day's run publishes again.
 */

import { unusedWorkspaceDriveRepositories } from "@repo/database/models/workspace-drive-repositories";
import { Effect } from "effect";
import { unusedSince, workspaceDriveCleanupPublished } from "./workspace-drive-builds.js";

/** A cleanup published for every workspace whose drive holds an unused repository; how many were published. */
export const publishWorkspaceDriveCleanups = Effect.fn("web/publishWorkspaceDriveCleanups")(
  function* () {
    const unused = yield* unusedWorkspaceDriveRepositories(yield* unusedSince);

    yield* Effect.forEach(unused, (each) => workspaceDriveCleanupPublished(each.workspaceId), {
      discard: true,
    });

    yield* Effect.logInfo(`workspace drive cleanups published: ${unused.length}`);

    return { published: unused.length };
  },
);
