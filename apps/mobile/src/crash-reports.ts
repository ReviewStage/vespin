/**
 * crash-reports.ts -- the app's crash and error reports: Sentry's React Native SDK, started as the bundle loads, on the desktop's and the web's terms.
 *
 * The app reports to the project the desktop does, under the same DSN
 * (`SENTRY_DSN`), which `app.config.ts` writes into the build's `extra` as
 * the desktop's build writes it into its bundle; a build without one, a
 * local or simulator build among them, sends nothing, and neither does a
 * fixture run, as the desktop's does not (`sentryReportingEnabled`), nor a
 * device that turned Settings › Account › Share usage data off: the SDK
 * starts only where the device shares usage data, as last kept
 * (`crash-reports-module.ts`), and closes, its native half with it, the
 * moment the switch reads off, starting again when it reads on
 * (`useCrashReports`). The SDK
 * runs with its default data collection and the desktop renderer's filters:
 * a breadcrumb or an event that names an access token is dropped whole
 * (`@repo/features/sentry-breadcrumbs`), and no event names the account,
 * since the app sets no user (`PRIVACY.md`).
 *
 * It traces a launch, and after it every screen change and tap, never a
 * request. A launch is Sentry's app start, from the process's start through
 * its native steps and the bundle's run, held open to the launch's first
 * Inbox rows, with the launch's own phases inside it (`launch-phases.ts`)
 * and a processor profile of the app's functions while it stands. A screen
 * change is a span named by its screen's route as its file is named
 * (`agent/[id]`), with its time to the screen's first frame inside it, and
 * a tap is a span named by the screen it landed on, held to the first frame
 * after it; neither is profiled (`traceScreens`). Note that screens and taps
 * are traced only once the launch's trace has ended, because the profiler
 * stops its profile as any other trace starts, and the first screen's would
 * cut the launch's short. Each carries only durations, the screens' routes,
 * the touched components' names, and the names of the app's own functions,
 * never a value they handled, an id, or the words on screen
 * (`@repo/features/sentry-screens`),
 * and no span is made for a request, so no address is traced, and no trace
 * header goes out on one.
 *
 * The native half starts first, as the app launches and before React Native
 * loads, on the same DSN, environment, release and build number, which
 * `app.config.ts` hands it (`SENTRY_LAUNCH_OPTIONS`), so a crash before this
 * bundle runs is reported too, where the device shares usage data
 * (`modules/crash-reports/`); `init` below starts it again on these options.
 * Native crashes are caught by the SDK's native half and sent on the next
 * launch, where the JavaScript filters cannot reach them, so the native half
 * records no breadcrumb of its own for a request (`enableNetworkBreadcrumbs`):
 * a request's URL reaches a report only as the JavaScript `fetch` breadcrumb,
 * through the filter above.
 *
 * Every event names the build's release and build number, the names
 * `release-ios.yml` uploads the build's Hermes source maps and dSYMs under
 * (`<bundle id>@<version>+<build>`, as sentry-cli reads them from the app's
 * Info.plist), so its stack traces arrive symbolicated.
 */

import { RENEWAL_REFUSED } from "@repo/credentials";
import type { AccountProvider } from "@repo/credentials/snapshot";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { eventWithoutAccessTokens, withoutAccessTokens } from "@repo/features/sentry-breadcrumbs";
import { sentryReporterLayer } from "@repo/features/sentry-reporting";
import { tapWithoutWords, transactionWithoutRouteKeys } from "@repo/features/sentry-screens";
import type { SignInFailure } from "@repo/features/words";
import { sentryReportingEnabled } from "@repo/host";
import { selectAppSettingsView } from "@repo/host/app-state-reads";
import { SENTRY_ENVIRONMENT, type SentryEnvironment } from "@repo/host/sentry-environment";
import {
  addBreadcrumb,
  addIntegration,
  captureException,
  close,
  expoRouterIntegration,
  extendAppStart,
  finishExtendedAppStart,
  getClient,
  getExtendedAppStartSpan,
  init,
  nativeCrash,
  type ReactNativeClient,
  reactNativeTracingIntegration,
  type Span,
  setTag,
  spanToJSON,
  startInactiveSpan,
  withTouchEventBoundary,
} from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { type Layer, Option, Schema } from "effect";
import Constants from "expo-constants";
import { type ComponentType, useEffect } from "react";
import { AppState } from "react-native";
import { crashReportsModule } from "./crash-reports-module.js";
import { appStateQuery } from "./host/app-state-query.js";
import {
  LAUNCH_SENTRY_TEST,
  launchFixtureProfile,
  launchSentryTest,
} from "./host/launch-arguments.js";
import { LAUNCH_PHASE, launchPhaseMs, launchStartedAt, launchStood } from "./launch-phases.js";

