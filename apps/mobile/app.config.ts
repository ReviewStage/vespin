// app.config.ts -- the iOS app's whole native configuration: Expo generates `ios/` from it on every build, and none is committed.

import type { ExpoConfig } from "expo/config";

/**
 * The bundle identifier the App ID, the associated domain, and TestFlight are
 * registered under; the deep-link scheme is what expo-router and Maestro open
 * a screen by, and the one domain whose links open in the app is the
 * service's own.
 */
export const BUNDLE_IDENTIFIER = "dev.vespin.ios";
export const URL_SCHEME = "vespin";
const ASSOCIATED_DOMAIN = "vespin.dev";

// Note that the deployment target is iOS 26 while the SDK is iOS 27's,
// because iOS 26 runs on every iPhone iOS 27 does and already draws Liquid
// Glass, so what 27 adds is used behind a version check. Expo generates the
// UIScene lifecycle and the New Architecture on its own; neither is named
// here because neither can be set another way.
const config: ExpoConfig = {
  name: "Vespin",
  slug: "vespin",
  version: "0.1.0",
  scheme: URL_SCHEME,
  orientation: "default",
  userInterfaceStyle: "automatic",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    deploymentTarget: "26.0",
    supportsTablet: true,
    associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`],
  },
  plugins: ["expo-router"],
  // Builds come from GitHub's macOS runners and TestFlight, never an
  // over-the-air update, so Expo's update client is left out of the app.
  updates: { enabled: false },
};

export default config;
