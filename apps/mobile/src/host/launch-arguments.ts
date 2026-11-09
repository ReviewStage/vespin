/**
 * launch-arguments.ts -- the `-fixture <profile>` launch argument that stands the app's host on the desktop's synthetic data, as the desktop's `--fixture` does.
 *
 * iOS registers a launch argument of the form `-key value` in the app's
 * `NSUserDefaults` argument domain, which React Native's `Settings` reads,
 * so a Maestro flow's `launchApp` arguments and `xcrun simctl launch
 * <device> <bundle> -fixture inbox` both arrive here. A run without the
 * argument, or naming a word that is no profile, leaves the host live.
 */

import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { Platform, Settings } from "react-native";

/** The launch argument that names the profile, as `-fixture <profile>`. */
const FIXTURE_ARGUMENT = "fixture";

/** The profile this launch's arguments name, read from the defaults iOS registered them in; none on any other platform, and none for a word that is no profile. */
export function launchFixtureProfile(): RunProfile | undefined {
  if (Platform.OS !== "ios") return undefined;
  const named: unknown = Settings.get(FIXTURE_ARGUMENT);
  return Object.values(RUN_PROFILE).find((profile) => profile === named);
}
