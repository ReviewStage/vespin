/**
 * desktop-sentry-sdk.ts -- the chunk `desktop-sentry.ts` loads once a window has drawn: Sentry's Electron renderer SDK, started as Sentry's Electron guide sets up a renderer.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk, and no window's entry carries any of it.
 */

import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import {
  interactionLongFrames,
  type LongFrame,
  type LongFrameAttributes,
  longFrameHistory,
} from "@repo/features/sentry-long-frames";
import {
  SENTRY_PROFILING,
  sentryTracesRequest,
  sentryTracesSampler,
} from "@repo/features/sentry-tracing";
import { sendShownFailure } from "@repo/features/shown-failure";
import { sentrySendTracer } from "@repo/panel/send-traces";
import {
  browserApiErrorsIntegration,
  browserProfilingIntegration,
  browserTracingIntegration,
  captureException,
  getActiveSpan,
  getClient,
  getCurrentScope,
  getGlobalScope,
  getTraceData,
  init,
  logger,
  spanToJSON,
  startInactiveSpan,
  startNewTrace,
  startSpan,
  uiProfiler,
  withStreamedSpan,
} from "@sentry/electron/renderer";
import { Predicate } from "effect";
import { BLANK_WINDOW, type BlankWindow, type DesktopSentry } from "./desktop-sentry";

/** The mechanism each blank window's report names, so Sentry's issue says which path caught it. */
const BLANK_WINDOW_MECHANISM = {
  [BLANK_WINDOW.FIRST_READ]: { type: "auto.electron.renderer.first_read", handled: false },
  [BLANK_WINDOW.RENDER]: { type: "auto.electron.renderer.render", handled: false },
} as const satisfies Record<BlankWindow, { readonly type: string; readonly handled: false }>;

/** The op every span the panel timed is listed under. */
const PANEL_SPAN_OP = "ui.panel";

/**
 * How long a span or an interaction waits to be summed, so the browser has
 * reported the frame it ended in: Chromium reports a long frame a little
 * after the task that follows it, so a summing at once missed that frame.
 */
const FRAME_REPORTED_MS = 50;

/**
 * The callbacks Sentry's browser SDK leaves as the panel registered them.
 * Note that it wraps every event listener and timer in a function of its own
 * by default, to catch what one throws, so a long frame named that wrapper
 * as the script that held it rather than the panel's own function; what a
 * callback throws reaches Sentry through the window's own error handler
 * without it, with its whole stack, since every script is the app's own.
 */
const UNWRAPPED_CALLBACKS = {
  eventTarget: false,
  requestAnimationFrame: false,
  setInterval: false,
  setTimeout: false,
} as const;

/** The op every interaction's span (INP) opens with: `ui.interaction.click`, `.press`, `.hover`, `.drag`. */
const INTERACTION_OP_PREFIX = "ui.interaction.";

/** The attribute a span's op is kept under, by Sentry's own name. */
const SENTRY_OP_ATTRIBUTE = "sentry.op";

/** The performance entry type of a long animation frame, as the browser names it. */
const LONG_ANIMATION_FRAME = "long-animation-frame";

/**
 * The interactions whose long frames are summed as they happen: those as
 * slow as the least INP the SDK reports, as Web Vitals observes them. Note
 * that TypeScript's DOM types do not yet name Event Timing's threshold, so
 * the shape says it.
 */
const SLOW_INTERACTIONS: PerformanceObserverInit & { readonly durationThreshold: number } = {
  type: "event",
  durationThreshold: 40,
  buffered: true,
};

/** How long a window goes without input before its profiler stops, in milliseconds. */
const PROFILE_IDLE_MS = 10_000;

/**
 * How long one profile runs while the window stays in use before a new one
 * starts, in milliseconds. Note that Sentry's browser profiler keeps 30 s of
 * samples (3,000 at 10 ms) but starts a new chunk only every 60 s, so a
 * window typed in for longer than 30 s at a stretch lost the stacks of
 * everything after; a new one starts well inside the 30 s instead.
 */
const PROFILE_ROTATE_MS = 25_000;

/** The input that says a window is in use. */
const IN_USE_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

/**
 * The thread a window's profile samples, as Sentry's browser profiler names
 * it on every span it starts under it, so Sentry finds the span's stacks in
 * the profile.
 */
const PROFILED_THREAD = { "thread.id": "0", "thread.name": "main" } as const;

/** What a span reads of the long frames it overlapped, from its start and end in the epoch's milliseconds. */
interface LongFrames {
  /** What a span that just ended overlapped. */
  readonly of: (startedAt: number, endedAt: number) => LongFrameAttributes;
  /** What the slow interaction a span names overlapped, as it happened; what is kept now where it was not kept then. */
  readonly ofInteraction: (startedAt: number, endedAt: number) => LongFrameAttributes;
  /** Runs `then` once the frame now drawing has been reported: at once where no frame is. */
  readonly afterReported: (then: () => void) => void;
}

/** Whether a performance entry is a long animation frame, which the DOM's types do not name yet. */
function isLongFrame(entry: PerformanceEntry): entry is PerformanceEntry & LongFrame {
  return entry.entryType === LONG_ANIMATION_FRAME && "scripts" in entry;
}

