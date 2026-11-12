/**
 * launch-arguments.ts -- the launch arguments a flow runs the app under: `-fixture <profile>`, which stands the app's host on the desktop's synthetic data, as the desktop's `--fixture` does, `-authServer stub`, which signs in against an account service the app answers itself, `-agent <id>`, which opens on that agent's page, `-pullRequest <number>` beside it, which opens on that pull request of the agent's, `-liveActivity true`, which starts a fixture run's Live Activity, `-updateNeeded true`, which stands a fixture run as the service's refusal of an old build leaves it, `-refuseWrites true`, which has a fixture run refuse the writes a flow presses, and `-sentryTest <js|native>`, which sends a test crash report.
 *
 * iOS registers a launch argument of the form `-key value` in the app's
 * `NSUserDefaults` argument domain, which React Native's `Settings` reads,
 * so a Maestro flow's `launchApp` arguments and `xcrun simctl launch
 * <device> <bundle> -fixture inbox` both arrive here. A run without the
 * argument, or naming a word that is no profile, leaves the host live, and
 * one without `-authServer stub` signs in against the real service.
 */

import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { Platform, Settings } from "react-native";

/** The launch arguments the app reads: the fixture's profile, as `-fixture <profile>`, and the account service a flow signs in against, as `-authServer stub`. */
const LAUNCH_ARGUMENT = {
  FIXTURE: "fixture",
  AUTH_SERVER: "authServer",
  AGENT: "agent",
  PULL_REQUEST: "pullRequest",
  LIVE_ACTIVITY: "liveActivity",
  UPDATE_NEEDED: "updateNeeded",
  REFUSE_WRITES: "refuseWrites",
  SENTRY_TEST: "sentryTest",
} as const;

/** The test reports `-sentryTest` may ask for: a handled JavaScript error, or a native crash. */
export const LAUNCH_SENTRY_TEST = {
  JS: "js",
  NATIVE: "native",
} as const;

export type LaunchSentryTest = (typeof LAUNCH_SENTRY_TEST)[keyof typeof LAUNCH_SENTRY_TEST];

/** The one account service a launch argument may name in place of the real one. */
const STUB_AUTH_SERVER = "stub";

/** The profile this launch's arguments name, read from the defaults iOS registered them in; none on any other platform, and none for a word that is no profile. */
export function launchFixtureProfile(): RunProfile | undefined {
  if (Platform.OS !== "ios") return undefined;
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.FIXTURE);

  return Object.values(RUN_PROFILE).find((profile) => profile === named);
}

/** Whether this launch signs in against the stubbed account service (`stub-auth-server.ts`) rather than the real one; never on any other platform. */
export function launchStubsAuthServer(): boolean {
  if (Platform.OS !== "ios") return false;

  return Settings.get(LAUNCH_ARGUMENT.AUTH_SERVER) === STUB_AUTH_SERVER;
}

/** The agent this launch opens on, as `-agent <id>` names it, as a flow reaches an agent's page; none on any other platform, and where none is named. */
export function launchAgent(): string | undefined {
  if (Platform.OS !== "ios") return undefined;
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.AGENT);

  return typeof named === "string" && named !== "" ? named : undefined;
}

/** The pull request of the launch's agent this launch opens on, as `-pullRequest <number>` names it; none on any other platform, and where none is named. */
export function launchPullRequest(): number | undefined {
  if (Platform.OS !== "ios") return undefined;
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.PULL_REQUEST);
  const number = typeof named === "number" ? named : Number(named);

  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** Whether the launch argument `key` says true, as iOS registers `-key true`: a string, a boolean, or a number by how it was passed. */
function launchSaysTrue(key: string): boolean {
  if (Platform.OS !== "ios") return false;
  const named: unknown = Settings.get(key);

  return named === true || named === "true" || named === 1;
}

/** Whether this launch starts a fixture run's own Live Activity, as `-liveActivity true` asks (`maestro/live-activity.yaml`); never on any other platform. */
export function launchLiveActivity(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.LIVE_ACTIVITY);
}

/** Whether this launch stands a fixture run as the service's refusal of an old build leaves it, as `-updateNeeded true` asks (`maestro/update-needed.yaml`); never on any other platform. */
export function launchUpdateNeeded(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.UPDATE_NEEDED);
}

/** Whether this launch's fixture run refuses the writes a flow presses, as `-refuseWrites true` asks, so a flow shoots the failure notice (`maestro/failure-notice.yaml`); never on any other platform. */
export function launchRefusesWrites(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.REFUSE_WRITES);
}

/** The test report this launch asks Sentry for, as `-sentryTest <js|native>` names it (`crash-reports.ts`); none on any other platform, and none for a word that is no test. */
export function launchSentryTest(): LaunchSentryTest | undefined {
  if (Platform.OS !== "ios") return undefined;
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.SENTRY_TEST);

  return Object.values(LAUNCH_SENTRY_TEST).find((test) => test === named);
}
