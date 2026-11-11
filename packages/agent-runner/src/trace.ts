/**
 * trace.ts -- a cloud launch's startup as spans in the launch's own Sentry trace, up to the harness's first request to the model; nothing at all where the config hands no trace, as on a host.
 *
 * The service hands a launch in the cloud's sandbox its Sentry and the trace
 * its launch span (`web/agentLaunch`) stands in, as the config's `trace`.
 * The runner starts Sentry's Node SDK on it with no integrations, so it
 * captures no error, instruments no module, and sends only what this file
 * makes: a startup span continuing that trace, from the process's start to
 * the harness's first request to the model, and beneath it the config's
 * read, the harness's start (Claude Code's MCP relays and its CLI spawned
 * and initialized, Codex's app-server spawned and its thread opened), and
 * the time from the runner taking the turn's message to that request, each
 * named by its harness and the launch's path. Note that the startup ends as
 * the request leaves, because what follows is the model's own latency, not
 * the launch's. Every post the runner makes carries the trace as well, so the
 * service's spans for them join it and follow its sampling. A span keeps
 * only the attributes set here and Sentry's own `sentry.*` bookkeeping, so
 * nothing leaves but ids, names, kinds and durations.
 *
 * A sampled startup is also profiled: Sentry's Node profiler samples the
 * runner's stacks while the startup's span is open, so the profile holds the
 * functions the startup ran and their timings, never a value. Its binary
 * sits beside the bundle in the agent image (`scripts/profiler-binary.mjs`),
 * and its module is imported only once a launch is handed a trace, because a
 * host's runner ships no binary and the module loads it as it is imported.
 * A profiler that does not load, as on a sandbox whose disk predates its
 * binary, leaves the startup traced without a profile, said once in the
 * runner's log, because a launch never fails on its telemetry.
 *
 * Note that the spans are started inactive and parented by hand, because a
 * fiber does not carry the Node async context the SDK reads an active span
 * from.
 */

import * as Sentry from "@sentry/node";
import { Context, Effect, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { RunnerHarness, RunnerMessage, RunnerTrace } from "./protocol.js";

/** The spans of a launch's startup. */
export const RUNNER_SPAN = {
  STARTUP: "runner/startup",
  CONFIG: "runner/config",
  MCP_RELAY: "runner/mcpRelay",
  CLI: "runner/cli",
  HANDSHAKE: "runner/handshake",
  FIRST_REQUEST: "runner/firstRequest",
} as const;
type RunnerSpan = (typeof RUNNER_SPAN)[keyof typeof RUNNER_SPAN];

/** The attributes this file sets, the only ones a span keeps beside Sentry's own. */
const ATTRIBUTE = {
  HARNESS: "harness",
  PATH: "path",
} as const;

const KEPT_ATTRIBUTES: ReadonlySet<string> = new Set(Object.values(ATTRIBUTE));

/** What leads Sentry's own attributes: the trace's segment, the SDK, the environment and release. */
const SENTRY_ATTRIBUTE_PREFIX = "sentry.";

/**
 * How long the runner waits on Sentry to send what it queued, after the
 * first model request and as the launch ends, so a Stop's end is held at most this.
 */
const FLUSH_MS = 1_000;

/** Claude Code's status as it begins a request to the model. */
const CLAUDE_REQUESTING = "requesting";

/** Codex's notification of a turn begun. */
const CODEX_TURN_STARTED = "turn/started";

/** A launch's tracing, as the runner and either harness's launch use it. */
export interface LaunchTrace {
  /** Runs the launch with every post it makes carrying the launch's trace in place of a trace of its own. */
  readonly traced: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R | HttpClient.HttpClient>;
  /** Headers carrying the launch's trace, for a post made outside its client. */
  readonly headers: Readonly<Record<string, string>>;
  /** Runs a step of the harness's start under a span of its own, beneath the startup's. */
  readonly step: <A, E, R>(
    name: RunnerSpan,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  /** The turn's message taken, from which its first model request is timed; the launch's first alone counts. */
  readonly taken: Effect.Effect<void>;
  /** A message the launch posts, watched for the turn's first model request. */
  readonly observe: (message: RunnerMessage) => Effect.Effect<void>;
}

/** The tracing of a launch handed no trace: it runs exactly as it would without this file. */
const UNTRACED: LaunchTrace = {
  traced: (effect) => effect,
  headers: {},
  step: (_name, effect) => effect,
  taken: Effect.void,
  observe: () => Effect.void,
};

/** Attributes as they leave: those this file set, and Sentry's own. */
function keptAttributes<Attributes extends Record<string, unknown>>(
  attributes: Attributes,
): Attributes {
  // SAFETY: a subset of the attributes' own entries, each kept as it was.
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => KEPT_ATTRIBUTES.has(key) || key.startsWith(SENTRY_ATTRIBUTE_PREFIX),
    ),
  ) as Attributes;
}

