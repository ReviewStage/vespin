/**
 * base-drive-refresh.ts -- every base drive that stands refilled once a day, so each agent forked from one fetches little of the default branch.
 *
 * Vercel's cron calls the refresh once a day (the root `vercel.json`;
 * `maintenance/base-drive-refresh-app.ts`). It reads every workspace's
 * repository a base drive may stand for (`listBaseDriveRepositories`), asks
 * the sandbox provider whether that drive stands, and refills each one that
 * does as a launch would (`fillBaseDrive`): the default branch fetched over
 * its checkout, and an install only where that moved a lockfile. A
 * repository whose drive stands not is passed by, so the refresh never fills
 * a drive no launch asked for, and so is one the workspace's installation no
 * longer reaches. The drives are refilled one after another, each kept from
 * the rest: one that fails is logged by its kind and the next is refilled,
 * and tomorrow's run tries it again.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type BaseDriveRepository,
  listBaseDriveRepositories,
  listBaseDriveWorkspaces,
} from "@repo/database/models/base-drive-repositories";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { causeKind } from "@repo/runtime/effect";
import { Sandbox } from "@repo/sandbox";
import { Cause, Effect, Option } from "effect";
import { GitHubApp } from "../github/github-app.js";
import { BASE_WANTED, type BaseDriveOf, baseDriveName, fillBaseDrive } from "./base-drive.js";
import { filledWorkspace } from "./base-drive-connect.js";
import { AgentImage } from "./coder-host/agent-image.js";
import {
  firewallSessionOf,
  repositoryFirewallOver,
  repositorySandboxOver,
  type SandboxRunner,
} from "./machine/sandbox-machine.js";

/** What one day's refresh did, in counts alone: no workspace and no repository is named. */
interface BaseDriveRefresh {
  /** Base drives refilled, or found being filled by another. */
  readonly refilled: number;
  /** Repositories passed by: no base drive stands for them, or the workspace's installation no longer reaches them. */
  readonly passed: number;
  /** Base drives whose refill failed, each logged. */
  readonly failed: number;
}

const REFRESH_OUTCOME = { REFILLED: "refilled", PASSED: "passed" } as const;

/**
 * One workspace's repository's base drive refilled where it stands, on a
 * read token minted for it on the workspace's installation and the image
 * given, its sandbox's firewall written under the account named.
 */
const refreshedOne = (run: SandboxRunner, image: string, candidate: BaseDriveRepository) =>
  Effect.gen(function* () {
    const api = yield* Sandbox;
    // Note that the drive's name reads the repository's case aside, so the row's spelling finds it.
    const named = baseDriveName({
      workspaceId: candidate.workspaceId,
      fullName: candidate.repository,
    });
    if (!(yield* api.driveStands(named))) return REFRESH_OUTCOME.PASSED;
    const reached = yield* (yield* GitHubApp).repositoryReadToken(
      candidate.workspaceId,
      candidate.repository,
      undefined,
    );
    if (Option.isNone(reached) || reached.value.access.kind !== GITHUB_ACCESS.APP) {
      return REFRESH_OUTCOME.PASSED;
    }
    const { repository, token, access } = reached.value;
    const of: BaseDriveOf = {
      workspaceId: candidate.workspaceId,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
    };
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
          repositoryFirewallOver(api, context, firewallSessionOf(running, candidate.userId), {}),
        ),
      BASE_WANTED.SCHEDULED,
    );
    return REFRESH_OUTCOME.REFILLED;
  });

/** Every base drive that stands refilled, one after another, each failure logged and passed by; what the run did. */
export const refreshBaseDrives = Effect.fn("web/refreshBaseDrives")(function* (run: SandboxRunner) {
  const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
  const counts = { refilled: 0, passed: 0, failed: 0 };
  for (const candidate of yield* listBaseDriveRepositories()) {
    const outcome = yield* refreshedOne(run, image, candidate).pipe(
      // An interruption, the function's own deadline, still ends the run.
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.as(
              Effect.logError(`a base drive's refill failed: ${causeKind(cause)}`),
              undefined,
            ),
      ),
    );
    if (outcome === undefined) counts.failed += 1;
    else counts[outcome] += 1;
  }
  // Note that this backfills the drives of repositories connected before connects filled them
  // (`base-drive-connect.ts`); it is removed once one daily run has filled them.
  for (const workspace of yield* listBaseDriveWorkspaces()) {
    yield* filledWorkspace(run, workspace).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logError(`a workspace's base drive backfill failed: ${causeKind(cause)}`),
      ),
    );
  }
  const refreshed: BaseDriveRefresh = counts;
  yield* Effect.logInfo(
    `base drives refreshed: ${counts.refilled} refilled, ${counts.passed} passed by, ${counts.failed} failed`,
  );
  return refreshed;
});
