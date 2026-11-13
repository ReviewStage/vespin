/**
 * workspace-drive.ts -- one drive per workspace holding every repository it connects, each in a folder of its own.
 *
 * A workspace's drive holds the default branch of every repository its
 * GitHub installations grant, and of every repository a member added to it
 * on their own token (`workspace-token-repository-store.ts`), each at
 * `/workspace/<owner>/<name>` as GitHub spells it, lower-cased. It is filled
 * in a sandbox named as the drive is, which is the fill's lock: of fills
 * that find none at once, one creates it and the rest find the name taken.
 * A fill that ended well deletes its sandbox, so a drive with no sandbox
 * under its name is whole, and one with a sandbox up under it is being
 * filled (`readOf`), which a fill finding it leaves be and no start forks.
 * One whose sandbox stopped was left unfinished by a fill that failed or
 * was cut off, since a fill touches its sandbox while it runs and an
 * untouched one stops when idle, so the next fill deletes it and fills
 * again. A fill runs in the one call that asked for it, past its answer
 * (`@repo/sandbox`'s `filledDrive`).
 *
 * A fill lists the repositories as they stand now and, a batch of
 * `WORKSPACE_DRIVE.BATCH` at a time, brings each to its default branch
 * in its folder, fetched where it stands and cloned where it does not
 * (`syncedWorkspaceRepositories`), several at once in one run, on a read
 * token for each repository alone, its installation's or its adder's own,
 * every token of the batch at the firewall for the run. No dependency is
 * installed on it. A repository that fails is reported and the rest go on,
 * so one broken repository never leaves the rest unfilled. Then
 * every folder of a repository no longer listed is deleted
 * (`prunedWorkspaceFolders`), so a disconnected repository leaves the drive;
 * a listing that failed fills nothing, so nothing is deleted on a GitHub
 * that did not answer.
 *
 * A connect or a grant fills nothing, since a workspace may grant far more
 * repositories than one function can clone, and a new workspace has no
 * drive until one is built; a start that finds none clones into its own
 * sandbox. The drive is regenerated past the request's answer only as a
 * repository leaves it: GitHub deleting an installation or removing
 * repositories from it (`github-webhook-app.ts`), and a member removing a
 * repository added on their token (`workspace-repositories.ts`), and the
 * drive is deleted with its workspace (`workspace-deletion.ts`). The fill's
 * sandbox writes its firewall under the workspace's first owner.
 *
 * Nothing refills a drive on a timer, so a drive that is not whole stays so
 * until someone fixes it: every way one ends up so is reported to Sentry as
 * a `WorkspaceDriveBroken` issue (`reportedBroken`), a repository whose fill
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
import { Cause, Context, Data, Effect, ErrorReporter, Layer, Option } from "effect";
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
 * to sync, is reported and passed by. Note that a run that failed whole, its
 * firewall or the sandbox, fails the fill, which leaves the drive
 * unfinished rather than passing the whole batch by.
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

    if (batch.length === 0) return;
    const failed = yield* syncedWorkspaceRepositories(sandbox, batch);

    // Note that the folder is left out of the report, since a repository's name is the workspace's own.
    yield* Effect.forEach(
      failed,
      () => reportedBroken(workspaceId, DRIVE_BROKEN.REPOSITORY_FAILED, "the sync failed"),
      { discard: true },
    );
  });

/**
 * The workspace's drive filled as its repositories stand now, from the image
 * given: each brought to its default branch in its folder, a batch at a
 * time, a failure reported and passed by, then every folder of a repository
 * no longer connected deleted. Answers whether this call filled it: false
 * where another fill holds it.
 */
export const fillWorkspaceDrive = Effect.fn("web/fillWorkspaceDrive")(function* (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
) {
  const api = yield* Sandbox;
  const name = workspaceDriveName(workspace.workspaceId);
  const read = readOf(yield* api.get(name));

  if (read.state === DRIVE_STATE.FILLING) return false;

  if (read.state === DRIVE_STATE.WANTED && !(yield* deletedIfStill(read.stale))) return false;
  const repositories = yield* heldRepositories(workspace);
  const context = yield* Effect.context<DatabaseServices>();

  return yield* filledDrive(
    { name, drive: name, at: WORKSPACE_DRIVE.MOUNT, image, vcpus: SANDBOX_SIZE.VCPUS },
    (running) =>
      Effect.gen(function* () {
        const sandbox = repositorySandboxOver(
          api,
          running,
          run,
          repositoryFirewallOver(api, context, firewallSessionOf(running, workspace.userId), {}),
        );

        for (let at = 0; at < repositories.length; at += WORKSPACE_DRIVE.BATCH) {
          yield* heldBatch(
            sandbox,
            workspace.workspaceId,
            repositories.slice(at, at + WORKSPACE_DRIVE.BATCH),
          );
        }

        // A repository that failed above is still connected, so its folder is kept as it stood.
        yield* prunedWorkspaceFolders(
          sandbox,
          repositories.map((held) => workspaceFolderOf(held.fullName)),
        );
      }),
  );
});

/** The workspace's drive regenerated past the answer, where the function fills drives; its GitHub reads in the background lane, since no member waits on them. */
const regeneratedFor = (workspace: Option.Option<BaseDriveWorkspace>) =>
  Effect.gen(function* () {
    const fills = yield* Effect.serviceOption(WorkspaceDriveFills);
    const sandbox = yield* Effect.serviceOption(Sandbox);

    if (Option.isNone(fills) || Option.isNone(sandbox) || Option.isNone(workspace)) return;
    const { run, image } = fills.value;
    yield* afterResponse(
      "A workspace's drive",
      Effect.flatMap(image, (reference) =>
        fillWorkspaceDrive(run, reference, workspace.value),
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

/** The workspace's drive regenerated past the answer, as a repository leaves it; a workspace the store could not read regenerates nothing. */
export const workspaceDriveRegenerated = (workspaceId: string) =>
  Effect.flatMap(
    Effect.orElseSucceed(workspaceDriveOwner(workspaceId), () => Option.none()),
    regeneratedFor,
  );

/** The drive of the workspace an installation is linked to regenerated past the answer, as GitHub says repositories left it. */
export const installationDriveRegenerated = (installationId: number) =>
  Effect.flatMap(
    Effect.orElseSucceed(baseDriveWorkspaceOfInstallation(installationId), () => Option.none()),
    regeneratedFor,
  );