/** What `app.config.ts` writes into `extra.sentry`: the project's DSN, empty where the build names none, and whether this is a TestFlight build. */
const SentryBuildSchema = Schema.Struct({ dsn: Schema.String, released: Schema.Boolean });

type SentryBuild = typeof SentryBuildSchema.Type;

/** What a build whose config says nothing of Sentry reports under: nothing. */
const NO_SENTRY_BUILD: SentryBuild = { dsn: "", released: false };

/** The tag every event carries its build number in, beside the release that names it too. */
const BUILD_NUMBER_TAG = "build_number";

/** The mechanism each event names, so Sentry's issue says which path caught it. */
const MECHANISM = {
  /** A screen whose drawing threw, caught by its route's `ErrorBoundary`. */
  SCREEN: { type: "auto.expo_router.error_boundary", handled: false },
  /** A host that could not stand, so the app drew Try again in every screen's place. */
  HOST: { type: "auto.ios.host_start", handled: false },
  /** A sign-in from the sign-in screen that ended without an account. */
  SIGN_IN: { type: "auto.ios.sign_in", handled: true },
  /** A renewal the service refused, which signs the account out. */
  RENEWAL: { type: "auto.ios.renewal", handled: true },
} as const;

/** How a sign-in that ended without an account ended: its sheet closed, or a failure the screen says in words. */
export const SIGN_IN_END = { CLOSED: "closed" } as const;

type SignInEnd = (typeof SIGN_IN_END)[keyof typeof SIGN_IN_END] | SignInFailure;

/**
 * The SDK's tracing, which records screen changes and taps and never a
 * request: neither `fetch` nor XHR becomes a span, so no address is traced
 * and no request carries a trace header, beside `tracePropagationTargets`,
 * which the native half reads too. Note that the one integration stands for
 * the whole launch, across every start of the SDK, because the screens'
 * tracing keeps the current screen on it, which a tap's span is named by.
 */
const tracing = reactNativeTracingIntegration({ traceFetch: false, traceXHR: false });

/** The SDK's integrations this file stands in for: the tracing above, and the screens' (`traceScreens`), added once the launch's trace has ended. */
const REPLACED_INTEGRATION = { TRACING: "ReactNativeTracing", SCREENS: "ExpoRouter" } as const;

/**
 * The SDK's integration left out: the root's registration (`AppRegistry`).
 * Note that the app start resets itself as the root registers once it is
 * extended (`extendAppStart`, before `expo-router/entry` runs), which would
 * drop the launch's extension, and with it the launch's trace and the
 * screens' tracing that waits on its end. It only starts a screen's span
 * again as an Android activity restarts, which iOS never does.
 */
const UNREGISTERED = "AppRegistry";

/** The operation the SDK names a tap's span by. */
const TAP_OP = "ui.action.touch";

/** The span inside a tap's, from the tap to the first frame after it, which also keeps the tap's span from being dropped as empty. */
const TAP_FRAME = { op: "ui.action.touch.frame", name: "First frame after the tap" } as const;

/** The operation a launch phase's span names, inside the app start's extension. */
const LAUNCH_PHASE_OP = "app.start.phase";

/** The span that ends as the launch's Inbox first shows its rows, which the app start's extension is trimmed to. */
const LAUNCH_READY = "ready";

