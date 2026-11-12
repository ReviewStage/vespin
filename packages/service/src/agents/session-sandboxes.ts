/**
 * session-sandboxes.ts -- an agent's sandbox deleted once it has gone unused for `SANDBOX_RELEASE.UNUSED_FOR`, and a deleted workspace's with its drive.
 *
 * Whatever shows a session's sandbox in use touches it (`sandbox-use.ts`,
 * which records its last use in the `agent_sandbox` ledger); what is here
 * deletes it, and never resumes one stopped.
 *
 * An agent's session has one persistent sandbox (`agent-sandbox-open.ts`),
 * tagged with the session's id, and a new agent's sandbox owns a drive its
 * checkout stands on (`workspace-drive.ts`). An agent's sandbox is deleted, with
 * the drive it owns, through `Sandbox`'s one `delete`, once its ledger row
 * says it has gone `SANDBOX_RELEASE.UNUSED_FOR` unused with no turn open
 * (`sandboxReleaseDue`), archived or not. The release is decided first and
 * done later: the minute sweep (`releaseUnusedSandboxes`) reads the ledger
 * alone, never the provider, marks each due row RELEASING, and publishes its
 * release on `SANDBOX_RELEASE.TOPIC`, at most `SANDBOX_RELEASE.SWEEP_LIMIT`
 * a sweep, and publishes again every row still RELEASING, whose message may
 * have been lost; RELEASING rows are read apart from those newly due, so
 * releases that keep failing never hold the new ones back. Its consumer
 * (`consumeSandboxRelease`) reads the row again under the agent's runner
 * lease, which a launch holds while it opens the sandbox, just before the
 * delete, writes it LIVE where it was opened, touched, or given a turn
 * since, and else deletes the sandbox, one already gone counting as
 * deleted, and writes it RELEASED. A delivery that failed comes again. An agent brought back after its release opens a sandbox afresh,
 * its checkout made from its workspace's drive and its pushed branch,
 * as a sandbox whose snapshot lapsed is.
 *
 * Every outcome is a log line of its own, so a stuck or runaway release
 * shows.
 *
 * An agent's archive deletes nothing (`archivedInBackground`): where the
 * workspace keeps an archive script for the agent's repository, its sandbox
 * runs it (`archive-script.ts`), and a local agent's archive queues its
 * device a discard line (`device-discard.ts`). A deleted workspace's agents'
 * sandboxes are deleted at once (`deletedWithWorkspace`), from the
 * sessions its delete read while they stood, and so are its drives
 * (`workspace-drive.ts`), which no agent owns; a
 * local agent's device is told nothing there, since its discard line is
 * queued under the agent's rows, which the delete has taken. Nothing here
 * reads a sandbox's files
 * or a word of any account: what is asked of the sandboxes is a tag and a
 * name, and what is logged of a failure is the sandbox's own words.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  agentSandboxRelease,
  markAgentSandboxReleasing,
  releasableAgentSandboxes,
  settleAgentSandboxRelease,
} from "@repo/database/models/agent-sandboxes";
import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { hasOpenTurn } from "@repo/database/models/turn-state";
import { AGENT_SANDBOX_STATE } from "@repo/database/schemas/agent-sandbox";
import { CLOUD_SETUP_SCRIPT } from "@repo/features/workspace-sandbox-setup-wire";
import { causeKind, failureKind } from "@repo/runtime/effect";
import {
  deletedFilledDrive,
  isSandboxError,
  Sandbox,
  type SandboxError,
  type SandboxService,
} from "@repo/sandbox";
import { send } from "@vercel/queue";
import {
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
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { afterResponse } from "../http/after-response.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../queues/queue-consumer.js";
import { SESSION_TAG } from "./agent-sandbox-open.js";
import {
  ARCHIVE_SCRIPT,
  type ArchiveScript,
  type ArchiveScriptRan,
  archiveScriptOf,
  archiveScriptRun,
} from "./archive-script.js";
import { holdingRunner, holdingRunnerIfFree } from "./coder-host/runner-lease.js";
import { discardedOrLogged } from "./device-discard.js";
import { SANDBOX_RELEASE } from "./sandbox-release-bounds.js";
import { scriptRanIn } from "./script-runs.js";

const ARCHIVE_DELETE = {
  /**
   * The most one agent's delete runs, its list and its delete, which stops
   * a run that holds the sandbox's drive before deleting both: long enough
   * for those calls on a slow answer, short enough that a hung one does not
   * hold the function's instance for the rest of its life. A deleted
   * workspace's drive's delete, its fill's sandbox read, stopped and
   * deleted before the drive, is the same few calls and runs under the same.
   */
  TIMEOUT: Duration.seconds(15),
  /**
   * The most the archived agents' archive scripts run, all at once, each in
   * its own sandbox: a stopped sandbox's resume and the script's own bound
   * (`ARCHIVE_SCRIPT`), with room for the calls around them; past it every
   * script still running is left.
   */
  SCRIPT_TIMEOUT: Duration.sum(
    Duration.sum(ARCHIVE_SCRIPT.RESUME_TIMEOUT, ARCHIVE_SCRIPT.RUN_TIMEOUT),
    Duration.seconds(15),
  ),
  /** How many local agents of an archived task are let go of, or sandboxes and drives of a deleted workspace deleted, at once. */
  CONCURRENCY: 5,
} as const;

