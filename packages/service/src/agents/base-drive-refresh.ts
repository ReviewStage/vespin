/**
 * base-drive-refresh.ts -- every workspace's drive that is missing or unfinished filled once a day, several at once, so a workspace whose drive was never made, or whose fill failed, gets one.
 *
 * Vercel's scheduler calls the refresh once a day (the root `vercel.json`;
 * `maintenance/base-drive-refresh-app.ts`). It reads every workspace that
 * connects a GitHub installation (`listBaseDriveWorkspaces`) and fills the
 * drive of each one whose drive stands not, or stands under a fill's sandbox
 * left past its grace (`readOf`'s `WANTED`); a whole drive is passed by, and
 * so is one a fill holds now, since its own fill keeps it as a connect or a
 * disconnect regenerates it (`workspace-drive.ts`). Note that the fills run
 * `REFRESH_CONCURRENCY` at a time rather than one after another, because one
 * call fills them all under the function's one bound, and a workspace's
 * first fill clones every repository it connects, which can take minutes.
 * Each workspace is kept from the rest: one that fails is reported where it
 * failed (`reportedBroken`) and counted, and the rest are filled.
 */

import { listBaseDriveWorkspaces } from "@repo/database/models/base-drive-repositories";
import { causeKind } from "@repo/runtime/effect";
import { Sandbox } from "@repo/sandbox";
import { Cause, Clock, Effect } from "effect";
import { AgentImage } from "./coder-host/agent-image.js";
import type { SandboxRunner } from "./machine/sandbox-machine.js";
import {
  DRIVE_BROKEN,
  DRIVE_STATE,
  fillWorkspaceDrive,
  readOf,
  reportedBroken,
  workspaceDriveName,
} from "./workspace-drive.js";

/** How many workspaces' drives one refresh fills at once. */
const REFRESH_CONCURRENCY = 8;

/** What one day's refresh did, in counts alone: no workspace is named. */
interface BaseDriveRefresh {
  /** Workspace drives filled. */
  readonly filled: number;
  /** Workspace drives passed by: whole, or held by another fill. */
  readonly passed: number;
  /** Workspace drives whose fill failed, each reported. */
  readonly failed: number;
}

const REFRESH_OUTCOME = { FILLED: "filled", PASSED: "passed", FAILED: "failed" } as const;

type RefreshOutcome = (typeof REFRESH_OUTCOME)[keyof typeof REFRESH_OUTCOME];

/** Whether the workspace's drive wants a fill: it stands not, or a fill left its sandbox past its grace. */
const driveWanted = (workspaceId: string) =>
  Effect.gen(function* () {
    const api = yield* Sandbox;
    const name = workspaceDriveName(workspaceId);

    if (!(yield* api.driveStands(name))) return true;

    return (
      readOf(yield* api.get(name), yield* Clock.currentTimeMillis).state === DRIVE_STATE.WANTED
    );
  });

/** One workspace's drive filled where it wants one, as what the refresh counts it. */
const refreshedOne = (
  run: SandboxRunner,
  image: string,
  workspace: { readonly workspaceId: string; readonly userId: string },
) =>
  Effect.gen(function* () {
    if (!(yield* driveWanted(workspace.workspaceId))) return REFRESH_OUTCOME.PASSED;
    const filled = yield* fillWorkspaceDrive(run, image, workspace);

    return filled ? REFRESH_OUTCOME.FILLED : REFRESH_OUTCOME.PASSED;
  }).pipe(
    // An interruption, the function's own deadline, still ends the run.
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.as(
            reportedBroken(workspace.workspaceId, DRIVE_BROKEN.FILL_FAILED, causeKind(cause)),
            REFRESH_OUTCOME.FAILED,
          ),
    ),
  );

/** Every workspace's drive that wants one filled, `REFRESH_CONCURRENCY` at once, each failure reported and passed by; what the run did. */
export const refreshBaseDrives = Effect.fn("web/refreshBaseDrives")(function* (run: SandboxRunner) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);

  const outcomes: readonly RefreshOutcome[] = yield* Effect.forEach(
    yield* listBaseDriveWorkspaces(),
    (workspace) => refreshedOne(run, image, workspace),
    { concurrency: REFRESH_CONCURRENCY },
  );

  const refreshed: BaseDriveRefresh = {
    filled: outcomes.filter((each) => each === REFRESH_OUTCOME.FILLED).length,
    passed: outcomes.filter((each) => each === REFRESH_OUTCOME.PASSED).length,
    failed: outcomes.filter((each) => each === REFRESH_OUTCOME.FAILED).length,
  };

  yield* Effect.logInfo(
    `workspace drives refreshed: ${refreshed.filled} filled, ${refreshed.passed} passed by, ${refreshed.failed} failed`,
  );

  return refreshed;
});
