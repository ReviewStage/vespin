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
 * again.
 *
 * A fill runs as a chain of steps, so no function's bound cuts it off
 * whatever the workspace's size: each step syncs repositories for
 * `WORKSPACE_DRIVE_FILL.STEP` and then publishes the next, from the
 * repository it reached, to the workspace-drive-fills queue
 * (`workspaceDriveFillsHandler`), which resumes the same sandbox; a step
 * that failed comes again. The first step runs where the fill was asked.
 *
 * A fill lists the repositories as they stand now and, a batch of
 * `WORKSPACE_DRIVE_FILL.BATCH` at a time, brings each to its default branch
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
 * The drive is regenerated past the request's answer whenever a repository
 * is connected or disconnected: a workspace connecting its installation
 * (`github-install-app.ts`), GitHub creating, unsuspending, or deleting an
 * installation, or adding repositories to it or removing them
 * (`github-webhook-app.ts`), and a member adding or removing a repository on
 * their token (`workspace-repositories.ts`). The daily refresh fills every
 * drive that is missing or unfinished (`base-drive-refresh.ts`), and the
 * drive is deleted with its workspace (`workspace-deletion.ts`). The fill's sandbox
 * writes its firewall under the workspace's first owner.
 *
 * A drive that is not whole sends its workspace's agents to the image to
 * clone, so every way one ends up so is reported to Sentry as
 * a `WorkspaceDriveBroken` issue (`reportedBroken`), a repository whose fill
 * failed, a fill that failed whole, and a start that found the drive gone or
 * left unfinished, each naming the workspace.
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
  type ListedSandbox,
  resumedRunning,
  SANDBOX_STATUS,
  SANDBOX_TOUCH_EVERY,
  Sandbox,
  type SandboxRunning,
  type SandboxService,
  touchSandbox,
  UP_STATUSES,
} from "@repo/sandbox";
import { send } from "@vercel/queue";
import {
  Cause,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Data,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Option,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { GitHubApp } from "../github/github-app.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import { afterResponse } from "../http/after-response.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../queues/queue-consumer.js";
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
import { WORKSPACE_DRIVE_FILL } from "./workspace-drive-fill-bounds.js";

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
  /** How long a step waits on the fill's stopped sandbox to resume. */
  RESUME_WAIT: Duration.minutes(2),
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
  /** A start forked the drive and found none. */
  GONE: "gone",
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
 * firewall or the sandbox, fails the step, so the step comes again from the
 * same place rather than passing the whole batch by.
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

/** What a fill's steps run against: the store, GitHub, and the sandboxes. */
export type DriveFillServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | Sandbox;

/** The next step of a fill: the edge's runner and image it fills with, the workspace, and the place in its repositories it starts at. */
interface NextFillStep {
  readonly run: SandboxRunner;
  readonly image: string;
  readonly workspace: BaseDriveWorkspace;
  readonly from: number;
}

interface DriveFillStepsService {
  /** The next step handed on, to run after this one's function has answered; a publish that failed is reported, and the fill is left unfinished. */
  readonly publish: (next: NextFillStep) => Effect.Effect<void, never, DriveFillServices>;
}

/** A step as the queue carries it: the workspace, and the place in its repositories the step starts at. */
const FillStepSchema = Schema.Struct({ workspaceId: Schema.String, from: Schema.Number });

/** The fill's sandbox created anew for its first step, a stopped one a fill left deleted first; none where another fill holds the name. */
const openedForFill = (api: SandboxService, name: string, image: string) =>
  Effect.gen(function* () {
    const read = readOf(yield* api.get(name));

    if (read.state === DRIVE_STATE.FILLING) return undefined;

    if (read.state === DRIVE_STATE.WANTED && !(yield* deletedIfStill(read.stale))) return undefined;

    const created = yield* api
      .create({
        name,
        from: { image },
        drive: { fill: name, at: WORKSPACE_DRIVE.MOUNT },
        tags: {},
        vcpus: SANDBOX_SIZE.VCPUS,
        env: {},
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag("SandboxNameTaken", () => Effect.succeed(Option.none())),
      );

    if (Option.isNone(created)) return undefined;

    return { name, running: created.value.running } satisfies SandboxRunning;
  });

/** The fill's sandbox a later step goes on in, resumed where it stopped; none where it stands no more, as a fill ended or deleted since. */
const resumedForFill = (api: SandboxService, name: string) =>
  Effect.gen(function* () {
    const found = yield* api.get(name);

    if (found === undefined) return undefined;

    if (found.status === SANDBOX_STATUS.RUNNING && found.running !== undefined) {
      return { name, running: found.running } satisfies SandboxRunning;
    }

    return yield* resumedRunning(name).pipe(
      Effect.timeoutOrElse({
        duration: WORKSPACE_DRIVE.RESUME_WAIT,
        orElse: () => Effect.fail(new Error("the fill's sandbox did not resume")),
      }),
    );
  });

/**
 * One step of the workspace's drive's fill, from the repository at `from`:
 * the first creates the fill's sandbox and a later one goes on in it. It
 * brings each repository to its default branch in its folder, one after
 * another, a failure reported and passed by, until `WORKSPACE_DRIVE_FILL.STEP`
 * has passed, when it hands the rest to the next step; the last deletes
 * every folder of a repository no longer connected and then the sandbox,
 * which leaves the drive whole. A step that failed stops the sandbox, so the
 * drive reads unfinished until a step comes again. Answers whether this
 * call held the fill: false where another fill holds it, or none stands to
 * go on with.
 */
const filledFrom = (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
  from: number,
): Effect.Effect<boolean, unknown, DriveFillServices> =>
  Effect.gen(function* () {
    const api = yield* Sandbox;
    const name = workspaceDriveName(workspace.workspaceId);

    const running: SandboxRunning | undefined = yield* from === 0
      ? openedForFill(api, name, image)
      : resumedForFill(api, name);

    if (running === undefined) return false;
    const repositories = yield* heldRepositories(workspace);
    const context = yield* Effect.context<DatabaseServices>();

    const deadline =
      (yield* Clock.currentTimeMillis) + Duration.toMillis(WORKSPACE_DRIVE_FILL.STEP);

    const sandbox = repositorySandboxOver(
      api,
      running,
      run,
      repositoryFirewallOver(api, context, firewallSessionOf(running, workspace.userId), {}),
    );

    const finished = yield* Effect.gen(function* () {
      yield* touchSandbox(name).pipe(
        Effect.delay(SANDBOX_TOUCH_EVERY),
        Effect.forever,
        Effect.forkScoped,
      );

      for (let at = from; at < repositories.length; at += WORKSPACE_DRIVE_FILL.BATCH) {
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          yield* (yield* DriveFillSteps).publish({ run, image, workspace, from: at });

          return false;
        }

        yield* heldBatch(
          sandbox,
          workspace.workspaceId,
          repositories.slice(at, at + WORKSPACE_DRIVE_FILL.BATCH),
        );
      }

      // A repository that failed above is still connected, so its folder is kept as it stood.
      yield* prunedWorkspaceFolders(
        sandbox,
        repositories.map((held) => workspaceFolderOf(held.fullName)),
      );

      return true;
    }).pipe(
      Effect.scoped,
      Effect.tapError(() => Effect.ignore(api.stop(running))),
    );

    // Note that the sandbox is stopped before its delete, because the stop lets go of the drive at once.
    if (finished) {
      yield* api.stop(running);
      yield* api.delete(name);
    }

    return true;
  }).pipe(Effect.withSpan("web/fillWorkspaceDriveStep"));

/** On Vercel: the next step sent to the topic, kept for `WORKSPACE_DRIVE_FILL.RETAINED`; a send that failed is reported. */
const vercelPublish = ({ workspace, from }: NextFillStep) =>
  Effect.tryPromise(() =>
    send(
      WORKSPACE_DRIVE_FILL.TOPIC,
      { workspaceId: workspace.workspaceId, from },
      { retentionSeconds: Math.ceil(Duration.toSeconds(WORKSPACE_DRIVE_FILL.RETAINED)) },
    ),
  ).pipe(
    Effect.timeout(WORKSPACE_DRIVE_FILL.PUBLISH_WAIT),
    Effect.catchCause((cause) =>
      reportedBroken(workspace.workspaceId, DRIVE_BROKEN.FILL_FAILED, causeKind(cause)),
    ),
  );

/** Off Vercel: the next step run here and now, since no function's bound cuts a fill off in this process; a step that failed is reported. */
const inProcessPublish = (next: NextFillStep): Effect.Effect<void, never, DriveFillServices> =>
  filledFrom(next.run, next.image, next.workspace, next.from).pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      reportedBroken(next.workspace.workspaceId, DRIVE_BROKEN.FILL_FAILED, causeKind(cause)),
    ),
  );

