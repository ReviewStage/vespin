import { Worker } from "node:worker_threads";
import {
  PRODUCT_EVENT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@repo/features/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@repo/features/feedback";
import { feedbackDeliveryFromEnvironment } from "@repo/features/feedback";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { type SentryCapture, sentryReporterLayer } from "@repo/features/sentry-reporting";
import { sentryTracesSampler, spanWithLoopStall } from "@repo/features/sentry-tracing";
import { usageDataTransportOptions } from "@repo/features/sentry-usage-data";
import { LOOP_TICK_MS, type RunMode, sentryReportingEnabled } from "@repo/host";
import { sharesUsageData } from "@repo/host/app-state";
import type { AppStateStore } from "@repo/host/client";
import type { EffectDesktopService } from "@repo/host/desktop-service";
import type { ReportAttributes } from "@repo/host/effect";
import type { MainStall } from "@repo/host/main-stall";
import type { SentryEnvironment } from "@repo/host/sentry-environment";
import { sendLineToSentry } from "@repo/host/sentry-line";
import * as Sentry from "@sentry/electron/main";
import { Data, Effect, Exit, type Layer, Option, Predicate, Scope, Stream, Tracer } from "effect";
import {
  type CpuSummary,
  sampleProcessCpu,
  sampleWindowMemory,
  type UnresponsiveEpisode,
  type WorkingSetCrossing,
} from "../window/renderer-health";
import type { DesktopConfig } from "./desktop-config";
import { mainLoopStalls, mainLoopTick, mainTicks, startMainLoopStalls } from "./main-loop-stalls";

/** How long the quit waits for a queued crash report to leave; a flush must not hold a quit. */
const CRASH_REPORT_FLUSH_MS = 2_000;

/** A span's status, made as Effect's tracer makes its own. */
const SpanStatus = Data.taggedEnum<Tracer.SpanStatus>();

declare const PACKAGED_SENTRY_DSN: string;

/** The stall watch's worker, as `build.mjs` bundles `src/utility/stall-watch.ts` to text. */
declare const STALL_WATCH_WORKER: string;

/**
 * `<name>@X.Y.Z`, the release `build.mjs` uploads this bundle's source maps
 * under, baked from that same string. Note that the SDK's own default is the
 * app's name, which is `<name> Dev` or `<name> Test` outside a Developer ID
 * build, so a report from one would name a release no map was uploaded to;
 * which build it was is the environment's to say instead.
 */
declare const PACKAGED_SENTRY_RELEASE: string;

/**
 * Whether this device shares usage data, as main's document last said;
 * undefined until the host has read the device's settings
 * (`followUsageDataInReports`).
 */
let usageData: boolean | undefined;

/**
 * Crash reporting, begun at the entry rather than inside `start`: Electron
 * spawns its GPU process during bootstrap, and the crash reporter has to
 * stand before a child process it is to file a minidump for. The one
 * ordering this owes is the paths' — the reporter writes its own state under
 * the app's `userData` — so the entry calls this immediately after moving them
 * and before anything else of the composition exists.
 *
 * Main reports on behalf of every renderer, so what leaves goes through the
 * same token filters as the preload's and the renderers' own.
 *
 * About one window in ten profiles while it is in use (`SENTRY_PROFILING`,
 * `renderer/desktop-sentry-sdk.ts`), so the spans it times and its
 * interactions carry the stack frames that ran under them: the SDK serves
 * every document with `Document-Policy: js-profiling`, which the browser's
 * profiler needs (`enableRendererProfiling`). Main itself is not profiled,
 * because Sentry ships its Node profiler's addon for Node's ABIs and not
 * Electron's; nor does it run Sentry's event loop block detection, whose
 * addon is built the same way, so main watches itself for stalls instead
 * (`watchMainStalls`).
 *
 * Nothing leaves while the device does not share usage data: main's offline
 * transport, which sends every window's envelopes and the crash reporter's
 * minidumps as well as main's own, asks the switch before each one
 * (`@repo/features/sentry-usage-data`). A report made before the settings
 * are read is kept on disk until they are, then sent or dropped.
 *
 * Main's stalls are heard from here on (`main-loop-stalls.ts`), and each of
 * main's requests says the longest one within it
 * (`SENTRY_LOOP_STALL_ATTRIBUTE`), so a request the service answered at once
 * but main read late reads as main's wait rather than the service's.
 */
export function initializeCrashReporting(runMode: RunMode, environment: SentryEnvironment): void {
  startMainLoopStalls();
  Sentry.init({
    dsn: PACKAGED_SENTRY_DSN,
    enabled: sentryReportingEnabled(runMode.sendsNetwork, PACKAGED_SENTRY_DSN),
    release: PACKAGED_SENTRY_RELEASE,
    environment,
    tracesSampler: sentryTracesSampler,
    enableRendererProfiling: true,
    integrations: [Sentry.startupTracingIntegration()],
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: Sentry.withStreamedSpan((span) =>
      spanWithoutAccessTokens(spanWithLoopStall(span, mainLoopStalls.worstWithin)),
    ),
    transportOptions: usageDataTransportOptions(() => usageData),
  });
}

/** What every line This Mac's host setup reports opens with (`compose-this-mac-host.ts`). */
const THIS_MAC_LINE = "this Mac's host";

/**
 * A line main reports, told to Sentry where it is about This Mac's host
 * setup, as `sendLineToSentry` sends it: our own words of it, a step tried
 * again as a warning until it persists. Note that only those lines leave,
 * so every other line main reports stays on stderr.
 */
export function reportThisMacToSentry(message: string, attributes?: ReportAttributes): void {
  if (!message.startsWith(THIS_MAC_LINE)) return;
  sendLineToSentry(Sentry, message, attributes);
}

/** Sentry's status code for a span that ended in error, as its SDK writes it. */
const SPAN_STATUS_ERROR = 2;

/** The span attributes main's tracer passes on, by their prefix; every other, a stack trace's among them, stays behind. */
const KEPT_ATTRIBUTE_PREFIXES = ["agent.", "mirror."] as const;

/** Whether main's tracer passes an attribute on, by its key's prefix. */
function isKeptKey(key: string): boolean {
  return KEPT_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Whether an attribute's value is one Sentry keeps: a string, a number, or a boolean. */
function isKeptValue(value: unknown): value is string | number | boolean {
  return Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value);
}

/** One of Effect's spans as one of main's Sentry spans. */
class MainSentrySpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly name: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly annotations: Tracer.Span["annotations"];
  readonly links: Tracer.SpanLink[];
  readonly kind: Tracer.SpanKind;
  readonly sampled: boolean;
  readonly attributes = new Map<string, unknown>();
  status: Tracer.SpanStatus;

  constructor(
    readonly sentry: Sentry.Span,
    options: Parameters<Tracer.Tracer["span"]>[0],
  ) {
    this.name = options.name;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = options.links;
    this.kind = options.kind;
    this.sampled = sentry.isRecording();
    this.status = SpanStatus.Started({ startTime: options.startTime });
  }

  get spanId(): string {
    return this.sentry.spanContext().spanId;
  }

  get traceId(): string {
    return this.sentry.spanContext().traceId;
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (Exit.isFailure(exit)) this.sentry.setStatus({ code: SPAN_STATUS_ERROR });
    this.sentry.end(Number(endTime / 1_000_000n));
    this.status = SpanStatus.Ended({ startTime: this.status.startTime, endTime, exit });
  }

  readonly attribute: Tracer.Span["attribute"] = (key, value) => {
    this.attributes.set(key, value);

    if (isKeptKey(key) && isKeptValue(value)) this.sentry.setAttribute(key, value);
  };

  event(): void {}

  addLinks(links: readonly Tracer.SpanLink[]): void {
    for (const link of links) this.links.push(link);
  }
}

