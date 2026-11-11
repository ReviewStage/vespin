import type { DatabaseServices } from "@repo/database/core/query";
import { causeKind } from "@repo/runtime/effect";
import type { Sandbox } from "@repo/sandbox";
import { Cause, Clock, Data, Effect, type Redacted } from "effect";
import type { SandboxReleaseSweep } from "../agents/session-sandboxes.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. Each sweep is bounded on its own, and they run in turn, each kept
 * from the others, so one that fails is logged and the rest still run. Each
 * is idempotent and reconciles what the rows say, so a minute the cron skips
 * or calls twice ends nothing it should not.
 */

type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices | Sandbox>;

interface MaintenanceSweeps {
  /** Prunes the sync log's transactions older than its keep, a sweep's worth, answering how many rows went. */
  pruneSyncLog: (now: number) => SweepRead<number>;
  /** Fails, with why, the coding agents' turns past their deadline, a sweep's worth of agents, answering how many turns it settled (`coder-host/reconcile.ts`). */
  reconcileAgents: (now: number) => SweepRead<number>;
  /** Publishes again the coding agents' turns still queued for a runner whose message may have been lost, a sweep's worth, answering how many (`coder-host/turn-delivery.ts`). */
  republishTurns: (now: number) => SweepRead<number>;
  /** Touches the sandbox of every cloud turn still running inside its progress deadline, a sweep's worth, answering how many (`coder-host/reconcile.ts`). */
  keepSandboxesUp: (now: number) => SweepRead<number>;
  /** Has the coding agents' turns held open for a usage limit's reset go on once it has passed, a sweep's worth, answering how many (`coder-host/steer.ts`'s `resumeWaitedTurns`). */
  resumeWaitedTurns: (now: number) => SweepRead<number>;
  /** Sends the alerts held while members were at their desk, for those who have since walked away, a sweep's worth, answering how many holds it took (`push/inbox-pushes.ts`'s `releaseHeldPushes`). */
  releaseHeldPushes: (now: number) => SweepRead<number>;
  /** Refreshes the Live Activity of every member with one standing on a phone, a sweep's worth, answering how many members (`push/live-activities.ts`'s `refreshLiveActivities`). */
  refreshLiveActivities: (now: number) => SweepRead<number>;
  /** Marks away every host whose beat went past fresh and is not marked yet, so the hosts read wakes as it goes quiet, answering how many (`device-store.ts`'s `markAwayDevices`). */
  markAwayHosts: (now: number) => SweepRead<number>;
  /** Queues the release of the cloud agents' sandboxes unused past their keep, and of those whose release stands unfinished, a sweep's worth, or only logs them where deleting is off (`agents/session-sandboxes.ts`'s `releaseUnusedSandboxes`). */
  releaseSandboxes: (now: number) => SweepRead<SandboxReleaseSweep>;
}

/**
 * How a run is told to the sweep's cron monitor: around the sweeps once the
 * call is the cron's own. A call that is not the cron's, or one a
 * deployment without its secret cannot authenticate, is not a run and tells
 * it nothing, so a stranger cannot report a run that failed.
 */