/**
 * What the SDK starts with: the service's project, environment and release;
 * no integrations but the profiler where it loaded, so nothing is instrumented and no
 * uncaught error is caught; every sampled trace profiled while its spans run; no error event, no client report, no metric; and the launch trace's own
 * sampling, with none of the runner's own where the trace named none.
 * Note that the runtime's module hooks stay off, because nothing here needs
 * them and the launch's start is to run as it did.
 */
function sentryOptions(
  trace: RunnerTrace,
  profiling: ProfilingNode | undefined,
): Sentry.NodeOptions {
  return {
    dsn: trace.dsn,
    environment: trace.environment,
    ...(trace.release === undefined ? undefined : { release: trace.release }),
    defaultIntegrations: false,
    integrations: profiling === undefined ? [] : [profiling.nodeProfilingIntegration()],
    profileSessionSampleRate: 1,
    profileLifecycle: "trace",
    enableRuntimeChannelInjection: false,
    sendClientReports: false,
    tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(0),
    beforeSend: () => null,
    beforeSendSpan: (span) => ({ ...span, attributes: keptAttributes(span.attributes) }),
  };
}

/** Sentry's Node profiler, imported only for a launch handed a trace. */
type ProfilingNode = typeof import("@sentry/profiling-node");

/** How the profiler's module is imported: the installed one, or one a test stands in that cannot load. */
export const ProfilerImport = Context.Reference<() => Promise<ProfilingNode>>(
  "@repo/agent-runner/ProfilerImport",
  { defaultValue: () => () => import("@sentry/profiling-node") },
);

/**
 * Sentry's Node profiler, or none where its module did not load, which says
 * why in the runner's log. Note that the module throws as it is imported
 * where its binary is missing or built for another Node, so the import's
 * failure is the profiler's absence rather than the launch's.
 */
const loadedProfiler: Effect.Effect<ProfilingNode | undefined> = Effect.flatMap(
  ProfilerImport,
  (importProfiler) =>
    Effect.tryPromise({
      try: importProfiler,
      catch: (cause) => (cause instanceof Error ? cause.message.split("\n", 1)[0] : String(cause)),
    }),
).pipe(
  Effect.catch((why) =>
    Effect.as(
      Effect.logWarning(`agent-runner: the startup is traced without a profile: ${why}`),
      undefined,
    ),
  ),
);

/** Whether a message is the harness beginning a request to the model. */
function isModelRequest(message: RunnerMessage): boolean {
  if ("method" in message) return message.method === CODEX_TURN_STARTED;
  return (
    message.type === "system" &&
    message.subtype === "status" &&
    message.status === CLAUDE_REQUESTING
  );
}

/**
 * The startup's spans as a launch moves through them. Note that a span
 * ends once, and ending it again does nothing, so whatever is still open
 * as the launch ends is ended whole.
 */
interface Startup {
  readonly span: Sentry.Span;
  readonly attributes: Readonly<Record<string, string>>;
  /** The span from the turn's message taken to its first model request. */
  firstRequest: Sentry.Span | undefined;
  requested: boolean;
}