/**
 * Effect's spans as main's Sentry spans, for what is handed it rather than
 * main's whole runtime: the cloud agents' mirrors (`@repo/host`'s
 * `MirrorPlatform`). A span with no parent of this tracer's starts a trace
 * of its own, which `sentryTracesSampler` keeps every time for a mirror's
 * roots. Note that only the attributes named `agent.*` and `mirror.*` are
 * passed on, so a stack trace Effect sets, or any attribute a span beneath
 * sets, never leaves.
 */
export const mainSentryTracer: Tracer.Tracer = Tracer.make({
  span: (options) => {
    const parent = Option.getOrUndefined(options.parent);

    const start = () =>
      Sentry.startInactiveSpan({
        name: options.name,
        startTime: Number(options.startTime / 1_000_000n),
        parentSpan: parent instanceof MainSentrySpan ? parent.sentry : null,
      });

    const sentry = parent instanceof MainSentrySpan ? start() : Sentry.startNewTrace(start);

    return new MainSentrySpan(sentry, options);
  },
});

/**
 * Main's Sentry, as a failed launch reports through it. What it captures
 * passes the `beforeSend` above, so the token filters hold on it too.
 */
export const mainSentry: SentryCapture = {
  captureException: Sentry.captureException,
  flush: Sentry.flush,
};

