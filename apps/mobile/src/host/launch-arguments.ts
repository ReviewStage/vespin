/**
 * launch-arguments.ts -- the launch arguments a flow runs the app under: `-fixture <profile>`, which stands the app's host on the desktop's synthetic data, as the desktop's `--fixture` does, `-authServer stub`, which signs in against an account service the app answers itself, and `-agent <id>`, which opens on that agent's page.
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
} as const;

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