/** The span that ends as the host stands (`launchStood`). */
const LAUNCH_STOOD = "stood";

/** The span that ends as the app first comes active (`launchActiveAt`), which a system alert over a launch holds back. */
const LAUNCH_ACTIVE = "active";

/** What the test report says, so it is found in Sentry by its words. */
const TEST_REPORT_WORDS = `A test report from ${PRODUCT_NAME}'s iOS app (-sentryTest js)`;

const decodeSentryBuild = Schema.decodeUnknownOption(SentryBuildSchema);

/** The environment a build's reports are filed under: a Debug build's, a TestFlight build's, or any other Release build's, a local or simulator one. */
function environmentOf(build: SentryBuild): SentryEnvironment {
  if (__DEV__) return SENTRY_ENVIRONMENT.DEVELOPMENT;

  return build.released ? SENTRY_ENVIRONMENT.PRODUCTION : SENTRY_ENVIRONMENT.TEST;
}

function sentryBuild(): SentryBuild {
  return Option.getOrElse(
    decodeSentryBuild(Constants.expoConfig?.extra?.sentry),
    () => NO_SENTRY_BUILD,
  );
}

/**
 * Whether this build and launch report at all: a build that names a DSN, on
 * a launch that is no fixture run. Read once, as the bundle loads.
 */
const reportable = sentryReportingEnabled(launchFixtureProfile() === undefined, sentryBuild().dsn);

/** Whether the SDK stands now: reportable, and on this device's choice to share usage data. */
let standing = reportable && crashReportsModule.sharesUsageData();

/** The options the SDK starts on, enabled or not, and profiling the launch where it starts with one. */
function sentryOptions(enabled: boolean, launch: boolean): Parameters<typeof init>[0] {
  const build = sentryBuild();
  const version = Constants.expoConfig?.version;
  const buildNumber = Constants.expoConfig?.ios?.buildNumber;
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;

  return {
    dsn: build.dsn,
    enabled,
    environment: environmentOf(build),
    ...(version && buildNumber && bundleId
      ? { release: `${bundleId}@${version}+${buildNumber}`, dist: buildNumber }
      : undefined),
    enableNetworkBreadcrumbs: false,
    beforeBreadcrumb: (breadcrumb) => {
      const kept = withoutAccessTokens(breadcrumb);

      return kept && tapWithoutWords(kept);
    },
    beforeSend: eventWithoutAccessTokens,
    beforeSendTransaction: transactionWithoutRouteKeys,
    // Note that every launch, screen change and tap is traced, and no request: the SDK's request tracing is off (`tracing`), and no request carries a trace header.
    tracesSampleRate: 1,
    ...(launch ? { profilesSampleRate: 1 } : undefined),
    enableUserInteractionTracing: true,
    integrations: (defaults) => [
      ...defaults.flatMap((integration) => {
        if (integration.name === REPLACED_INTEGRATION.TRACING) return [tracing];

        return integration.name === REPLACED_INTEGRATION.SCREENS ||
          integration.name === UNREGISTERED
          ? []
          : [integration];
      }),
      { name: "TapNames", setup: (client) => client.on("spanStart", nameTap) },
    ],
    tracePropagationTargets: [],
    _experiments: { enableStandaloneAppStartTracing: true },
  };
}

/**
 * Names a tap's span by the screen it landed on, as the screens' tracing
 * last named it, rather than the touched element's label, which may be the
 * words it shows, and holds it open to the first frame after the tap. Note
 * that a tap on no screen yet, before the launch's trace has ended, is no
 * span, since the SDK starts one only on a screen it knows, and neither is
 * a tap on an element with no label or words, since the SDK names its span
 * by them before this renames it.
 */
function nameTap(span: Span): void {
  if (spanToJSON(span).op !== TAP_OP) return;
  const screen = tracing.state.currentRoute;

  if (screen !== undefined) span.updateName(`Tap on ${screen}`);
  const frame = startInactiveSpan({ ...TAP_FRAME, parentSpan: span });

  requestAnimationFrame(() => frame.end());
}

