/**
 * workspace-drive.ts -- one drive per workspace, built from use: each repository its agents start in, in a folder of its own.
 *
 * A workspace's drive holds the default branch of the repositories its
 * agents were started in, not every one it connects, since a workspace may
 * grant far more than one function can clone. Each stands at
 * `/workspace/<owner>/<name>` as GitHub spells it, lower-cased, and is
 * recorded as the drive's in `workspace_drive_repository`
 * (`workspace-drive-repositories.ts`), which a start reads to learn whether
 * the drive holds its repository. A new workspace has no drive and no rows
 * until its first build. It is edited in place, never rebuilt whole and
 * swapped in.
 *
 * Every edit runs in a sandbox named as the drive is, which is the fill's
 * lock: of fills that find none at once, one creates it and the rest find
 * the name taken and back off. A fill that ended deletes its sandbox, so a
 * drive with no sandbox under its name is whole, and one with a sandbox up
 * under it is being filled (`readOf`), which a fill finding it leaves be
 * and no start forks. One whose sandbox stopped was left unfinished by a
 * fill that failed or was killed, since a fill touches its sandbox while it
 * runs and an untouched one stops when idle, so the next fill deletes it
 * and goes on (`@repo/sandbox`'s `filledDrive`).
 *
 * A fill adds the repositories it is handed (`fillWorkspaceDrive`): each the
 * workspace still reaches is brought to its default branch in its folder, a
 * batch of `WORKSPACE_DRIVE.BATCH` at a time, cloned where it is missing and
 * fetched where it stands (`syncedWorkspaceRepositories`), on a read token
 * for each repository alone, its installation's or its adder's own, every
 * token of the batch at the firewall for the run. No dependency is
 * installed and nothing is pruned. A repository that fails is reported and
 * gets no row, and the rest go on. The steps stop themselves at
 * `WORKSPACE_DRIVE.DEADLINE`; either way the sandbox is then released, the
 * rows of what landed are written, and a fill cut off fails with
 * `WorkspaceDriveDeadline`, for its caller to report.
 *
 * A connect or a grant fills nothing. A disconnect prunes past the
 * request's answer (`pruneWorkspaceDrive`): GitHub deleting an installation
 * or removing repositories from it (`github-webhook-app.ts`), and a member
 * removing a repository added on their token (`workspace-repositories.ts`).
 * The prune syncs nothing; it deletes the folder of every repository the
 * workspace no longer reaches, then forgets their rows. The drive and its
 * rows are deleted with the workspace (`workspace-deletion.ts`). The fill's
 * sandbox writes its firewall under the workspace's first owner.
 *
 * Every way a drive ends up not whole is reported to Sentry as a
 * `WorkspaceDriveBroken` issue (`reportedBroken`): a repository whose fill
 * failed, a fill that failed whole, and a start that found the drive left
 * unfinished, each naming the workspace.
 */

import { createHash } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type BaseDriveWorkspace,
  baseDriveWorkspaceOfInstallation,
  workspaceDriveOwner,
} from "@repo/database/models/base-drive-repositories";
import {
  forgetWorkspaceDriveRepositories,
  recordWorkspaceDriveRepositories,
  workspaceDriveRepositories,
} from "@repo/database/models/workspace-drive-repositories";
import { listWorkspaceTokenRepositories } from "@repo/database/models/workspace-token-repository-store";
import { SANDBOX_SIZE } from "@repo/features/sandbox-size";
import { causeKind } from "@repo/runtime/effect";
import {
  deletedIfStill,
  filledDrive,
  type ListedSandbox,
  SANDBOX_STATUS,
  Sandbox,
  UP_STATUSES,
} from "@repo/sandbox";
import {
  Cause,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Option,
} from "effect";
import { GitHubApp } from "../github/github-app.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import { afterResponse } from "../http/after-response.js";
import { AgentImage } from "./coder-host/agent-image.js";
import {
  firewallSessionOf,
  repositoryFirewallOver,
  repositorySandboxOver,
  type SandboxRunner,
} from "./machine/sandbox-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  prunedWorkspaceFolders,
  type RepositorySandbox,
  syncedWorkspaceRepositories,
} from "./repository-shell.js";