export interface SessionSandboxesService {
  /**
   * Deletes every sandbox tagged with the session, with the drive each
   * owns (`Sandbox`'s `delete`); answers how many were deleted.
   */
  readonly deleteFor: (sessionId: string) => Effect.Effect<number, SandboxError>;
  /**
   * Runs the archive script in the session's newest sandbox, resumed first
   * where it stopped, within its bounds (`archive-script.ts`), logging how it
   * ended; answers when it started and how it exited, or nothing where it
   * did not exit, and fails only where the sandbox refused a call.
   */
  readonly archiveFor: (
    sessionId: string,
    archive: ArchiveScript,
  ) => Effect.Effect<ArchiveScriptRan | undefined, SandboxError>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

/** A session's sandboxes deleted, over `Sandbox`. */
function sessionSandboxesOver(api: SandboxService): SessionSandboxesService {
  return {
    deleteFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(SESSION_TAG, sessionId);
        for (const sandbox of sandboxes) yield* api.delete(sandbox.name);
        return sandboxes.length;
      }),
    archiveFor: (sessionId, archive) => archiveScriptRun(api, sessionId, archive),
  };
}

/** The service over the runtime's `Sandbox`. */
export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes, never, Sandbox> = Layer.effect(
  SessionSandboxes,
  Effect.map(Sandbox, sessionSandboxesOver),
);

/** What an archive of an agent, or a workspace's delete, asks of the deployment beside it: the service over its sandboxes, the runtime's `Sandbox` in production and a script's in a test, and what keeps the function awake for the work. */
export interface SandboxDeleteReach {
  readonly sessionSandboxes: Layer.Layer<SessionSandboxes, never, Sandbox>;
  /**
   * Runs the work on past the archive's answer and answers at once. Vercel
   * may freeze a function once it has answered unless the work is handed to
   * `waitUntil`, so production hands it there (`orpc-route.ts`); a test
   * forks it detached (`testing/session-sandboxes-fake.ts`).
   */
  readonly keepAwake: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}

/** The reach of a caller handed none, such as an agent's tool: the runtime's sandboxes, the work kept past the answer where the runtime keeps work (`afterResponse`, the web's `waitUntil`), run in place where it keeps none. */
export const deploymentSandboxDeletes: SandboxDeleteReach = {
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake: (work) => afterResponse("an archived agent's sandbox work", work),
};

/** A failure as the log says it: a sandbox's own words, and the kind alone for any other, since a store failure's message may name a statement. */
function describeDeleteFailure(failure: {
  readonly _tag: string;
  readonly message?: string;
}): string {
  return isSandboxError(failure) ? failure.message : failure._tag;
}

/**
 * One archived agent's repository's archive script run in its sandbox, where
 * its workspace keeps one and the agent is still archived, and recorded as
 * that script's last run where it ran (`script-runs.ts`); one that failed,
 * could not run, or ran past its bounds is logged. Note that the script runs
 * holding the agent's runner lease, because a release backs off from a lease
 * another call holds (`consumeSandboxRelease`), so a sandbox already unused
 * long enough to be released is not deleted while its teardown runs.
 */
const archiveScriptRanWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
  sessionId: string,
) {
  const current = yield* readAgent(agent.userId, agent.id);
  if (Option.isNone(current) || current.value.archivedAt === null) return;
  const archive = yield* archiveScriptOf(current.value);
  if (archive === undefined) return;
  const sandboxes = yield* SessionSandboxes;
  const ran = yield* holdingRunner(agent.id, sandboxes.archiveFor(sessionId, archive));
  if (ran === undefined) return;
  yield* scriptRanIn(current.value, CLOUD_SETUP_SCRIPT.ARCHIVE, ran.exitCode, ran.ranAt);
});