/** Where a fill's next step goes: this process by default, as a test or a local run has it. */
export const DriveFillSteps = Context.Reference<DriveFillStepsService>(
  "@repo/service/DriveFillSteps",
  { defaultValue: () => ({ publish: inProcessPublish }) },
);

/** The steps' queue as the deployment's environment names it: Vercel's on production and on a Preview, this process's anywhere else. */
export const driveFillStepsFromEnvironment = Layer.effect(
  DriveFillSteps,
  Effect.map(
    Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
    (deployment): DriveFillStepsService => ({
      publish: Option.exists(
        deployment,
        (named) =>
          named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
      )
        ? vercelPublish
        : inProcessPublish,
    }),
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/** The workspace's drive's fill begun from its first repository, going on in later steps past this call where it is long; whether this call took the fill. */
export const fillWorkspaceDrive = (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
) => filledFrom(run, image, workspace, 0);

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each step run and acknowledged once settled, one whose
 * workspace has no owner no more dropped, and one that failed left for the
 * queue to deliver again after `WORKSPACE_DRIVE_FILL.FAILED_AGAIN`.
 */
export function workspaceDriveFillsHandler(
  services: Context.Context<DriveFillServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.option(Schema.decodeUnknownEffect(FillStepSchema)(message));

        if (Option.isNone(decoded)) {
          yield* Effect.logError("a workspace-drive-fills message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        const { workspaceId, from } = decoded.value;
        const workspace = yield* workspaceDriveOwner(workspaceId);

        if (Option.isNone(workspace)) return QUEUE_ACKNOWLEDGED;
        // Note that the fills ride beside the runtime's services (`native-agents.ts`), so they are read as an option.
        const fills = yield* Effect.serviceOption(WorkspaceDriveFills);

        if (Option.isNone(fills)) {
          yield* Effect.logError("a workspace drive's fill step reached a function with no fills");

          return QUEUE_ACKNOWLEDGED;
        }

        const image = yield* fills.value.image;
        yield* filledFrom(fills.value.run, image, workspace.value, from).pipe(
          Effect.provideService(GitHubBackground, true),
          Effect.tapCause((cause) =>
            Effect.logWarning(`a workspace drive's fill step will run again: ${causeKind(cause)}`),
          ),
        );

        return QUEUE_ACKNOWLEDGED;
      }),
    WORKSPACE_DRIVE_FILL.FAILED_AGAIN,
  );
}

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