/**
 * What every per-repository drive, from before workspace drives, is named
 * with, its digest after it. Nothing reads or fills one any more; a deleted
 * workspace's are still deleted with it (`workspace-deletion.ts`).
 */
const REPOSITORY_DRIVE_PREFIX = "agent-base-drive-";

export const WORKSPACE_DRIVE = {
  /** Every workspace drive, and the sandbox that fills it, is named with this, its digest after it. */
  NAME_PREFIX: "agent-workspace-drive-",
  /** Where the drive is mounted: each repository's folder stands under it. */
  MOUNT: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
  /** How many repositories a fill syncs in one run, their tokens minted at once and standing at the firewall together. */
  BATCH: 16,
  /** How long a fill's steps run before it stops itself, well inside the bound of the function that runs it, which is left to release the drive and write its rows. */
  DEADLINE: Duration.minutes(10),
} as const;

/** What fills a workspace's drive in a function that may: the edge's runner a fill's checkout runs through, and the agents' image it opens from. */
interface WorkspaceDriveFillsService {
  readonly run: SandboxRunner;
  readonly image: Effect.Effect<string, unknown>;
}

/** The fills of workspace drives a function offers, provided beside its native agents (`apps/web/server/native-agents.ts`). */
export class WorkspaceDriveFills extends Context.Service<
  WorkspaceDriveFills,
  WorkspaceDriveFillsService
>()("WorkspaceDriveFills") {}

/** The fills on the runner given, over the agents' image the function ships. */
export function workspaceDriveFillsLayer(
  run: SandboxRunner,
): Layer.Layer<WorkspaceDriveFills, never, AgentImage> {
  return Layer.effect(
    WorkspaceDriveFills,
    Effect.map(AgentImage, (agentImage) => ({ run, image: agentImage.reference })),
  );
}

/** How a workspace's drive was found not whole, which a `WorkspaceDriveBroken` report names. */
export const DRIVE_BROKEN = {
  /** A repository's checkout failed in a fill, which went on to the next. */
  REPOSITORY_FAILED: "repository_failed",
  /** A fill failed whole, before or past its repositories. */
  FILL_FAILED: "fill_failed",
  /** A start found a fill's sandbox left past its grace, so the drive is unfinished. */
  UNFINISHED: "unfinished",
} as const;

type DriveBroken = (typeof DRIVE_BROKEN)[keyof typeof DRIVE_BROKEN];

/**
 * A workspace's drive found not whole, reported as one issue whatever the
 * workspace, since the workspace and how it broke ride as attributes rather
 * than in its message.
 */
class WorkspaceDriveBroken extends Data.TaggedError("WorkspaceDriveBroken")<{
  readonly workspaceId: string;
  readonly broken: DriveBroken;
  readonly detail: string | undefined;
}> {
  override get message(): string {
    return `a workspace's drive is not whole (${this.broken}), so its agents start from the image and clone`;
  }

  override get [ErrorReporter.attributes]() {
    return {
      workspaceId: this.workspaceId,
      broken: this.broken,
      ...(this.detail === undefined ? undefined : { detail: this.detail }),
    };
  }
}

/** A fill that ran past `WORKSPACE_DRIVE.DEADLINE` and stopped itself, its drive released with what landed before it. */
export class WorkspaceDriveDeadline extends Data.TaggedError("WorkspaceDriveDeadline")<{
  readonly workspaceId: string;
}> {
  override get message(): string {
    return "a workspace's drive fill ran past its deadline";
  }
}