/** Whether this launch traces its screens already, which it starts once and keeps across every start of the SDK (`tracing`). */
let screensTraced = false;

/**
 * Traces each screen change from now on, through Expo Router's navigation,
 * with the time to each screen's first frame, once a launch, and profiles
 * no trace after the launch's. Note that the profiler reads its rate as
 * each trace starts, and that stopping a profile runs on the JavaScript
 * thread as the next trace starts, so profiling every tap would hold each
 * tap behind the last one's profile.
 */
function traceScreens(): void {
  const options = getClient<ReactNativeClient>()?.getOptions();

  if (options) options.profilesSampleRate = 0;

  if (screensTraced) return;
  screensTraced = true;
  // Note that a screen already seen, as Back returns to it, is traced too, since with no request traced it would hold no span the SDK counts and be dropped.
  addIntegration(
    expoRouterIntegration({
      enableTimeToInitialDisplay: true,
      ignoreEmptyBackNavigationTransactions: false,
    }),
  );
}

/** Traces the screens once the launch's trace has ended, by its rows or by the SDK's deadline, or at once where none stands. */
function traceScreensAfterLaunch(): void {
  const extension = getExtendedAppStartSpan();

  if (!extension.isRecording()) {
    traceScreens();

    return;
  }

  const unsubscribe = getClient()?.on("spanEnd", (ended) => {
    if (ended !== extension) return;
    unsubscribe?.();
    traceScreens();
  });
}

/**
 * Starts the SDK once, as the bundle loads, before the screens or the
 * background push task can throw, enabled where it stands. A test report is
 * sent at once where the launch asks for one (`-sentryTest`), so a
 * TestFlight build can be checked end to end: `js` sends a handled error,
 * whose stack reads through the uploaded source maps, and `native` crashes
 * the app, whose report is sent on the next launch and reads through the
 * uploaded dSYMs.
 */
function startCrashReports(): void {
  const buildNumber = Constants.expoConfig?.ios?.buildNumber;

  init(sentryOptions(standing, true));

  if (buildNumber !== undefined) setTag(BUILD_NUMBER_TAG, buildNumber);

  // Note that a launch in front holds Sentry's app start open until its Inbox shows (`finishLaunchTrace`); one woken in the background isn't held, since nobody waits through it.
  if (standing && AppState.currentState !== "background") extendAppStart();

  if (standing) traceScreensAfterLaunch();
  const test = launchSentryTest();

  if (test === LAUNCH_SENTRY_TEST.JS) captureException(new Error(TEST_REPORT_WORDS));

  if (test === LAUNCH_SENTRY_TEST.NATIVE) nativeCrash();
}

/**
 * Holds the SDK to this device's choice to share usage data, as the host
 * reads it: kept for the next launch's native start, and the SDK closed, its
 * native half with it, where it reads off, or started again where it reads
 * on after a close. Note that a close drops what the SDK holds unsent, such
 * as this launch's trace, since nothing goes out once the choice is off.
 */
function shareCrashReports(shares: boolean): void {
  crashReportsModule.keepSharesUsageData(shares);

  if (!reportable || shares === standing) return;
  standing = shares;

  if (shares) {
    init(sentryOptions(true, false));
    traceScreens();
  } else void close();
}

/** Holds the SDK to Settings › Account › Share usage data as the host reads it (`shareCrashReports`). */
export function useCrashReports(): void {
  const { data: shares } = useQuery({
    ...appStateQuery,
    select: (state) => selectAppSettingsView(state)?.usageData,
  });

  useEffect(() => {
    if (shares !== undefined) shareCrashReports(shares);
  }, [shares]);
}

