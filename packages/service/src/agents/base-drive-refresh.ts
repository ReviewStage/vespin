/**
 * base-drive-refresh.ts -- every workspace's drive filled once a day as its repositories stand, so each agent forked from one fetches little of its default branch.
 *
 * Vercel's cron calls the refresh once a day (the root `vercel.json`;
 * `maintenance/base-drive-refresh-app.ts`). It reads every workspace that
 * connects a GitHub installation (`listBaseDriveWorkspaces`) and fills each
 * one's drive (`workspace-drive.ts`'s `fillWorkspaceDrive`), one after
 * another, each kept from the rest: one that fails is logged by its kind and
 * the next is filled, and tomorrow's run tries it again.
 */

import { listBaseDriveWorkspaces } from "@repo/database/models/base-drive-repositories";
import { causeKind } from "@repo/runtime/effect";
import { Cause, Effect } from "effect";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import { fillWorkspaceDrive } from "./workspace-drive.js";

/** What one day's refresh did, in counts alone: no workspace is named. */
interface BaseDriveRefresh {
  /** Workspace drives filled. */
  readonly filled: number;
  /** Workspace drives passed by, another fill holding them. */
  readonly passed: number;
  /** Workspace drives whose fill failed, each logged. */
  readonly failed: number;
}

/** Every workspace's drive filled, one after another, each failure logged and passed by; what the run did. */
export const refreshBaseDrives = Effect.fn("web/refreshBaseDrives")(function* (run: SandboxRunner) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
  const counts = { filled: 0, passed: 0, failed: 0 };
  for (const workspace of yield* listBaseDriveWorkspaces()) {
    const filled = yield* fillWorkspaceDrive(run, image, workspace).pipe(
      // An interruption, the function's own deadline, still ends the run.
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.as(
              Effect.logError(`a workspace drive's refresh failed: ${causeKind(cause)}`),
              undefined,
            ),
      ),
    );
    if (filled === undefined) counts.failed += 1;
    else if (filled) counts.filled += 1;
    else counts.passed += 1;
  }
  const refreshed: BaseDriveRefresh = counts;
  yield* Effect.logInfo(
    `workspace drives refreshed: ${counts.filled} filled, ${counts.passed} passed by, ${counts.failed} failed`,
  );
  return refreshed;
});