/** A workspace's drive reported to Sentry as not whole, and logged as an error, with how it broke. */
export function reportedBroken(
  workspaceId: string,
  broken: DriveBroken,
  detail?: string,
): Effect.Effect<void> {
  return Effect.andThen(
    Effect.logError(`a workspace's drive is not whole: ${broken}`).pipe(
      Effect.annotateLogs({ workspaceId, broken }),
    ),
    ErrorReporter.report(Cause.fail(new WorkspaceDriveBroken({ workspaceId, broken, detail }))),
  );
}

/** Where a drive stands for a start or a fill: free to fork, being filled, or wanted, with the sandbox a fill left in the way. */
export const DRIVE_STATE = { READY: "ready", FILLING: "filling", WANTED: "wanted" } as const;

type DriveRead =
  | { readonly state: typeof DRIVE_STATE.READY }
  | { readonly state: typeof DRIVE_STATE.FILLING }
  | { readonly state: typeof DRIVE_STATE.WANTED; readonly stale: ListedSandbox };

/** One repository the drive holds, as the workspace reaches it: its name, and the member whose own token reaches it where the installation does not. */
interface HeldRepository {
  readonly fullName: string;
  readonly member: string | undefined;
}

/** The drive's name, and its fill's sandbox's: the prefix and a digest of the workspace. */
export function workspaceDriveName(workspaceId: string): string {
  const digest = createHash("sha256").update(workspaceId).update("\0").digest("hex");

  return `${WORKSPACE_DRIVE.NAME_PREFIX}${digest.slice(0, 32)}`;
}

/** Whether a sandbox is a fill still running: up, since a fill touches its sandbox while it runs and one left untouched stops. */
function stillFilling(found: ListedSandbox): boolean {
  return UP_STATUSES.has(found.status) || found.status === SANDBOX_STATUS.STOPPING;
}

/** The fill's sandbox found under a drive's name: none, so the drive is free to fork; one filling; or one a fill left. */
export function readOf(found: ListedSandbox | undefined): DriveRead {
  if (found === undefined) return { state: DRIVE_STATE.READY };

  if (stillFilling(found)) return { state: DRIVE_STATE.FILLING };

  return { state: DRIVE_STATE.WANTED, stale: found };
}

/** A per-repository drive's name, and its fill's sandbox's: the prefix and a digest of the workspace and the repository, lower-cased. */
export function baseDriveName(workspaceId: string, fullName: string): string {
  const digest = createHash("sha256")
    .update(workspaceId)
    .update("\0")
    .update(fullName.toLowerCase())
    .update("\0")
    .digest("hex");

  return `${REPOSITORY_DRIVE_PREFIX}${digest.slice(0, 32)}`;
}

/** The folder under the mount a repository stands in: `owner/name` as GitHub spells it, lower-cased, so one repository is one folder however a row cases it. */
export function workspaceFolderOf(fullName: string): string {
  return fullName.toLowerCase();
}

/** Every repository the workspace connects: its installations', then those members added on their own tokens that no installation reaches. */
const heldRepositories = (workspace: BaseDriveWorkspace) =>
  Effect.gen(function* () {
    const listed = yield* (yield* GitHubApp).workspaceRepositories(workspace.workspaceId);

    const installed: HeldRepository[] = Option.getOrElse(listed, () => []).map((repository) => ({
      fullName: repository.fullName,
      member: undefined,
    }));

    const seen = new Set(installed.map((each) => workspaceFolderOf(each.fullName)));
    const added = yield* listWorkspaceTokenRepositories(workspace.userId, workspace.workspaceId);

    const onTokens = added
      .filter((row) => !seen.has(workspaceFolderOf(row.repository)))
      .map((row) => ({ fullName: row.repository, member: row.addedByUserId }));

    return [...installed, ...onTokens];
  });

