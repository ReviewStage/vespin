/**
 * crash-reports.ts -- the app's crash and error reports: Sentry's React Native SDK, started as the bundle loads, on the desktop's and the web's terms.
 *
 * The app reports to the project the desktop does, under the same DSN
 * (`SENTRY_DSN`), which `app.config.ts` writes into the build's `extra` as
 * the desktop's build writes it into its bundle; a build without one, a
 * local or simulator build among them, sends nothing, and neither does a
 * fixture run, as the desktop's does not (`sentryReportingEnabled`). The SDK
 * runs with its default data collection and the desktop renderer's filters:
 * a breadcrumb or an event that names an access token is dropped whole
 * (`@repo/features/sentry-breadcrumbs`), and each event names the account
 * signed in by its id alone (`@repo/features/sentry-account`). It traces
 * nothing, so no request becomes a span.
 *
 * The native half starts first, as the app launches and before React Native
 * loads, on the same DSN, environment, release and build number, which
 * `app.config.ts` hands it (`SENTRY_LAUNCH_OPTIONS`), so a crash before this
 * bundle runs is reported too; `init` below starts it again on these options.
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

import { signedInAccountId } from "@repo/credentials/snapshot";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { sentryUser } from "@repo/features/sentry-account";
import { eventWithoutAccessTokens, withoutAccessTokens } from "@repo/features/sentry-breadcrumbs";
import { sentryReporterLayer } from "@repo/features/sentry-reporting";
import { sentryReportingEnabled } from "@repo/host";
import { SENTRY_ENVIRONMENT, type SentryEnvironment } from "@repo/host/sentry-environment";
import { captureException, init, nativeCrash, setTag, setUser } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { type Layer, Option, Schema } from "effect";
import Constants from "expo-constants";
import { useEffect } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import {
  LAUNCH_SENTRY_TEST,
  launchFixtureProfile,
  launchSentryTest,
} from "./host/launch-arguments.js";

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
  /** A host that could not stand, so the app drew Retry in every screen's place. */
  HOST: { type: "auto.ios.host_start", handled: false },
} as const;

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
 * Starts the SDK once, as the bundle loads, before the screens or the
 * background push task can throw. A test report is sent at once where the
 * launch asks for one (`-sentryTest`), so a TestFlight build can be checked
 * end to end: `js` sends a handled error, whose stack reads through the
 * uploaded source maps, and `native` crashes the app, whose report is sent
 * on the next launch and reads through the uploaded dSYMs.
 */
function startCrashReports(): void {
  const build = sentryBuild();
  const version = Constants.expoConfig?.version;
  const buildNumber = Constants.expoConfig?.ios?.buildNumber;
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  init({
    dsn: build.dsn,
    enabled: sentryReportingEnabled(launchFixtureProfile() === undefined, build.dsn),
    environment: environmentOf(build),
    ...(version && buildNumber && bundleId
      ? { release: `${bundleId}@${version}+${buildNumber}`, dist: buildNumber }
      : undefined),
    enableNetworkBreadcrumbs: false,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
  });

  if (buildNumber !== undefined) setTag(BUILD_NUMBER_TAG, buildNumber);
  const test = launchSentryTest();

  if (test === LAUNCH_SENTRY_TEST.JS) captureException(new Error(TEST_REPORT_WORDS));

  if (test === LAUNCH_SENTRY_TEST.NATIVE) nativeCrash();
}

/**
 * Names the account signed in as Sentry's user, by its id alone, for as long
 * as it is, on the native half's scope too, so a native crash names it.
 */
export function useCrashReportAccount(): void {
  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  useEffect(() => setUser(sentryUser(accountId)), [accountId]);
}

/** Reports a screen whose drawing threw, once for each throw its boundary caught. */
export function useScreenFailureReport(error: Error): void {
  useEffect(() => {
    captureException(error, { mechanism: MECHANISM.SCREEN });
  }, [error]);
}

/** Reports a host that could not stand, so the app drew Retry in every screen's place. */
export function reportHostFailure(cause: unknown): void {
  captureException(cause, { mechanism: MECHANISM.HOST });
}

/** Effect's reporters with Sentry's beside them, for the host's runtime to stand on, so a failure one of its boundaries reports is an event. */
export const crashReportsErrorReporting: Layer.Layer<never> = sentryReporterLayer({
  captureException,
});

startCrashReports();