/**
 * Every Effect failure a boundary of main's runtime reports, captured
 * through main's Sentry: the composition provides it beneath every service
 * and the host, so their fibers and the acts' runs all report through it.
 */
export const mainErrorReporting: Layer.Layer<never> = sentryReporterLayer(mainSentry);

/**
 * Follows the device's "Share usage data" switch in main's document, for as
 * long as `scope` stands, so the transport asks the switch as it stands now:
 * turning it off stops every report from the next one, and turning it back
 * on resumes them, with no relaunch.
 */
export function followUsageDataInReports(
  state: AppStateStore,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    Effect.forkScoped(
      state.changes.pipe(
        Stream.runForEach((document) =>
          Effect.sync(() => {
            usageData = sharesUsageData(document);
          }),
        ),
      ),
    ),
  );
}

/**
 * One episode of a panel not answering, as one Sentry event: how long it
 * lasted, whether it answered again, and the page's working set as it
 * stopped, grouped as one issue whichever panel it was.
 */
export function reportUnresponsivePanel(episode: UnresponsiveEpisode): Effect.Effect<void> {
  return Effect.sync(() => {
    Sentry.captureEvent({
      level: "warning",
      message: "A panel window stopped responding",
      fingerprint: ["panel-unresponsive"],
      tags: {
        "window.document": episode.document,
        "unresponsive.recovered": episode.recovered,
      },
      contexts: {
        unresponsive: {
          duration_ms: episode.unresponsiveMs,
          working_set_bytes: episode.workingSetBytes ?? null,
          recovered: episode.recovered,
        },
      },
    });
  });
}

/** A window's working set crossing its bound, left as a breadcrumb for whatever is reported next. */
function noteWorkingSetCrossing(crossing: WorkingSetCrossing): void {
  Sentry.addBreadcrumb({
    category: "memory",
    level: "warning",
    message: "A window's working set crossed its bound",
    data: { document: crossing.document, working_set_bytes: crossing.workingSetBytes },
  });
}

/**
 * One kind of process's CPU over five minutes, as two of Sentry's metric
 * distributions, its mean and its highest sample, each a percentage of one
 * core: tagged with the kind, where the windows stood, how many agents
 * worked, and the build and machine it ran on, and nothing of the page.
 */
function reportCpuSummary(summary: CpuSummary, appVersion: string): void {
  const attributes = {
    "process.type": summary.process,
    "window.state": summary.windowState,
    "agents.working": summary.workingAgents,
    "app.version": appVersion,
    "os.arch": process.arch,
  };

  Sentry.metrics.distribution("desktop.cpu.mean", summary.meanPercent, {
    unit: "percent",
    attributes,
  });
  Sentry.metrics.distribution("desktop.cpu.max", summary.maxPercent, {
    unit: "percent",
    attributes,
  });
}

/**
 * One stall of main: counted every time as a Sentry metric distribution,
 * tagged as the CPU summaries are, and reported as a warning with the stack
 * it was caught in where the watch paused main for one, which it does at most
 * once a `MAIN_STALL.STACK_GAP_MS`, grouped by that stack. A stall caught in main's own tick names nothing that held main, so
 * it is counted and never reported; and the stall is counted here rather
 * than beside each span, which carries the longest within it already
 * (`main.loop_stall_ms`), so how often main stalls is read across every
 * machine.
 */
function reportMainStall(stall: MainStall, appVersion: string, workingAgents: number): void {
  Sentry.metrics.distribution("desktop.main.stall", stall.durationMs, {
    unit: "millisecond",
    attributes: {
      "agents.working": workingAgents,
      "app.version": appVersion,
      "os.arch": process.arch,
    },
  });

  const frames = stall.frames ?? [];

  if (frames.length === 0 || frames.some((frame) => frame.function === mainLoopTick.name)) return;

  Sentry.captureEvent({
    level: "warning",
    exception: {
      values: [
        {
          type: "MainProcessStall",
          value: "The main process stopped answering",
          stacktrace: { frames: [...frames] },
          mechanism: { type: "auto.electron.main.stall", handled: true, synthetic: true },
        },
      ],
    },
    contexts: { stall: { duration_ms: stall.durationMs } },
  });
}

