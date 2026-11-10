import type { DatabaseServices } from "@repo/database/core/query";
import { pruneSyncLog } from "@repo/database/models/sync-log";
import type { Sandbox } from "@repo/sandbox";
import { Effect, Layer } from "effect";
import { HttpClient, HttpRouter } from "effect/http";
import { keepRunningSandboxesUp, reconcileAgents } from "../agents/coder-host/reconcile.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { resumeWaitedTurns } from "../agents/coder-host/steer.js";
import { republishQueuedTurns } from "../agents/coder-host/turn-delivery.js";
import { releaseUnusedSandboxes } from "../agents/session-sandboxes.js";
import type { SessionsForAccount } from "../automations/automation-runs.js";
import { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { type CronMonitor, sentryCronCheckIns } from "../observability/sentry.js";
import { releaseHeldPushes } from "../push/inbox-pushes.js";
import { refreshLiveActivities } from "../push/live-activities.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { MAINTENANCE_SWEEP, MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import { handleMaintenanceSweep } from "./maintenance-sweep.js";
import { sweepAgentWakeups } from "./wakeup-sweep.js";

/** The sweep as Sentry's Crons watches it: three minutes in a row missed, late, or failed open an issue. */
const SWEEP_MONITOR: CronMonitor = {
  slug: "maintenance-sweep",
  crontab: MAINTENANCE_SWEEP.CRONTAB,
  // Note that the check-in times the sweep's own work alone, never what it hands on past its answer, so a sweep still running when the next is called is late.
  maxRuntimeMinutes: 1,
  checkInMarginMinutes: 1,
  failuresBeforeIssue: 3,
};

/**
 * The scheduled sweep handed the deployment's real seams. A wakeup reaches
 * its agent's session through `routedSessions` acting for the agent's
 * starter, never the bearer the cron called with.
 */
const maintenanceSweepEffect = /* @__PURE__ */ Effect.fn("web/maintenanceSweepEffect")(function* (
  request: Request,
): Effect.fn.Return<
  Response,
  unknown,
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp | Sandbox
> {
  const environment = yield* HostedEnvironment;
  // The reap asks the agents' machines where their runners stand, over the deployment's own client.
  const http = yield* HttpClient.HttpClient;
  // A wakeup's line is steered on the deployment's GitHub App and client, which the sweeps' own services do not carry.
  const steering = yield* Effect.context<HttpClient.HttpClient | GitHubApp>();
  const sessionsFor: SessionsForAccount = routedSessions;
  return yield* handleMaintenanceSweep({
    request,
    cronSecret: environment.cronSecret,
    monitor: sentryCronCheckIns(SWEEP_MONITOR),
    pruneSyncLog: (now) => pruneSyncLog(new Date(now)),
    reconcileAgents: (now) =>
      Effect.provideService(reconcileAgents(now), HttpClient.HttpClient, http),
    republishTurns: republishQueuedTurns,
    keepSandboxesUp: keepRunningSandboxesUp,
    resumeWaitedTurns,
    releaseHeldPushes,
    refreshLiveActivities: () => refreshLiveActivities(),
    releaseSandboxes: releaseUnusedSandboxes,
    deliverWakeups: (now) =>
      sweepAgentWakeups(sessionsFor, new Date(now)).pipe(Effect.provideContext(steering)),
  });
});

/**
 * The group: the sweep carried to an `HttpApp`, and the hosted vocabulary's
 * own refusal for a path it does not declare — unreachable in production,
 * since `vercel.json` sends the function only its own path.
 */
export function maintenanceApp(): WebRoutes<
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp | Sandbox
> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `GET`: the handler decides its own method refusal, so a
    // request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, MAINTENANCE_SWEEP_PATH, effectPassthrough(maintenanceSweepEffect)),
    hostedNotFoundRoute,
  );
}
