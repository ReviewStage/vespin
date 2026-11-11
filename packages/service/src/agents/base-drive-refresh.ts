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
 * moved a lockfile, so each agent's own fetch stays small. One a fill left
 * unfinished, failed or cut off by its function's deadline, is filled again
 * on any run. The same fill of a workspace's missing drives runs past the
 * answer as its installation is connected or given repositories
 * (`filledInBackground`), so the hourly run is the backstop. A repository its installation no
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
import { Cause, Effect, type Layer, Option } from "effect";
import { GitHubApp } from "../github/github-app.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import { afterResponse } from "../http/after-response.js";
import { BASE_DRIVE_REFRESH } from "../maintenance/maintenance-bounds.js";
import {
  BASE_STATE,
  BASE_WANTED,
  type BaseDriveOf,
  type BaseRefill,
  baseDriveName,
  fillBaseDrive,
  readBaseDrive,
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
    const named = { workspaceId: workspace.workspaceId, fullName };
    const stands = yield* api.driveStands(baseDriveName(named));
    // Note that a drive a fill left unfinished, as one a request's deadline cut off, is filled again on any run.
    const unfinished = stands && (yield* readBaseDrive(named)).state === BASE_STATE.WANTED;
    if (stands && !unfinished && !refillStanding) return REFRESH_OUTCOME.PASSED;
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
    // An unfinished drive names no reason of its own: the fill reads it as unfinished.
    const refill: BaseRefill | undefined = !stands
      ? BASE_WANTED.MISSING
      : unfinished
        ? undefined
        : BASE_WANTED.SCHEDULED;
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
    return stands && !unfinished ? REFRESH_OUTCOME.REFILLED : REFRESH_OUTCOME.FILLED;
  });

/** Whether a run at the instant given is the day's one that refills every base drive that stands. */
export function refillsStanding(nowMillis: number): boolean {
  return (
    Math.floor(nowMillis / MILLIS_PER_HOUR) % HOURS_PER_DAY === BASE_DRIVE_REFRESH.REFILL_HOUR_UTC
  );
}

/** A workspace's repositories as its installations grant them, each filled where its drive stands not and refilled where it stands and `refillStanding` asks it, a few at once; each outcome, a failure logged and counted as none. */
const refreshedWorkspace = (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
  refillStanding: boolean,
) =>
  Effect.gen(function* () {
    const listed = yield* (yield* GitHubApp)
      .workspaceRepositories(workspace.workspaceId)
      .pipe(Effect.catchCause(loggedFailure("a workspace's repository listing")));
    if (listed === undefined) return [undefined];
    return yield* Effect.forEach(
      Option.getOrElse(listed, () => []),
      (repository) =>
        refreshedOne(run, image, workspace, repository.fullName, refillStanding).pipe(
          Effect.catchCause(loggedFailure("a base drive's fill")),
        ),
      { concurrency: FILL_CONCURRENCY },
    );
  });

/** What a run's outcomes come to, in counts alone. */
function countsOf(outcomes: readonly (RefreshOutcome | undefined)[]): BaseDriveRefresh {
  const counts = { filled: 0, refilled: 0, passed: 0, failed: 0 };
  for (const outcome of outcomes) {
    if (outcome === undefined) counts.failed += 1;
    else counts[outcome] += 1;
  }
  return counts;
}

/**
 * A base drive filled for each of the workspace's repositories that has
 * none, as a workspace's installation is connected or given repositories;
 * what it did, each fill's failure logged.
 */
const fillWorkspaceDrives = Effect.fn("web/fillWorkspaceDrives")(function* (
  run: SandboxRunner,
  workspace: BaseDriveWorkspace,
) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
  const filled = countsOf(yield* refreshedWorkspace(run, image, workspace, false));
  yield* Effect.logInfo(
    `a connected workspace's base drives: ${filled.filled} filled, ${filled.passed} passed by, ${filled.failed} failed`,
  );
  return filled;
});

/** What a route that fills a connected workspace's drives is handed: the edge's runner a fill's checkout runs through, and the agents' image the function ships. */
export interface BaseDriveFills {
  readonly run: SandboxRunner;
  readonly image: Layer.Layer<AgentImage>;
}

/**
 * The workspace's base drives filled past the request's answer
 * (`fillWorkspaceDrives`), as its installation is connected or given
 * repositories, so its first agents fork them rather than cloning; what it
 * asks GitHub waits in the background lane, since no member waits on it.
 */
export const filledInBackground = (fills: BaseDriveFills, workspace: BaseDriveWorkspace) =>
  Effect.gen(function* () {
    // Note that a route reached with no sandboxes, as in a test of its other work, fills nothing.
    const sandbox = yield* Effect.serviceOption(Sandbox);
    if (Option.isNone(sandbox)) return;
    yield* afterResponse(
      "A connected workspace's base drives",
      fillWorkspaceDrives(fills.run, workspace).pipe(
        Effect.provide(fills.image),
        Effect.provideService(GitHubBackground, true),
        Effect.provideService(Sandbox, sandbox.value),
      ),
    );
  });

/** Every connected repository's base drive filled where none stands, and refilled where one does and `refillStanding` asks it; what the run did. */
export const refreshBaseDrives = Effect.fn("web/refreshBaseDrives")(function* (
  run: SandboxRunner,
  refillStanding: boolean,
) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
  const outcomes: (RefreshOutcome | undefined)[] = [];
  for (const workspace of yield* listBaseDriveWorkspaces()) {
    outcomes.push(...(yield* refreshedWorkspace(run, image, workspace, refillStanding)));
  }
  const refreshed = countsOf(outcomes);
  yield* Effect.logInfo(
    `base drives refreshed: ${refreshed.filled} filled, ${refreshed.refilled} refilled, ${refreshed.passed} passed by, ${refreshed.failed} failed`,
  );
  return refreshed;
});