/**
 * Watches main for stalls from a worker thread (`src/utility/stall-watch.ts`)
 * until `scope` closes: the worker waits on the count main's loop timer
 * ticks (`main-loop-stalls.ts`), so the watch adds no timer of its own to
 * main, and hands back each stall it caught, which `report` is given. The
 * thread keeps no quit waiting, and one that could not start leaves main
 * unwatched, never failing it.
 */
function watchMainStalls(
  report: (stall: MainStall) => void,
  scope: Scope.Scope,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    const worker = new Worker(STALL_WATCH_WORKER, {
      eval: true,
      workerData: { ticks: mainTicks.buffer, tickMs: LOOP_TICK_MS },
    });

    worker.unref();
    worker.on("message", report);
    worker.on("error", () => undefined);

    return Scope.addFinalizer(
      scope,
      Effect.promise(() => worker.terminate()),
    );
  });
}

export interface TelemetryService extends EffectDesktopService {
  /**
   * A counted event, whose name and every property value the allowlist in
   * `@repo/features/analytics` fixed. It travels to our own service through the
   * host, never to an analytics provider from here.
   */
  readonly recordProductEvent: RecordProductEvent;
  /** A feedback send, as the delivery answers it: the composer's act row runs this effect, never a promise this file built for itself. */
  deliverFeedback: (submission: FeedbackSubmission) => Effect.Effect<FeedbackResult>;
}

interface TelemetryServiceDependencies {
  config: DesktopConfig;
  /** The one way a counted event leaves this process: the host's own stream, through the operator. */
  recordEvent: RecordProductEvent;
  /** How many agents are working now, as the CPU summaries bucket them. */
  workingAgents: () => number;
}

/** Everything that leaves this process and is not the Gateway: the crash stream, the counted events, the feedback delivery, the windows' memory notes, the processes' CPU summaries, main's stalls. */
export function createTelemetryService(
  dependencies: TelemetryServiceDependencies,
): TelemetryService {
  const { config } = dependencies;
  const feedbackDelivery = feedbackDeliveryFromEnvironment();

  const recordProductEvent: RecordProductEvent = (name, properties) =>
    dependencies.recordEvent(name, properties);

  /** What the memory and CPU samplers run in, from the start; closing it at the stop interrupts them. */
  const sampling = Scope.makeUnsafe();

  return {
    name: "telemetry",
    recordProductEvent,
    deliverFeedback: (submission) => {
      if (!config.runMode.sendsNetwork) {
        return Effect.succeed({ delivered: false, reason: "A fixture run sends nothing." });
      }

      return Effect.tap(feedbackDelivery.deliver(submission), (result) =>
        result.delivered
          ? Effect.sync(() => {
              recordProductEvent(PRODUCT_EVENT.FEEDBACK_SEND, {
                image_count: productSessionCountBucket(submission.images.length),
              });
            })
          : Effect.void,
      );
    },
    // Every window's working set is read once a minute, and every process's
    // CPU time every few seconds, for the run's life, and main is watched for
    // stalls where it reports at all.
    start: () =>
      Effect.andThen(
        Effect.forkIn(sampleWindowMemory(noteWorkingSetCrossing), sampling),
        Effect.forkIn(
          sampleProcessCpu(dependencies.workingAgents, (summary) =>
            reportCpuSummary(summary, config.appVersion),
          ),
          sampling,
        ),
      ).pipe(
        Effect.andThen(
          config.runMode.sendsNetwork
            ? watchMainStalls(
                (stall) => reportMainStall(stall, config.appVersion, dependencies.workingAgents()),
                sampling,
              )
            : Effect.void,
        ),
        Effect.asVoid,
      ),
    // A report queued when the quit began would otherwise go with the
    // process; the flush is bounded so it cannot be what holds one open.
    // Note that it flushes rather than closes, because a launch that fails
    // after this service started runs this stop before the entry captures
    // the failure, and a closed client would drop that report; so would it
    // every defect a later stop of the same quit reports.
    stop: () =>
      Effect.andThen(
        Scope.close(sampling, Exit.void),
        Effect.asVoid(Effect.promise(() => Sentry.flush(CRASH_REPORT_FLUSH_MS))),
      ),
  };
}
