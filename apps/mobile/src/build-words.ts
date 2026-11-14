// build-words.ts -- this build's version and build number as the app says them, in Settings' About and on the update screen.

import Constants from "expo-constants";

/** This build's version and build number, as iOS's own About names an app's: "1.4.0 (212)". */
export function buildWords(): string {
  const version = Constants.expoConfig?.version ?? "";
  const build = Constants.expoConfig?.ios?.buildNumber;

  return build === undefined ? version : `${version} (${build})`;
}
