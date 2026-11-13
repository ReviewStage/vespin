/**
 * workspace-drive-builds.ts -- a workspace's drive built for the boots waiting on it, through a queue: the build published, its delivery consumed, and the boots booted once it is done.
 *
 * A boot held for its workspace's drive stands BUILDING
 * (`@repo/database`'s `agent-boot-store.ts`), and its workspace's build is
 * published on `WORKSPACE_DRIVE_BUILD.TOPIC` under nothing but the
 * workspace's id, with no dedup key: every delivery reads again what is
 * missing, so one delivered twice, or after another built the drive, builds
 * nothing more and boots only what still waits.
 *
 * Its consumer (`consumeWorkspaceDriveBuild`) reads the workspace's
 * building boots and the repositories their agents start in, and fills the
 * drive with those it does not hold yet (`workspace-drive.ts`'s
 * `fillWorkspaceDrive`), which runs up to its own deadline. Where another
 * fill holds the drive, the delivery comes again after
 * `WORKSPACE_DRIVE_BUILD.FILLING_AGAIN`, and reads again what that fill
 * left missing. A fill that failed, or ran past its deadline, is reported
 * as `WorkspaceDriveBroken` and builds nothing more. Either way every
 * building boot of the workspace is then booted (`boot.ts`'s
 * `builtBootResumed`): from a fork of the drive where it now holds the
 * boot's repository, and from the image with a clone where it does not, as
 * any open does. A delivery whose store was unreachable fails, and comes
 * again after `WORKSPACE_DRIVE_BUILD.FAILED_AGAIN`.
 *
 * The queue is Vercel Queues on production and on a Preview. Anywhere else,
 * as the local server, there is no queue: each build is handed in this
 * process to the same consumer, on a fiber of its own over the publisher's
 * services, and delivered again after the wait it asks for, as the queue
 * would.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { buildingAgentBootsOf } from "@repo/database/models/agent-boot-store";
import { readAgent } from "@repo/database/models/agent-store";
import { workspaceDriveOwner } from "@repo/database/models/base-drive-repositories";
import { workspaceDriveRepositories } from "@repo/database/models/workspace-drive-repositories";
import { causeKind, failureKind } from "@repo/runtime/effect";
import type { Sandbox } from "@repo/sandbox";
import { send } from "@vercel/queue";
import {
  Cause,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import type { GitHubApp } from "../github/github-app.js";
import { QUEUE_ACKNOWLEDGED, type QueueAnswer, queueConsumer } from "../queues/queue-consumer.js";
import type { QueueSessions } from "./coder-host/agent-queue.js";
import { builtBootResumed } from "./coder-host/boot.js";
import { routedSessions } from "./coder-host/runtime-sessions.js";
import {
  DRIVE_BROKEN,
  fillWorkspaceDrive,
  reportedBroken,
  WorkspaceDriveFills,
  workspaceFolderOf,
} from "./workspace-drive.js";
import { WORKSPACE_DRIVE_BUILD } from "./workspace-drive-build-bounds.js";

/** What a delivery runs against: the store, GitHub for the fill's tokens, the sandboxes, and what booting an agent's machine reaches. The fill's runner and image are read where the function offers them. */
export type WorkspaceDriveBuildServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | Sandbox;

/** A build's message: the workspace it names, and nothing of its repositories or agents. */
const buildMessageSchema = Schema.Struct({ workspaceId: Schema.String });

const decodeBuildMessage = Schema.decodeUnknownEffect(buildMessageSchema);

interface WorkspaceDriveBuildsService {
  /** The workspace's build published; a publish that fails is said in the log, and the boots it was for are failed by the sweep at their building deadline. */
  readonly publish: (
    workspaceId: string,
  ) => Effect.Effect<void, never, WorkspaceDriveBuildServices>;
}

/** How a fill for the missing repositories ended: done, whether or not all landed; or another fill holds the drive. */
const BUILD = { DONE: "done", BUSY: "busy" } as const;

type Build = (typeof BUILD)[keyof typeof BUILD];

/**
 * The repositories given added to the workspace's drive, where the function
 * fills drives and the workspace has an owner to fill under: busy where
 * another fill holds the drive, and done otherwise, a fill that failed
 * reported as `WorkspaceDriveBroken`.
 */
const filledWith = (workspaceId: string, missing: readonly string[]) =>
  Effect.gen(function* () {
    const fills = yield* Effect.serviceOption(WorkspaceDriveFills);
    const owner = yield* workspaceDriveOwner(workspaceId);

    if (Option.isNone(fills) || Option.isNone(owner)) return BUILD.DONE;
    const { run, image } = fills.value;

    return yield* Effect.flatMap(image, (reference) =>
      fillWorkspaceDrive(run, reference, owner.value, missing),
    ).pipe(
      Effect.map((landed): Build => (landed === false ? BUILD.BUSY : BUILD.DONE)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.as(
              reportedBroken(workspaceId, DRIVE_BROKEN.FILL_FAILED, causeKind(cause)),
              BUILD.DONE,
            ),
      ),
    );
  });

/**
 * One delivery of a workspace's build, as the header says: the repositories
 * its building boots' agents start in that its drive does not hold yet
 * filled, then every building boot booted; delivered again shortly where
 * another fill holds the drive. `sessionsFor` is the sessions the boots'
 * machines are booted through, the routed ones in a function.
 */
