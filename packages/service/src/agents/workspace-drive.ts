/**
 * workspace-drive.ts -- one drive per workspace holding every repository it connects, each in a folder of its own.
 *
 * A workspace's drive holds the default branch of every repository its
 * GitHub installations grant, and of every repository a member added to it
 * on their own token (`workspace-token-repository-store.ts`), each at
 * `/workspace/<owner>/<name>` as GitHub spells it, lower-cased. It is filled
 * by `@repo/sandbox`'s `filledDrive` in a sandbox named as the drive is,
 * which is the fill's lock: of fills that find none at once, one creates it
 * and the rest find the name taken. A fill that ended well deletes its
 * sandbox, so a drive with no sandbox under its name is whole, and one with
 * a sandbox under it is being filled (`readOf`), which a fill finding it
 * leaves be and no start forks, or was left unfinished by a fill that
 * failed or was cut off, which is deleted past its grace and filled again.
 *
 * A fill lists the repositories as they stand now and, one after another,
 * brings each to its default branch in its folder, fetched where it stands
 * and cloned where it does not (`syncWorkspaceRepository`), on a read token
 * for that repository alone at the firewall for the run, its installation's
 * or its adder's own. No dependency is installed on it. A repository that
 * fails is logged and the next one goes on, so one broken repository never leaves the rest unfilled. Then
 * every folder of a repository no longer listed is deleted
 * (`prunedWorkspaceFolders`), so a disconnected repository leaves the drive;
 * a listing that failed fills nothing, so nothing is deleted on a GitHub
 * that did not answer.
 *
 * The drive is regenerated past the request's answer whenever a repository
 * is connected or disconnected: a workspace connecting its installation
 * (`github-install-app.ts`), GitHub creating, unsuspending, or deleting an
 * installation, or adding repositories to it or removing them
 * (`github-webhook-app.ts`), and a member adding or removing a repository on
 * their token (`workspace-repositories.ts`). The daily refresh fills every
 * workspace's drive the same way (`base-drive-refresh.ts`), and the drive is
 * deleted with its workspace (`workspace-deletion.ts`). The fill's sandbox
 * writes its firewall under the workspace's first owner.
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
import { Cause, Clock, Context, Duration, Effect, Layer, Option } from "effect";
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
  syncWorkspaceRepository,
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
  /** How long a fill's sandbox may run before it is taken for one left behind: past any fill's clones. */
  FILL_GRACE: Duration.minutes(15),
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

/** Whether a sandbox is a fill still within its grace: up, and created less than `FILL_GRACE` ago. */
function stillFilling(found: ListedSandbox, now: number): boolean {
  const up = UP_STATUSES.has(found.status) || found.status === SANDBOX_STATUS.STOPPING;

  return (
    up &&
    found.createdAt !== undefined &&
    now - found.createdAt < Duration.toMillis(WORKSPACE_DRIVE.FILL_GRACE)
  );
}

/** The fill's sandbox found under a drive's name: none, so the drive is free to fork; one filling; or one a fill left. */
export function readOf(found: ListedSandbox | undefined, now: number): DriveRead {
  if (found === undefined) return { state: DRIVE_STATE.READY };

  if (stillFilling(found, now)) return { state: DRIVE_STATE.FILLING };

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

/** One repository brought to its default branch in its folder, on a read token minted for it now, nothing where the workspace no longer reaches it. */
const heldOne = (sandbox: RepositorySandbox, workspaceId: string, held: HeldRepository) =>
  Effect.gen(function* () {
    const reached = yield* (yield* GitHubApp).repositoryReadToken(
      workspaceId,
      held.fullName,
      held.member,
    );

    if (Option.isNone(reached)) return;
    const { repository, token, access } = reached.value;
    yield* syncWorkspaceRepository(
      sandbox,
      {
        fullName: repository.fullName,
        branch: repository.defaultBranch,
        folder: workspaceFolderOf(repository.fullName),
      },
      token,
      access,
    );
  });

/**
 * The workspace's drive filled as its repositories stand now, from the image
 * given: each one brought to its default branch in its folder, one after
 * another, a failure logged and passed by, then
 * every folder of a repository no longer connected deleted. Answers whether
 * this call filled it: false where another fill holds it.
 */
export const fillWorkspaceDrive = Effect.fn("web/fillWorkspaceDrive")(function* (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
) {
  const api = yield* Sandbox;
  const name = workspaceDriveName(workspace.workspaceId);
  const read = readOf(yield* api.get(name), yield* Clock.currentTimeMillis);

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

        for (const held of repositories) {
          yield* heldOne(sandbox, workspace.workspaceId, held).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logError(`a workspace drive's repository failed: ${causeKind(cause)}`),
            ),
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
        Effect.provideService(GitHubBackground, true),
        Effect.provideService(Sandbox, sandbox.value),
      ),
    );
  });

/** The workspace's drive regenerated past the answer, as a repository of it is connected or disconnected; a workspace the store could not read regenerates nothing. */
export const workspaceDriveRegenerated = (workspaceId: string) =>
  Effect.flatMap(
    Effect.orElseSucceed(workspaceDriveOwner(workspaceId), () => Option.none()),
    regeneratedFor,
  );

/** The drive of the workspace an installation is linked to regenerated past the answer, as GitHub says its repositories changed. */
export const installationDriveRegenerated = (installationId: number) =>
  Effect.flatMap(
    Effect.orElseSucceed(baseDriveWorkspaceOfInstallation(installationId), () => Option.none()),
    regeneratedFor,
  );