/** A span of the startup's, beneath the startup's own or the parent given. */
function childSpan(
  startup: Startup,
  name: RunnerSpan,
  parentSpan = startup.span,
  startTime?: number,
) {
  return Sentry.startInactiveSpan({
    name,
    parentSpan,
    attributes: startup.attributes,
    ...(startTime === undefined ? undefined : { startTime }),
  });
}

/** Ends every span of the startup's still open, its own last. */
function endStartup(startup: Startup): void {
  startup.firstRequest?.end();
  startup.span.end();
}

/** Watches one message for the turn's first model request; answers whether it was that request, which ended the startup. */
function observed(startup: Startup, message: RunnerMessage): boolean {
  if (startup.firstRequest === undefined || startup.requested || !isModelRequest(message))
    return false;
  startup.requested = true;
  endStartup(startup);
  return true;
}

/** The SDK started on the trace handed, and the startup's span begun at the process's start, its config's read beneath it. */
function begunStartup(
  trace: RunnerTrace,
  harness: RunnerHarness,
  profiling: ProfilingNode | undefined,
): Startup {
  Sentry.init(sentryOptions(trace, profiling));
  const attributes = {
    [ATTRIBUTE.HARNESS]: harness,
    ...(trace.path === undefined ? undefined : { [ATTRIBUTE.PATH]: trace.path }),
  };
  // Note that Node's time origin is the instant the process started.
  const processStart = performance.timeOrigin;
  const span = Sentry.continueTrace(
    { sentryTrace: trace.sentryTrace, baggage: trace.baggage },
    () =>
      Sentry.withActiveSpan(null, () =>
        Sentry.startInactiveSpan({
          name: RUNNER_SPAN.STARTUP,
          startTime: processStart,
          attributes,
        }),
      ),
  );
  const startup: Startup = {
    span,
    attributes,
    firstRequest: undefined,
    requested: false,
  };
  childSpan(startup, RUNNER_SPAN.CONFIG, span, processStart).end();
  return startup;
}

/** What Sentry queued, sent within its bound. */
const flushed = Effect.asVoid(Effect.promise(() => Sentry.flush(FLUSH_MS)));

/** A launch's tracing on the trace it was handed. */
function tracedLaunch(startup: Startup): LaunchTrace {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    Sentry.getTraceData({ span: startup.span, propagateTraceparent: true }),
  )) {
    if (value !== undefined) headers[name] = value;
  }
  return {
    traced: (effect) =>
      effect.pipe(
        Effect.updateService(HttpClient.HttpClient, (client) =>
          HttpClient.mapRequest(client, HttpClientRequest.setHeaders(headers)),
        ),
        // Note that the client's own spans put no trace of theirs on a post, which carries the launch's.
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      ),
    headers,
    step: (name, effect) =>
      Effect.suspend(() => {
        const span = childSpan(startup, name);
        return Effect.ensuring(
          effect,
          Effect.sync(() => span.end()),
        );
      }),
    taken: Effect.sync(() => {
      if (startup.firstRequest !== undefined) return;
      startup.firstRequest = childSpan(startup, RUNNER_SPAN.FIRST_REQUEST);
    }),
    // The startup's spans are sent at once rather than as the launch ends, which may be an hour off.
    observe: (message) =>
      Effect.suspend(() =>
        observed(startup, message) ? Effect.asVoid(Effect.forkDetach(flushed)) : Effect.void,
      ),
  };
}

/**
 * The tracing of a launch on its config: on the trace it was handed, its
 * open spans ended and what Sentry queued sent as the launch's scope
 * closes; or none, where it was handed no trace.
 */
export const launchTrace = (
  trace: RunnerTrace | undefined,
  harness: RunnerHarness,
): Effect.Effect<LaunchTrace, never, Scope.Scope> =>
  trace === undefined
    ? Effect.succeed(UNTRACED)
    : Effect.map(
        Effect.acquireRelease(
          Effect.map(loadedProfiler, (profiling) => begunStartup(trace, harness, profiling)),
          (startup) =>
            Effect.andThen(
              Effect.sync(() => endStartup(startup)),
              flushed,
            ),
        ),
        tracedLaunch,
      );