/** A repository's sync failure reported and passed by; an interruption, the function's own deadline, still ends the step. */
const reportedFailed = (workspaceId: string) => (cause: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.failCause(cause)
    : reportedBroken(workspaceId, DRIVE_BROKEN.REPOSITORY_FAILED, causeKind(cause));

/**
 * A batch of repositories each brought to its default branch in its folder,
 * in one run, on read tokens minted for them now, all at once; one the
 * workspace no longer reaches is left out, and each that failed, to mint or
 * to sync, is reported and passed by; answers the folders that landed. Note
 * that a run that failed whole, its firewall or the sandbox, fails the fill,
 * which leaves the drive unfinished rather than passing the whole batch by.
 */
const heldBatch = (
  sandbox: RepositorySandbox,
  workspaceId: string,
  held: readonly HeldRepository[],
) =>
  Effect.gen(function* () {
    const app = yield* GitHubApp;

    const reached = yield* Effect.forEach(
      held,
      (each) =>
        app
          .repositoryReadToken(workspaceId, each.fullName, each.member)
          .pipe(
            Effect.catchCause((cause) =>
              Effect.as(reportedFailed(workspaceId)(cause), Option.none()),
            ),
          ),
      { concurrency: "unbounded" },
    );

    const batch = reached.flatMap((each) =>
      Option.isNone(each)
        ? []
        : [
            {
              fullName: each.value.repository.fullName,
              branch: each.value.repository.defaultBranch,
              folder: workspaceFolderOf(each.value.repository.fullName),
              token: each.value.token,
              access: each.value.access,
            },
          ],
    );

    if (batch.length === 0) return [];
    const failed = yield* syncedWorkspaceRepositories(sandbox, batch);

    // Note that the folder is left out of the report, since a repository's name is the workspace's own.
    yield* Effect.forEach(
      failed,
      () => reportedBroken(workspaceId, DRIVE_BROKEN.REPOSITORY_FAILED, "the sync failed"),
      { discard: true },
    );

    const missed = new Set(failed);

    return batch.flatMap((each) => (missed.has(each.folder) ? [] : [each.folder]));
  });

/**
 * The fill's steps on the workspace's drive, from the image given, under the
 * fill's lock and its deadline, then what is owed once the drive is whole.
 * Note that the deadline only ends the steps: the sandbox is still released
 * as at a fill's end, so the drive is whole with what landed before it,
 * `whole` still runs, and only then does the fill fail with
 * `WorkspaceDriveDeadline`. Answers false where another fill holds the
 * drive, and true once the steps ran and the lock was released.
 */
const lockedFill = <E, R, E2, R2>(
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
  steps: (sandbox: RepositorySandbox) => Effect.Effect<void, E, R>,
  whole: Effect.Effect<void, E2, R2>,
) =>
  Effect.gen(function* () {
    const api = yield* Sandbox;
    const name = workspaceDriveName(workspace.workspaceId);
    const read = readOf(yield* api.get(name));

    if (read.state === DRIVE_STATE.FILLING) return false;

    if (read.state === DRIVE_STATE.WANTED && !(yield* deletedIfStill(read.stale))) return false;
    const context = yield* Effect.context<DatabaseServices>();
    let cutOff = false;

    const filled = yield* filledDrive(
      { name, drive: name, at: WORKSPACE_DRIVE.MOUNT, image, vcpus: SANDBOX_SIZE.VCPUS },
      (running) =>
        steps(
          repositorySandboxOver(
            api,
            running,
            run,
            repositoryFirewallOver(api, context, firewallSessionOf(running, workspace.userId), {}),
          ),
        ).pipe(
          Effect.timeoutOrElse({
            duration: WORKSPACE_DRIVE.DEADLINE,
            orElse: () =>
              Effect.sync(() => {
                cutOff = true;
              }),
          }),
        ),
    );

    if (!filled) return false;
    yield* whole;

    if (cutOff) return yield* new WorkspaceDriveDeadline({ workspaceId: workspace.workspaceId });

    return true;
  });

/**
 * The repositories given added to the workspace's drive in place, from the
 * image given: each the workspace still reaches brought to its default
 * branch in its folder, cloned where it is missing and fetched where it
 * stands, a batch at a time, a failure reported and passed by, and nothing
 * pruned. Each that landed is then recorded as the drive's
 * (`workspace-drive-repositories.ts`), even where the deadline cut the fill
 * off past it. Answers the repositories that landed, lower-cased
 * `owner/name`, or false where another fill holds the drive.
 */
export const fillWorkspaceDrive = Effect.fn("web/fillWorkspaceDrive")(function* (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
  repositories: readonly string[],
) {
  const wanted = new Set(repositories.map(workspaceFolderOf));
  const reached = yield* heldRepositories(workspace);
  const adding = reached.filter((held) => wanted.has(workspaceFolderOf(held.fullName)));
  const landed: string[] = [];

  const filled = yield* lockedFill(
    run,
    image,
    workspace,
    (sandbox) =>
      Effect.gen(function* () {
        for (let at = 0; at < adding.length; at += WORKSPACE_DRIVE.BATCH) {
          const batch = adding.slice(at, at + WORKSPACE_DRIVE.BATCH);
          landed.push(...(yield* heldBatch(sandbox, workspace.workspaceId, batch)));
        }
      }),
    Effect.flatMap(DateTime.nowAsDate, (now) =>
      recordWorkspaceDriveRepositories(workspace.workspaceId, landed, now),
    ),
  );

  return filled ? landed : false;
});

/**
 * The workspace's drive pruned as a repository leaves the workspace, from
 * the image given: every folder of a repository it no longer reaches
 * deleted, nothing synced, then those repositories forgotten as the
 * drive's. Answers whether this call pruned it: false where another fill
 * holds it.
 */
export const pruneWorkspaceDrive = Effect.fn("web/pruneWorkspaceDrive")(function* (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
) {
  const keep = (yield* heldRepositories(workspace)).map((held) => workspaceFolderOf(held.fullName));
  const kept = new Set(keep);

  return yield* lockedFill(
    run,
    image,
    workspace,
    (sandbox) => prunedWorkspaceFolders(sandbox, keep),
    Effect.flatMap(workspaceDriveRepositories(workspace.workspaceId), (recorded) =>
      forgetWorkspaceDriveRepositories(
        workspace.workspaceId,
        recorded.filter((repository) => !kept.has(repository)),
      ),
    ),
  );
});

/** The workspace's drive pruned past the answer, where the function fills drives; its GitHub reads in the background lane, since no member waits on them. */
const prunedFor = (workspace: Option.Option<BaseDriveWorkspace>) =>
  Effect.gen(function* () {
    const fills = yield* Effect.serviceOption(WorkspaceDriveFills);
    const sandbox = yield* Effect.serviceOption(Sandbox);

    if (Option.isNone(fills) || Option.isNone(sandbox) || Option.isNone(workspace)) return;
    const { run, image } = fills.value;
    yield* afterResponse(
      "A workspace's drive",
      Effect.flatMap(image, (reference) =>
        pruneWorkspaceDrive(run, reference, workspace.value),
      ).pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : reportedBroken(
                workspace.value.workspaceId,
                DRIVE_BROKEN.FILL_FAILED,
                causeKind(cause),
              ),
        ),
        Effect.provideService(GitHubBackground, true),
        Effect.provideService(Sandbox, sandbox.value),
      ),
    );
  });

/** The workspace's drive pruned past the answer, as a repository leaves it; a workspace the store could not read prunes nothing. */
export const workspaceDrivePruned = (workspaceId: string) =>
  Effect.flatMap(
    Effect.orElseSucceed(workspaceDriveOwner(workspaceId), () => Option.none()),
    prunedFor,
  );

/** The drive of the workspace an installation is linked to pruned past the answer, as GitHub says repositories left it. */
export const installationDrivePruned = (installationId: number) =>
  Effect.flatMap(
    Effect.orElseSucceed(baseDriveWorkspaceOfInstallation(installationId), () => Option.none()),
    prunedFor,
  );