interface SweepMonitor {
  readonly run: <A, E, R>(sweep: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export interface MaintenanceSweepOptions extends MaintenanceSweeps {
  request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  cronSecret: Redacted.Redacted | undefined;
  monitor: SweepMonitor;
}

interface MaintenanceSweepAnswer {
  /** Sync log rows older than its keep, pruned. */
  syncLog: Swept<number>;
  /** Coding agents' turns settled past their deadline. */
  turns: Swept<number>;
  /** Coding agents' turns still queued, published again. */
  republished: Swept<number>;
  /** Running cloud turns' sandboxes touched. */
  keptUp: Swept<number>;
  /** Coding agents' turns past their limit's reset, handed on to a launch. */
  resumed: Swept<number>;
  /** Pushes held while members were at their desk, taken now that they walked away. */
  heldPushes: Swept<number>;
  /** Members whose Live Activity was refreshed. */
  liveActivities: Swept<number>;
  /** Hosts that went quiet, marked away. */
  awayHosts: Swept<number>;
  /** Cloud agents' sandboxes due for release, and the releases published. */
  sandboxReleases: Swept<SandboxReleaseSweep>;
}

/** What a sweep that failed answers in its place: the failure is logged, and the other sweeps run on. */
export const SWEEP_FAILED = { failed: true } as const;

type Swept<A> = A | typeof SWEEP_FAILED;

/** A run in which at least one sweep failed: the cron check-in fails, and the answer still says what every sweep did. */
class SweepsFailed extends Data.TaggedError("SweepsFailed")<{
  readonly answer: MaintenanceSweepAnswer;
}> {}

/**
 * One sweep, kept from the others: a failure or a defect of its own is
 * logged by its kind and answered as `SWEEP_FAILED`, so the sweeps after it
 * still run this minute rather than none of them, every minute, behind one
 * that keeps failing. An interruption, the cron's own deadline, still ends
 * the run.
 */
const isolated = <A>(name: string, sweep: SweepRead<A>): SweepRead<Swept<A>> =>
  sweep.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.as(Effect.logError(`the ${name} sweep failed: ${causeKind(cause)}`), SWEEP_FAILED),
    ),
  );

/** The sweeps in turn, each handed the same instant and each kept from the others (`isolated`). */
const sweepAll = /* @__PURE__ */ Effect.fn("web/sweepAll")(function* (
  sweeps: MaintenanceSweeps,
): Effect.fn.Return<MaintenanceSweepAnswer, unknown, DatabaseServices | Sandbox> {
  const now = yield* Clock.currentTimeMillis;
  return {
    syncLog: yield* isolated("pruneSyncLog", sweeps.pruneSyncLog(now)),
    turns: yield* isolated("reconcileAgents", sweeps.reconcileAgents(now)),
    republished: yield* isolated("republishTurns", sweeps.republishTurns(now)),
    keptUp: yield* isolated("keepSandboxesUp", sweeps.keepSandboxesUp(now)),
    resumed: yield* isolated("resumeWaitedTurns", sweeps.resumeWaitedTurns(now)),
    heldPushes: yield* isolated("releaseHeldPushes", sweeps.releaseHeldPushes(now)),
    liveActivities: yield* isolated("refreshLiveActivities", sweeps.refreshLiveActivities(now)),
    awayHosts: yield* isolated("markAwayHosts", sweeps.markAwayHosts(now)),
    sandboxReleases: yield* isolated("releaseSandboxes", sweeps.releaseSandboxes(now)),
  };
});

export const handleMaintenanceSweep = /* @__PURE__ */ Effect.fn("web/handleMaintenanceSweep")(
  function* (
    options: MaintenanceSweepOptions,
  ): Effect.fn.Return<Response, unknown, DatabaseServices | Sandbox> {
    const { request } = options;
    if (request.method !== "GET") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }
    const secret = options.cronSecret;
    if (secret === undefined) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }
    if (!bearerMatchesSecret(request, secret)) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }

    // Note that a run in which any sweep failed fails its cron check-in, so the monitor still opens
    // an issue on a sweep that keeps failing, while the sweeps after it ran and the answer says which.
    const ran: MaintenanceSweepAnswer | SweepsFailed = yield* options.monitor
      .run(
        // Note that no member waits on a sweep, so what it asks GitHub waits in the background lane (`github-rate-gate.ts`).
        Effect.flatMap(
          sweepAll(options).pipe(Effect.provideService(GitHubBackground, true)),
          (answer) =>
            Object.values(answer).some((swept) => swept === SWEEP_FAILED)
              ? Effect.fail(new SweepsFailed({ answer }))
              : Effect.succeed(answer),
        ),
      )
      .pipe(
        Effect.catch((failure) =>
          failure instanceof SweepsFailed ? Effect.succeed(failure) : Effect.fail(failure),
        ),
      );
    return ran instanceof SweepsFailed
      ? jsonResponse(HOSTED_HTTP_STATUS.INTERNAL_ERROR, ran.answer)
      : jsonResponse(HOSTED_HTTP_STATUS.OK, ran);
  },
);
