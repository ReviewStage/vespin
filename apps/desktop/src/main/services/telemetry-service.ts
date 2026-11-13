import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  PRODUCT_EVENT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@repo/features/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@repo/features/feedback";
import { feedbackDeliveryFromEnvironment } from "@repo/features/feedback";
import { sentryUser } from "@repo/features/sentry-account";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { type SentryCapture, sentryReporterLayer } from "@repo/features/sentry-reporting";
import { sentryTracesSampler } from "@repo/features/sentry-tracing";
import { type RunMode, sentryReportingEnabled } from "@repo/host";
import type { AppStateStore } from "@repo/host/client";
import type { EffectDesktopService } from "@repo/host/desktop-service";
import type { ReportAttributes } from "@repo/host/effect";
import type { SentryEnvironment } from "@repo/host/sentry-environment";
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

/** How long the quit waits for a queued crash report to leave; a flush must not hold a quit. */
const CRASH_REPORT_FLUSH_MS = 2_000;

/** A span's status, made as Effect's tracer makes its own. */
const SpanStatus = Data.taggedEnum<Tracer.SpanStatus>();

declare const PACKAGED_SENTRY_DSN: string;

/**
 * `<name>@X.Y.Z`, the release `build.mjs` uploads this bundle's source maps
 * under, baked from that same string. Note that the SDK's own default is the
 * app's name, which is `<name> Dev` or `<name> Test` outside a Developer ID
 * build, so a report from one would name a release no map was uploaded to;
 * which build it was is the environment's to say instead.
 */
declare const PACKAGED_SENTRY_RELEASE: string;

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
 * Every window profiles while a kept trace's root span is open
 * (`SENTRY_PROFILING`), so a send and a page load carry the stack frames that
 * ran under them: main serves every document with
 * `Document-Policy: js-profiling`, which the browser's profiler needs
 * (`renderer/desktop-sentry-sdk.ts`). Main itself is not profiled, because
 * Sentry ships its Node profiler's addon for Node's ABIs and not Electron's.
 */
export function initializeCrashReporting(runMode: RunMode, environment: SentryEnvironment): void {
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
    beforeSendSpan: Sentry.withStreamedSpan(spanWithoutAccessTokens),
  });
}

/** What every line This Mac's host setup reports opens with (`compose-this-mac-host.ts`). */
const THIS_MAC_LINE = "this Mac's host";

/** Whether a reported line says something failed, which Sentry is told as an error rather than a log line. */
const FAILING = /could not|couldn't|failed|refused/i;

/**
 * A line main reports, told to Sentry where it is about This Mac's host
 * setup, up to what its step said of itself: as an error where it says
 * something failed, as a log line otherwise, with why beside it as the
 * event's extra data or the log's attributes, so one kind of failure stays
 * one issue whatever its reason. Note that only those lines leave, and only
 * our own words of them, so a command's output and every other line main
 * reports stay on stderr.
 */
export function reportThisMacToSentry(message: string, attributes?: ReportAttributes): void {
  if (!message.startsWith(THIS_MAC_LINE)) return;
  const ours = ownWords(message);

  if (FAILING.test(ours)) Sentry.captureMessage(ours, { level: "error", extra: { ...attributes } });
  else Sentry.logger.info(ours, { ...attributes });
}

/** A reported line up to what a step said of itself, so a command's output after it stays on stderr: `this Mac's host: could not install it` of `…: <stderr>`. */
function ownWords(message: string): string {
  return message.split(": ").slice(0, 2).join(": ");
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
 * Names the signed-in account as Sentry's user, by its id alone, for as long
 * as `scope` stands: set as one signs in, changed as another does, and
 * cleared as they sign out, from main's own document. Every report main
 * sends takes it: its own, a window's or the preload's event as it passes
 * through, and a native crash's. A window's log line is not among them, and
 * names the account as it leaves the window (`@repo/features/sentry-account`).
 */
export function followAccountInReports(
  state: AppStateStore,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    Effect.forkScoped(
      state.changes.pipe(
        Stream.map((document) => signedInAccountId(document.account)),
        Stream.changes,
        Stream.runForEach((accountId) => Effect.sync(() => Sentry.setUser(sentryUser(accountId)))),
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

/** Everything that leaves this process and is not the Gateway: the crash stream, the counted events, the feedback delivery, the windows' memory notes, the processes' CPU summaries. */
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
    // CPU time every few seconds, for the run's life.
    start: () =>
      Effect.andThen(
        Effect.forkIn(sampleWindowMemory(noteWorkingSetCrossing), sampling),
        Effect.forkIn(
          sampleProcessCpu(dependencies.workingAgents, (summary) =>
            reportCpuSummary(summary, config.appVersion),
          ),
          sampling,
        ),
      ).pipe(Effect.asVoid),
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