/**
 * Ends the trace of a launch that waited in front, as its Inbox first shows
 * rows `readyMs` after the launch's start: each phase the launch reached is a
 * span from its start to the phase (`launch-phases.ts`), and the app start's
 * extension ends with the rows, so Sentry's app start runs from the process's
 * start to them, beside the native steps it measures itself. Where the app
 * came active only after the rows, as behind a system alert, the extension
 * ends as it counts, and `activeMs` is a span of its own, so the wait shows
 * as the alert's. Note that a launch that went to the background first is
 * never ended here, so its time away is never counted: the extension's own
 * deadline ends it, with no measurement. Nothing happens where no extension
 * stands.
 */
export function finishLaunchTrace(readyMs: number, activeMs: number | undefined): void {
  const startedAt = launchStartedAt();
  const extension = getExtendedAppStartSpan();

  if (startedAt !== undefined) {
    const spans = [
      ...Object.values(LAUNCH_PHASE).map((phase) => ({ name: phase, ms: launchPhaseMs(phase) })),
      { name: LAUNCH_STOOD, ms: launchStood()?.ms },
      { name: LAUNCH_READY, ms: readyMs },
      { name: LAUNCH_ACTIVE, ms: activeMs },
    ];

    for (const { name, ms } of spans) {
      if (ms === undefined) continue;
      startInactiveSpan({
        parentSpan: extension,
        op: LAUNCH_PHASE_OP,
        name,
        startTime: startedAt / 1000,
      }).end((startedAt + ms) / 1000);
    }
  }

  finishExtendedAppStart().catch((cause: unknown) => {
    console.error("The launch's trace could not end.", cause);
  });
}

/** The app's root with every tap on it recorded: a breadcrumb naming the touched components, and a span where it lands on a screen (`nameTap`). */
export function withTapTraces(Root: ComponentType): ComponentType {
  return withTouchEventBoundary(Root);
}

/** Reports a screen whose drawing threw, once for each throw its boundary caught. */
export function useScreenFailureReport(error: Error): void {
  useEffect(() => {
    captureException(error, { mechanism: MECHANISM.SCREEN });
  }, [error]);
}

/** Reports a host that could not stand, so the app drew Try again in every screen's place. */
export function reportHostFailure(cause: unknown): void {
  captureException(cause, { mechanism: MECHANISM.HOST });
}

/**
 * Keeps one of the host's own lines on the trail the next report carries, as
 * a breadcrumb, so a report says what the host said before it: why a
 * sign-in did not finish, in the host's words and the service's refusal.
 * The line a refused renewal writes is reported as an event besides.
 * Note that the trail's filter drops a line that names an access token.
 */
export function keepHostLine(message: string): void {
  addBreadcrumb({ category: "host", level: "warning", message });

  // Note that a refused renewal signs the phone out with nothing on screen to say why, so it is an event of its own, naming whether the app stood in the foreground.
  if (message === RENEWAL_REFUSED) {
    captureException(new Error(message), {
      mechanism: MECHANISM.RENEWAL,
      captureContext: {
        level: "error",
        fingerprint: ["ios.renewal_refused"],
        tags: { app_state: AppState.currentState },
      },
    });
  }
}

/**
 * Reports a sign-in from the sign-in screen that ended without an account:
 * its sheet closed, or a failure the screen says, by the end's kind and the
 * provider, each its own issue, with the host's lines before it on its trail
 * and, where the act was refused, the refusal's stack. Note that a phone
 * signed out sends no counted event, since those go out under the account,
 * so this report is the only word of a sign-in that never lands.
 */
export function reportSignInEnd(provider: AccountProvider, end: SignInEnd, refusal?: Error): void {
  const error = refusal ?? new Error(`A sign-in ended without an account: ${end}`);

  captureException(error, {
    mechanism: MECHANISM.SIGN_IN,
    captureContext: {
      level: end === SIGN_IN_END.CLOSED ? "info" : "error",
      fingerprint: ["ios.sign_in", end],
      tags: { sign_in_end: end, sign_in_provider: provider },
    },
  });
}

/** Effect's reporters with Sentry's beside them, for the host's runtime to stand on, so a failure one of its boundaries reports is an event. */
export const crashReportsErrorReporting: Layer.Layer<never> = sentryReporterLayer({
  captureException,
});

startCrashReports();