export const consumeWorkspaceDriveBuild = /* @__PURE__ */ Effect.fn(
  "web/consumeWorkspaceDriveBuild",
)(
  function* (
    workspaceId: string,
    sessionsFor: QueueSessions = routedSessions,
  ): Effect.fn.Return<QueueAnswer, unknown, WorkspaceDriveBuildServices> {
    const boots = yield* buildingAgentBootsOf(workspaceId);

    if (boots.length === 0) return QUEUE_ACKNOWLEDGED;
    const held = new Set(yield* workspaceDriveRepositories(workspaceId));

    const missing = [
      ...new Set(
        boots.flatMap(({ repository }) =>
          repository === null ? [] : [workspaceFolderOf(repository)],
        ),
      ),
    ].filter((repository) => !held.has(repository));

    if (missing.length > 0 && (yield* filledWith(workspaceId, missing)) === BUILD.BUSY) {
      return { acknowledged: false, again: WORKSPACE_DRIVE_BUILD.FILLING_AGAIN };
    }

    yield* Effect.forEach(
      boots,
      ({ agentId, userId, attempt }) =>
        Effect.flatMap(readAgent(userId, agentId), (agent) =>
          Option.isNone(agent) ? Effect.void : builtBootResumed(agent.value, attempt, sessionsFor),
        ),
      { discard: true },
    );

    yield* Effect.logInfo(
      `a workspace's drive build booted ${boots.length} agents, ${missing.length} repositories missing`,
    );

    return QUEUE_ACKNOWLEDGED;
  },
  (effect, workspaceId) => effect.pipe(Effect.annotateLogs({ workspaceId })),
);

/**
 * On Vercel: the build sent to the topic, pinned to this deployment, as the
 * SDK pins every send, waited on at most `WORKSPACE_DRIVE_BUILD.PUBLISH_WAIT`;
 * a send that failed or was given up is said in the log.
 */
const vercelPublish = (workspaceId: string) =>
  Effect.tryPromise(() =>
    send(
      WORKSPACE_DRIVE_BUILD.TOPIC,
      { workspaceId },
      { retentionSeconds: Math.ceil(Duration.toSeconds(WORKSPACE_DRIVE_BUILD.RETENTION)) },
    ),
  ).pipe(
    Effect.timeoutOption(WORKSPACE_DRIVE_BUILD.PUBLISH_WAIT),
    Effect.flatMap((sent) =>
      Option.isSome(sent)
        ? Effect.void
        : Effect.logWarning("a workspace's drive build's publish outlasted its bound"),
    ),
    Effect.catch((failure) =>
      Effect.logWarning(`a workspace's drive build was not published: ${failureKind(failure)}`),
    ),
    Effect.annotateLogs({ workspaceId }),
  );

/**
 * A build's deliveries in this process, as the queue would make them: each
 * handed to the consumer, and delivered again after the wait it asks for,
 * or a failure's, until it is acknowledged or its retention has passed.
 */
const deliveredInProcess = (workspaceId: string) =>
  Effect.gen(function* () {
    const until =
      (yield* Clock.currentTimeMillis) + Duration.toMillis(WORKSPACE_DRIVE_BUILD.RETENTION);

    while (true) {
      const answer = yield* consumeWorkspaceDriveBuild(workspaceId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.as(
                Effect.logWarning(
                  `a workspace's drive build will be delivered again: ${causeKind(cause)}`,
                ),
                { acknowledged: false, again: WORKSPACE_DRIVE_BUILD.FAILED_AGAIN } as const,
              ),
        ),
      );

      if (answer.acknowledged) return;
      yield* Effect.sleep(answer.again);

      if ((yield* Clock.currentTimeMillis) >= until) return;
    }
  });

/** Off Vercel: the build delivered in this process, on a fiber of its own over the publisher's services. */
const inProcessPublish = (
  workspaceId: string,
): Effect.Effect<void, never, WorkspaceDriveBuildServices> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<WorkspaceDriveBuildServices>();
    yield* Effect.forkDetach(deliveredInProcess(workspaceId).pipe(Effect.provideContext(services)));
  });

/** The builds one runtime publishes: delivered in this process by default, as a test or a local run has them. */
export const WorkspaceDriveBuilds = Context.Reference<WorkspaceDriveBuildsService>(
  "@repo/service/WorkspaceDriveBuilds",
  { defaultValue: () => ({ publish: inProcessPublish }) },
);

/** The builds as the deployment's environment names them: Vercel's queue on production and on a Preview, this process anywhere else. */
export const workspaceDriveBuildsFromEnvironment = Layer.effect(
  WorkspaceDriveBuilds,
  Effect.map(
    Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
    (deployment): WorkspaceDriveBuildsService => ({
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

/**
 * The workspace's drive built for the boots waiting on it, and those boots
 * booted once it is done, through the runtime's `WorkspaceDriveBuilds`.
 * What a start that holds its boot for the drive calls.
 */
export const workspaceDriveBuildPublished = (workspaceId: string) =>
  Effect.flatMap(WorkspaceDriveBuilds, (builds) => builds.publish(workspaceId));

/**
 * The consumer's route handler over the services the function's runtime
 * handed it, the drive's fills among them: each delivery consumed, one that
 * does not decode dropped, and a failure said in the log and left for the
 * queue to deliver again after `WORKSPACE_DRIVE_BUILD.FAILED_AGAIN`.
 */
export function workspaceDriveBuildsHandler(
  services: Context.Context<WorkspaceDriveBuildServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.option(decodeBuildMessage(message));

        if (Option.isNone(decoded)) {
          yield* Effect.logError("a workspace-drive-builds message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        return yield* consumeWorkspaceDriveBuild(decoded.value.workspaceId).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning(
              `a workspace's drive build will be delivered again: ${causeKind(cause)}`,
            ),
          ),
        );
      }),
    WORKSPACE_DRIVE_BUILD.FAILED_AGAIN,
  );
}
