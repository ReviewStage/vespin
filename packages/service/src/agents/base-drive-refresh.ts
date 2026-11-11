/**
 * base-drive-refresh.ts -- a base drive filled for every repository a workspace connected, before any agent asks for it, and every one that stands refilled once a day.
 *
 * Vercel's cron calls the refresh every hour (the root `vercel.json`;
 * `maintenance/base-drive-refresh-app.ts`). It reads every workspace with an
 * active GitHub installation (`listBaseDriveWorkspaces`) and every
 * repository its installations grant (`workspaceRepositories`), and asks the
 * sandbox provider whether each one's base drive stands. One that stands not
 * is filled as a launch whose fork found none would fill it
 * (`fillBaseDrive`), so a repository connected since the last run has its
 * drive within the hour and its first agent forks it rather than cloning.
 * One that stands is refilled on the run at `REFILL_HOUR_UTC` alone: the
 * default branch fetched over its checkout, and an install only where that
 * moved a lockfile, so each agent's own fetch stays small. Note that a fill
 * whose sandbox was created and that then failed leaves its drive standing
 * (`filledDrive`), so it is tried again once a day rather than every hour. A repository its installation no
 * longer reaches is passed by. The drives are filled a few at once, each
 * kept from the rest: one that fails is logged by its kind and the rest go
 * on, and the next run tries it again.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type BaseDriveWorkspace,
  listBaseDriveWorkspaces,
} from "@repo/database/models/base-drive-repositories";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { causeKind } from "@repo/runtime/effect";
import { Sandbox } from "@repo/sandbox";
import { Cause, Effect, Option } from "effect";
import { GitHubApp } from "../github/github-app.js";
import { BASE_DRIVE_REFRESH } from "../maintenance/maintenance-bounds.js";
import {
  BASE_WANTED,
  type BaseDriveOf,
  type BaseRefill,
  baseDriveName,
  fillBaseDrive,
} from "./base-drive.js";
import { AgentImage } from "./coder-host/agent-image.js";
import {
  firewallSessionOf,
  repositoryFirewallOver,
  repositorySandboxOver,
  type SandboxRunner,
} from "./machine/sandbox-machine.js";

/** How many drives are filled at once: each fill waits on its sandbox, so a few at once keep the run inside its bound. */
const FILL_CONCURRENCY = 4;

const MILLIS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** What one run did, in counts alone: no workspace and no repository is named. */
interface BaseDriveRefresh {
  /** Base drives filled where none stood. */
  readonly filled: number;
  /** Base drives that stood, refilled on the day's refill run. */
  readonly refilled: number;
  /** Repositories passed by: a drive stands and this is not the refill run, or the installation no longer reaches it. */
  readonly passed: number;
  /** Workspaces whose listing failed, and drives whose fill failed, each logged. */
  readonly failed: number;
}

const REFRESH_OUTCOME = { FILLED: "filled", REFILLED: "refilled", PASSED: "passed" } as const;
type RefreshOutcome = (typeof REFRESH_OUTCOME)[keyof typeof REFRESH_OUTCOME];

/** A failure logged by its kind and counted as none; an interruption, the function's own deadline, still ends the run. */
const loggedFailure = (what: string) => (cause: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.failCause(cause)
    : Effect.as(Effect.logError(`${what} failed: ${causeKind(cause)}`), undefined);

/**
 * One workspace's repository's base drive filled where none stands, or
 * refilled where one does and `refillStanding` asks it, on a read token
 * minted for it on the workspace's installation and the image given, its
 * sandbox's firewall written under the workspace's owner.
 */
const refreshedOne = (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
  fullName: string,
  refillStanding: boolean,
) =>
  Effect.gen(function* () {
    const api = yield* Sandbox;
    const stands = yield* api.driveStands(
      baseDriveName({ workspaceId: workspace.workspaceId, fullName }),
    );
    if (stands && !refillStanding) return REFRESH_OUTCOME.PASSED;
    const reached = yield* (yield* GitHubApp).repositoryReadToken(
      workspace.workspaceId,
      fullName,
      undefined,
    );
    if (Option.isNone(reached) || reached.value.access.kind !== GITHUB_ACCESS.APP) {
      return REFRESH_OUTCOME.PASSED;
    }
    const { repository, token, access } = reached.value;
    const of: BaseDriveOf = {
      workspaceId: workspace.workspaceId,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
    };
    const refill: BaseRefill = stands ? BASE_WANTED.SCHEDULED : BASE_WANTED.MISSING;
    const context = yield* Effect.context<DatabaseServices>();
    yield* fillBaseDrive(
      of,
      image,
      { token, access },
      (running) =>
        repositorySandboxOver(
          api,
          running,
          run,
          repositoryFirewallOver(api, context, firewallSessionOf(running, workspace.userId), {}),
        ),
      refill,
    );
    return stands ? REFRESH_OUTCOME.REFILLED : REFRESH_OUTCOME.FILLED;
  });

/** Whether a run at the instant given is the day's one that refills every base drive that stands. */
export function refillsStanding(nowMillis: number): boolean {
  return (
    Math.floor(nowMillis / MILLIS_PER_HOUR) % HOURS_PER_DAY === BASE_DRIVE_REFRESH.REFILL_HOUR_UTC
  );
}

/** Every connected repository's base drive filled where none stands, and refilled where one does and `refillStanding` asks it; what the run did. */
export const refreshBaseDrives = Effect.fn("web/refreshBaseDrives")(function* (
  run: SandboxRunner,
  refillStanding: boolean,
) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
  const github = yield* GitHubApp;
  const counts = { filled: 0, refilled: 0, passed: 0, failed: 0 };
  const jobs: { readonly workspace: BaseDriveWorkspace; readonly fullName: string }[] = [];
  for (const workspace of yield* listBaseDriveWorkspaces()) {
    const listed = yield* github
      .workspaceRepositories(workspace.workspaceId)
      .pipe(Effect.catchCause(loggedFailure("a workspace's repository listing")));
    if (listed === undefined) counts.failed += 1;
    else
      for (const each of Option.getOrElse(listed, () => [])) {
        jobs.push({ workspace, fullName: each.fullName });
      }
  }
  const outcomes: readonly (RefreshOutcome | undefined)[] = yield* Effect.forEach(
    jobs,
    (job) =>
      refreshedOne(run, image, job.workspace, job.fullName, refillStanding).pipe(
        Effect.catchCause(loggedFailure("a base drive's fill")),
      ),
    { concurrency: FILL_CONCURRENCY },
  );
  for (const outcome of outcomes) {
    if (outcome === undefined) counts.failed += 1;
    else counts[outcome] += 1;
  }
  const refreshed: BaseDriveRefresh = counts;
  yield* Effect.logInfo(
    `base drives refreshed: ${counts.filled} filled, ${counts.refilled} refilled, ${counts.passed} passed by, ${counts.failed} failed`,
  );
  return refreshed;
});