/**
 * What the agents just archived let go of, their sandboxes left standing for
 * their release (`releaseUnusedSandboxes`). Each agent's session is read
 * here, one keyed read that fails to nothing worse than a log line, and the
 * work is handed to the reach to keep the function awake for, so this
 * returns without waiting on it and the archive never fails on it: the
 * agents' archive scripts, all at once, each in its own sandbox, under the
 * scripts' one deadline, a script past it left; and beside them a local
 * agent among them let go of on its device, its runner stopped and its
 * folder removed (`device-discard.ts`).
 */
export const archivedInBackground = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxDeleteReach,
  agents: ReadonlyArray<Pick<Agent, "id" | "userId" | "conversationId">>,
) {
  const read = yield* Effect.forEach(agents, (agent) =>
    recordedRuntimeSession(agent).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `an archived agent's sandbox was not found to run its archive script: ${describeDeleteFailure(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  // An agent that never opened a sandbox has no session, and no script to run.
  const sessions = agents.flatMap((agent, at) => {
    const sessionId = read[at];
    return sessionId === undefined ? [] : [{ agent, sessionId }];
  });
  const scriptOne = ({ agent, sessionId }: (typeof sessions)[number]) =>
    archiveScriptRanWhileArchived(agent, sessionId).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.catch((failure) =>
        Effect.logWarning(
          `an archived agent's archive script did not run: ${describeDeleteFailure(failure)}`,
        ),
      ),
    );
  const scripts = Effect.forEach(sessions, scriptOne, {
    concurrency: "unbounded",
    discard: true,
  }).pipe(
    Effect.timeoutOption(ARCHIVE_DELETE.SCRIPT_TIMEOUT),
    Effect.flatMap((finished) =>
      Option.isSome(finished)
        ? Effect.void
        : Effect.logWarning("archived agents' archive scripts were left at the archive's deadline"),
    ),
  );
  yield* reach.keepAwake(
    Effect.all(
      [
        scripts,
        Effect.forEach(agents, discardedOrLogged, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});

/**
 * The sandboxes of a deleted workspace's agents deleted, with the drives
 * they own, at once, by the sessions the workspace's delete read
 * while its agents stood, and its drives by the names it read, each with
 * the fill's sandbox under its name (`deletedFilledDrive`). Unlike a
 * release, nothing is read again first, since the agents are
 * gone and none can resume its sandbox. The deletes are
 * handed to the reach to keep the function awake for, so this returns
 * without waiting on them; one that fails or runs past its bound is logged
 * and left, its sandbox stopping on its own once idle and its drive kept.
 */
export const deletedWithWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxDeleteReach,
  sessionIds: readonly string[],
  drives: readonly string[],
) {
  const deleteSession = (sessionId: string) =>
    SessionSandboxes.use((sandboxes) => sandboxes.deleteFor(sessionId)).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.timeout(ARCHIVE_DELETE.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `a deleted workspace's agent's sandbox was not deleted: ${describeDeleteFailure(failure)}`,
        ),
      ),
    );
  const deleteDrive = (name: string) =>
    deletedFilledDrive({ name, drive: name }).pipe(
      Effect.timeout(ARCHIVE_DELETE.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `a deleted workspace's drive was not deleted: ${describeDeleteFailure(failure)}`,
        ),
      ),
    );
  yield* reach.keepAwake(
    Effect.all(
      [
        Effect.forEach(sessionIds, deleteSession, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
        Effect.forEach(drives, deleteDrive, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});

/** How a release ended, each said in a log line of its own. */
export const SANDBOX_RELEASE_OUTCOME = {
  /** Deleted, with the drive it owns, and written RELEASED. */
  RELEASED: "released",
  /** Opened, touched, or given a turn since it was found due, or a launch or an archive script under way holds its agent's runner, and written LIVE again. */
  USED_SINCE: "used-since",
  /** The row no longer stands RELEASING: reopened, already released, or gone with its agent. */
  NOT_RELEASING: "not-releasing",
} as const;

type SandboxReleaseOutcome = (typeof SANDBOX_RELEASE_OUTCOME)[keyof typeof SANDBOX_RELEASE_OUTCOME];

/** What one sweep found and did: the sandboxes it read due or still releasing, and the releases it published. */
export interface SandboxReleaseSweep {
  readonly due: number;
  readonly published: number;
}

/** Where releases go: the queue's publish. */
interface SandboxReleasesShape {
  /** The sandbox's release published, a failure said in the log, since the sweep publishes it again. */
  readonly publish: (sandboxName: string) => Effect.Effect<void, never, DatabaseServices | Sandbox>;
}

/** A release's message: the sandbox it names. */
const releaseMessageSchema = Schema.Struct({ sandboxName: Schema.String });

/** The instant a sandbox last used at or before is due: `SANDBOX_RELEASE.UNUSED_FOR` before now. */
function unusedSince(now: number): Date {
  return new Date(now - Duration.toMillis(SANDBOX_RELEASE.UNUSED_FOR));
}

/** The one rule: a sandbox's release is due once it has gone `SANDBOX_RELEASE.UNUSED_FOR` unused and no turn of its agent is open. */
function sandboxReleaseDue(usedAt: Date, now: number, turnOpen: boolean): boolean {
  return !turnOpen && usedAt.getTime() <= unusedSince(now).getTime();
}

/**
 * The release decided again under the agent's runner lease: the row read
 * again, and the sandbox deleted only where it still stands RELEASING and
 * its release is still due; else written LIVE again.
 */
const releasedHolding = (sandboxName: string) =>
  Effect.gen(function* () {
    const row = yield* agentSandboxRelease(sandboxName);
    if (Option.isNone(row) || row.value.state !== AGENT_SANDBOX_STATE.RELEASING) {
      return SANDBOX_RELEASE_OUTCOME.NOT_RELEASING;
    }
    const turnOpen = yield* hasOpenTurn(row.value.conversationId);
    if (!sandboxReleaseDue(row.value.usedAt, yield* Clock.currentTimeMillis, turnOpen)) {
      yield* settleAgentSandboxRelease(sandboxName, AGENT_SANDBOX_STATE.LIVE);
      return SANDBOX_RELEASE_OUTCOME.USED_SINCE;
    }
    yield* (yield* Sandbox)
      .delete(sandboxName)
      .pipe(Effect.timeout(SANDBOX_RELEASE.DELETE_TIMEOUT));
    yield* settleAgentSandboxRelease(sandboxName, AGENT_SANDBOX_STATE.RELEASED);
    return SANDBOX_RELEASE_OUTCOME.RELEASED;
  });

/**
 * One release consumed. The release is decided again holding the agent's
 * runner lease (`releasedHolding`), which a launch holds while it opens the
 * sandbox, so no launch opens it between the last read and the delete; a
 * lease another call holds means a launch or an archive script is under
 * way, and the row is written LIVE again. A delete that fails fails the delivery, which comes
 * again.
 */
export const consumeSandboxRelease = /* @__PURE__ */ Effect.fn("web/consumeSandboxRelease")(
  function* (
    sandboxName: string,
  ): Effect.fn.Return<SandboxReleaseOutcome, unknown, DatabaseServices | Sandbox> {
    const outcome: SandboxReleaseOutcome = yield* Effect.gen(function* () {
      const row = yield* agentSandboxRelease(sandboxName);
      if (Option.isNone(row) || row.value.state !== AGENT_SANDBOX_STATE.RELEASING) {
        return SANDBOX_RELEASE_OUTCOME.NOT_RELEASING;
      }
      const held = yield* holdingRunnerIfFree(row.value.agentId, releasedHolding(sandboxName));
      if (Option.isSome(held)) return held.value;
      yield* settleAgentSandboxRelease(sandboxName, AGENT_SANDBOX_STATE.LIVE);
      return SANDBOX_RELEASE_OUTCOME.USED_SINCE;
    });
    yield* Effect.logInfo(`an unused sandbox's release ended: ${outcome}`);
    return outcome;
  },
  (effect, sandboxName) =>
    effect.pipe(
      Effect.tapCause((cause) =>
        Effect.logWarning(
          `an unused sandbox's release failed and will come again: ${causeKind(cause)}`,
        ),
      ),
      Effect.annotateLogs({ sandboxName }),
    ),
);

/**
 * The sweep: the sandboxes due and those still RELEASING read from the
 * ledger alone, the oldest used first and at most `SANDBOX_RELEASE.SWEEP_LIMIT`
 * of each;
 * each due one marked RELEASING and each published,
 * `SANDBOX_RELEASE.PUBLISH_CONCURRENCY` at a time so a slow queue holds the
 * minute's other sweeps back by a few publishes' bounds at most.
 */
export const releaseUnusedSandboxes = /* @__PURE__ */ Effect.fn("web/releaseUnusedSandboxes")(
  function* (
    now: number,
  ): Effect.fn.Return<SandboxReleaseSweep, unknown, DatabaseServices | Sandbox> {
    const releases = yield* SandboxReleases;
    const usedBy = unusedSince(now);
    const rows = yield* releasableAgentSandboxes(usedBy, SANDBOX_RELEASE.SWEEP_LIMIT);
    const sent = yield* Effect.forEach(
      rows,
      ({ sandboxName, state }) =>
        Effect.gen(function* () {
          // Note that a row another sweep marked or an open took since the read is left to them.
          if (
            state === AGENT_SANDBOX_STATE.LIVE &&
            !(yield* markAgentSandboxReleasing(sandboxName, usedBy))
          ) {
            return false;
          }
          yield* releases.publish(sandboxName);
          return true;
        }),
      { concurrency: SANDBOX_RELEASE.PUBLISH_CONCURRENCY },
    );
    const published = sent.filter(Boolean).length;
    if (rows.length > 0) {
      yield* Effect.logInfo(
        `${published} unused sandboxes' releases published of ${rows.length} read`,
      );
    }
    return { due: rows.length, published };
  },
);

/**
 * On Vercel: the release sent to the topic under the sandbox's name, which
 * Queues drops while an earlier one is kept (`SANDBOX_RELEASE.RETENTION`),
 * waited on at most `SANDBOX_RELEASE.PUBLISH_WAIT`; a send that failed is
 * said in the log, and the sweep publishes the row, still RELEASING, again.
 */
const vercelRelease = (sandboxName: string) =>
  Effect.tryPromise(() =>
    send(
      SANDBOX_RELEASE.TOPIC,
      { sandboxName },
      {
        idempotencyKey: sandboxName,
        retentionSeconds: Math.ceil(Duration.toSeconds(SANDBOX_RELEASE.RETENTION)),
      },
    ),
  ).pipe(
    Effect.timeoutOption(SANDBOX_RELEASE.PUBLISH_WAIT),
    Effect.flatMap((sent) =>
      Option.isSome(sent)
        ? Effect.void
        : Effect.logWarning("an unused sandbox's release publish outlasted its bound"),
    ),
    Effect.catch((failure) =>
      Effect.logWarning(`an unused sandbox's release was not published: ${failureKind(failure)}`),
    ),
    Effect.annotateLogs({ sandboxName }),
  );

/** Off Vercel: the release consumed in place, a failure logged, and the sweep publishing the row again next minute. */
const inProcessRelease = (
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices | Sandbox> =>
  Effect.asVoid(consumeSandboxRelease(sandboxName).pipe(Effect.ignore));

/** The releases one runtime has: consumed in place by default, as a test or a local run has them. */
export const SandboxReleases = Context.Reference<SandboxReleasesShape>(
  "@repo/service/SandboxReleases",
  { defaultValue: () => ({ publish: inProcessRelease }) },
);

/**
 * The releases as the deployment's environment names them: published to Vercel's queue on production and on a Preview and consumed in
 * place anywhere else.
 */
export const sandboxReleasesFromEnvironment = Layer.effect(
  SandboxReleases,
  Effect.map(
    Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
    (deployment): SandboxReleasesShape => ({
      publish: Option.exists(
        deployment,
        (named) =>
          named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
      )
        ? vercelRelease
        : inProcessRelease,
    }),
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery acknowledged once settled, one that does not
 * decode dropped, and a failure left for the queue to deliver again after
 * `SANDBOX_RELEASE.FAILED_AGAIN`.
 */
export function sandboxReleasesHandler(
  services: Context.Context<DatabaseServices | Sandbox>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.option(
          Schema.decodeUnknownEffect(releaseMessageSchema)(message),
        );
        if (Option.isNone(decoded)) {
          yield* Effect.logError("a sandbox-releases message did not decode; it is dropped");
          return QUEUE_ACKNOWLEDGED;
        }
        yield* consumeSandboxRelease(decoded.value.sandboxName);
        return QUEUE_ACKNOWLEDGED;
      }),
    SANDBOX_RELEASE.FAILED_AGAIN,
  );
}