/** Whether a performance entry is an event a person did, as one an `event` observer hears may be. */
function isInteraction(entry: PerformanceEntry): entry is PerformanceEventTiming {
  return (
    "interactionId" in entry && Predicate.isNumber(entry.interactionId) && entry.interactionId > 0
  );
}

/**
 * The epoch's time the page's clock reads 0 at, by the wall's clock now.
 * Note that this is read now rather than taken from `performance.timeOrigin`,
 * because the page's clock stops while the Mac sleeps and the wall's does
 * not, so after a sleep the origin the page started with is off by the
 * sleep's length.
 */
function wallOrigin(): number {
  return Date.now() - performance.now();
}

/**
 * Keeps the long animation frames this window reports, from its start
 * (`buffered`), and sums each slow interaction's as it happens. Note that it
 * takes what the browser has queued and not yet handed over before it reads,
 * because a frame is reported a task after it ends, and the span that waited
 * on it often ends first; an interaction is summed a little after the
 * browser reports it for the same reason (`FRAME_REPORTED_MS`). A browser
 * that reports no long frame answers none.
 */
function observeLongFrames(): LongFrames {
  if (!PerformanceObserver.supportedEntryTypes.includes(LONG_ANIMATION_FRAME)) {
    return { of: () => ({}), ofInteraction: () => ({}), afterReported: (then) => then() };
  }

  const history = longFrameHistory();
  const interactions = interactionLongFrames(history);

  const frames = new PerformanceObserver((list) =>
    history.add(list.getEntries().filter(isLongFrame)),
  );

  const caughtUp = () => history.add(frames.takeRecords().filter(isLongFrame));

  const events = new PerformanceObserver((list) => {
    const origin = wallOrigin();
    const slow = list.getEntries().filter(isInteraction);

    if (slow.length === 0) return;

    setTimeout(() => {
      caughtUp();

      for (const { interactionId, startTime, duration } of slow) {
        interactions.note({ interactionId, startTime, duration, origin });
      }
    }, FRAME_REPORTED_MS);
  });

  frames.observe({ type: LONG_ANIMATION_FRAME, buffered: true });
  events.observe(SLOW_INTERACTIONS);

  const of = (startedAt: number, endedAt: number) => {
    caughtUp();

    const origin = wallOrigin();

    return history.attributesFor(startedAt - origin, endedAt - origin);
  };

  return {
    of,
    ofInteraction: (startedAt, endedAt) => interactions.of(startedAt) ?? of(startedAt, endedAt),
    afterReported: (then) => {
      setTimeout(then, FRAME_REPORTED_MS);
    },
  };
}

/** The profiler this window profiles under, once it has run; none where the window is not profiled. */
function profilerIdNow(): string | undefined {
  const profile = getGlobalScope().getScopeData().contexts.profile;
  const id = profile?.profiler_id;

  return Predicate.isString(id) ? id : undefined;
}

/**
 * Profiles the window from now, and from each input on, until it has gone
 * `PROFILE_IDLE_MS` with none, so a click or a key, and all it sets off, is
 * profiled and a window left open is not; answers the profiler's id once it
 * has run. Note that its listener runs before any of the panel's, in the
 * window's capture, so an interaction's own handlers are profiled, and that
 * it only notes the time, one timer standing at most however fast input
 * comes, which also starts a new profile every `PROFILE_ROTATE_MS`. A
 * window Sentry does not profile starts nothing.
 */
function profileWhileInUse(): () => string | undefined {
  let lastInput = 0;
  let startedAt = 0;
  let profiling = false;
  let profilerId: string | undefined;

  // Stops once the window has gone idle, and starts a new chunk before the profiler's buffer fills.
  const check = () => {
    const now = performance.now();

    if (now - lastInput >= PROFILE_IDLE_MS) {
      profiling = false;
      uiProfiler.stopProfiler();

      return;
    }

    if (now - startedAt >= PROFILE_ROTATE_MS) {
      uiProfiler.stopProfiler();
      uiProfiler.startProfiler();
      startedAt = now;
    }

    const untilIdle = PROFILE_IDLE_MS - (now - lastInput);
    const untilRotate = PROFILE_ROTATE_MS - (now - startedAt);

    setTimeout(check, Math.min(untilIdle, untilRotate));
  };

  const inUse = () => {
    lastInput = performance.now();

    if (profiling) return;

    profiling = true;
    startedAt = lastInput;
    uiProfiler.startProfiler();
    profilerId ??= profilerIdNow();
    setTimeout(check, PROFILE_IDLE_MS);
  };

  for (const type of IN_USE_EVENTS) {
    window.addEventListener(type, inUse, { capture: true, passive: true });
  }

  inUse();

  return () => profilerId;
}

/**
 * Sums onto each interaction's span (INP) as it ends the long frames it
 * overlapped, and names the profile it ran under, before the SDK sends it.
 * Note that browser tracing records a long frame only under the span active
 * as it is reported, which after the page load is none, so an interaction
 * carried none of its own; and that the span is made only once the window
 * hides, when its profiler has most often stopped, so the profiler that ran
 * as the interaction did is named here rather than read off the scope.
 */
