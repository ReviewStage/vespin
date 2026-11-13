/**
 * workspace-drive-cleanup.ts -- once a day, each workspace's drive emptied of the repositories none of its agents started in for a while.
 *
 * A fill only adds repositories (`workspace-drive.ts`), so a drive keeps one
 * its workspace stopped using. Vercel's scheduler calls the cleanup once a
 * day (the root `vercel.json`; `maintenance/workspace-drive-cleanup-app.ts`).
 * It reads every drive's repositories no agent of its workspace started in
 * within `WORKSPACE_DRIVE_CLEANUP.UNUSED_AFTER`
 * (`unusedWorkspaceDriveRepositories`) and prunes each such workspace's
 * drive to the rest (`pruneWorkspaceDriveTo`), which deletes the dropped
 * folders and their rows, `WORKSPACE_DRIVE_CLEANUP.CONCURRENCY` workspaces
 * at a time. A drive a fill holds now, and a prune that failed, are logged
 * and passed by for the next day's run, as is a workspace with no owner.
 */

import { workspaceDriveOwner } from "@repo/database/models/base-drive-repositories";
import {
  type UnusedWorkspaceDriveRepositories,
  unusedWorkspaceDriveRepositories,
  workspaceDriveRepositories,
} from "@repo/database/models/workspace-drive-repositories";
import { causeKind } from "@repo/runtime/effect";
import { Cause, DateTime, Duration, Effect, Option } from "effect";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import { pruneWorkspaceDriveTo } from "./workspace-drive.js";

const WORKSPACE_DRIVE_CLEANUP = {
  /** How long a repository stands on its workspace's drive with no agent of the workspace started in it. */
  UNUSED_AFTER: Duration.days(30),
  /** How many workspaces' drives one run prunes at once. */
  CONCURRENCY: 4,
} as const;

const CLEANUP_OUTCOME = { PRUNED: "pruned", PASSED: "passed", FAILED: "failed" } as const;

type CleanupOutcome = (typeof CLEANUP_OUTCOME)[keyof typeof CLEANUP_OUTCOME];

/** What one day's cleanup did, in counts alone: no workspace or repository is named. */
export interface WorkspaceDriveCleanup {
  /** Workspace drives pruned. */
  readonly pruned: number;
  /** Repositories dropped from the drives pruned. */
  readonly dropped: number;
  /** Workspace drives passed by: held by a fill, or of a workspace with no owner. */
  readonly passed: number;
  /** Workspace drives whose prune failed. */
  readonly failed: number;
}

/** One workspace's drive pruned to every repository it holds but the unused, as what the cleanup counts it. */
const cleanedOne = (run: SandboxRunner, image: string, unused: UnusedWorkspaceDriveRepositories) =>
  Effect.gen(function* () {
    const owner = yield* workspaceDriveOwner(unused.workspaceId);

    if (Option.isNone(owner)) return CLEANUP_OUTCOME.PASSED;
    const dropped = new Set(unused.repositories);
    const recorded = yield* workspaceDriveRepositories(unused.workspaceId);
    const keep = recorded.filter((repository) => !dropped.has(repository));
    const pruned = yield* pruneWorkspaceDriveTo(run, image, owner.value, keep);

    return pruned ? CLEANUP_OUTCOME.PRUNED : CLEANUP_OUTCOME.PASSED;
  }).pipe(
    // An interruption, the function's own deadline, still ends the run.
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.as(
            Effect.logWarning(`a workspace drive's cleanup failed: ${causeKind(cause)}`),
            CLEANUP_OUTCOME.FAILED,
          ),
    ),
  );

/** Every workspace's drive emptied of its unused repositories, a few workspaces at once, each failure logged and passed by; what the run did. */
export const cleanWorkspaceDrives = Effect.fn("web/cleanWorkspaceDrives")(function* (
  run: SandboxRunner,
) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
  const now = yield* DateTime.nowAsDate;
  const since = new Date(now.getTime() - Duration.toMillis(WORKSPACE_DRIVE_CLEANUP.UNUSED_AFTER));
  const unused = yield* unusedWorkspaceDriveRepositories(since);

  const outcomes: readonly CleanupOutcome[] = yield* Effect.forEach(
    unused,
    (each) => cleanedOne(run, image, each),
    { concurrency: WORKSPACE_DRIVE_CLEANUP.CONCURRENCY },
  );

  const cleaned: WorkspaceDriveCleanup = {
    pruned: outcomes.filter((each) => each === CLEANUP_OUTCOME.PRUNED).length,
    dropped: unused.reduce(
      (sum, each, at) =>
        outcomes[at] === CLEANUP_OUTCOME.PRUNED ? sum + each.repositories.length : sum,
      0,
    ),
    passed: outcomes.filter((each) => each === CLEANUP_OUTCOME.PASSED).length,
    failed: outcomes.filter((each) => each === CLEANUP_OUTCOME.FAILED).length,
  };

  yield* Effect.logInfo(
    `workspace drives cleaned: ${cleaned.pruned} pruned, ${cleaned.dropped} repositories dropped, ${cleaned.passed} passed by, ${cleaned.failed} failed`,
  );

  return cleaned;
});