function followInteractionsWithLongFrames(
  longFrames: LongFrames,
  profilerId: () => string | undefined,
): void {
  getClient()?.on("spanEnd", (span) => {
    const { attributes, start_timestamp, end_timestamp } = spanToJSON(span);
    const op = attributes[SENTRY_OP_ATTRIBUTE];

    if (!Predicate.isString(op) || !op.startsWith(INTERACTION_OP_PREFIX)) return;

    if (end_timestamp === undefined) return;

    span.setAttributes(longFrames.ofInteraction(start_timestamp * 1000, end_timestamp * 1000));

    const profiler = profilerId();

    if (profiler !== undefined) {
      span.setAttributes({ "sentry.profiler_id": profiler, ...PROFILED_THREAD });
    }
  });
}

/**
 * Starts the window's SDK with its default data collection and the
 * renderer's filters: a breadcrumb or an event that names an access token is
 * dropped whole, and so is a span that names one as it starts, while every
 * span sent has its addresses scrubbed (`@repo/features/sentry-breadcrumbs`).
 * The DSN, release, and environment are main's, which every renderer event
 * goes through, and its reports reach main as requests of their own, which
 * are never traced (`sentryTracesRequest`). So does the device's "Share usage
 * data" switch: main's transport sends nothing of the window's while it is
 * off (`main/services/telemetry-service.ts`).
 *
 * A failure the panel showed is sent as a Sentry log line, and as an issue
 * besides where nothing named it (`@repo/features/shown-failure`); the
 * window's logs reach Sentry through main, as its events do.
 *
 * No report names the account: neither main nor the window sets a user, so
 * an event or a log line leaves naming nobody (`PRIVACY.md`).
 *
 * Tracing keeps long animation frames, which name the script that held a
 * slow frame, and Interaction to Next Paint, which the SDK's web vitals
 * report by default. A page that hangs is main's to report, from Electron's
 * own word that it stopped answering (`main/window/renderer-health.ts`).
 * A send the developer presses is a span of its own, whose trace its act
 * carries to main, which sends it on to the service
 * (`@repo/panel/send-traces`), because main's own fetch tracing would carry
 * main's trace rather than the press's.
 *
 * A slow interaction's span (INP) and each span the panel timed carry the
 * long animation frames they overlapped, summed as their attributes
 * (`@repo/features/sentry-long-frames`): how long the frames blocked, how the
 * longest split between script and render, and the script that ran longest,
 * by its invoker, function name, and bundle path.
 *
 * The window profiles while it is in use (`profileWhileInUse`,
 * `SENTRY_PROFILING`): from its start and from each click, key, or scroll,
 * until it has gone ten seconds without one, so every span it times then,
 * and every interaction's, names the profile its stacks are in. Main's SDK
 * serves every document with the profiling policy the browser's profiler
 * needs (`enableRendererProfiling`). A profile is the panel's own stack
 * frames, function names and bundle paths, and none of a person's words.
 */
export function initDesktopSentry(): DesktopSentry {
  init({
    integrations: [
      browserTracingIntegration({
        shouldCreateSpanForRequest: sentryTracesRequest,
        enableLongAnimationFrame: true,
      }),
      browserProfilingIntegration(),
      browserApiErrorsIntegration(UNWRAPPED_CALLBACKS),
    ],
    tracesSampler: sentryTracesSampler,
    ...SENTRY_PROFILING,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: withStreamedSpan(spanWithoutAccessTokens),
  });

  const longFrames = observeLongFrames();
  followInteractionsWithLongFrames(longFrames, profileWhileInUse());

  return {
    reportBlankWindow: (error, why) => {
      captureException(error, { mechanism: BLANK_WINDOW_MECHANISM[why] });
    },
    // A trace of its own rather than a child of whatever is active, so each
    // is sampled at the window's rate on its own, whatever page load or
    // navigation stands; its attributes are read only where it is kept. Its
    // times go as dates, so the SDK never has to guess a number's unit. It
    // is recorded once the frame it ended in has been reported, since a span
    // often ends in the frame that drew what it waited on.
    recordSpan: (span) => {
      longFrames.afterReported(() => {
        startNewTrace(() => {
          const recorded = startInactiveSpan({
            name: span.name,
            op: PANEL_SPAN_OP,
            startTime: new Date(span.startedAt),
            parentSpan: null,
          });

          if (recorded.isRecording()) {
            recorded.setAttributes({
              ...span.attributes(),
              ...longFrames.of(span.startedAt, span.endedAt),
            });
          }

          recorded.end(new Date(span.endedAt));
        });
      });
    },
    // A send pressed, a span of its own whose trace its act carries to main and on to the service.
    traceSend: sentrySendTracer({ startNewTrace, startSpan, getTraceData }),
    // A log line through main, which sends what the window logs, and an issue where nothing named it.
    reportShownFailure: (report) =>
      sendShownFailure({ captureException, logger, getActiveSpan, getCurrentScope }, report),
  };
}
