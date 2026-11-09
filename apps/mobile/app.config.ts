// app.config.ts -- the iOS app's whole native configuration: Expo generates `ios/` from it on every build, and none is committed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_PALETTE } from "@repo/brand/palette";
import type { ConfigContext, ExpoConfig } from "expo/config";
import { IOSConfig, withDangerousMod, withXcodeProject } from "expo/config-plugins";

/**
 * The bundle identifier the App ID, the associated domain, and TestFlight are
 * registered under; the deep-link scheme is what expo-router and Maestro open
 * a screen by, and the one domain whose links open in the app is the
 * service's own.
 */
export const BUNDLE_IDENTIFIER = "dev.vespin.ios";
export const URL_SCHEME = "vespin";
const ASSOCIATED_DOMAIN = "vespin.dev";

const ACCENT_COLOR_NAME = "AccentColor";

// The build number TestFlight orders uploads by: release-ios.yml names its
// run in it, and a local build, which never uploads, is build 1.
const BUILD_NUMBER = process.env.VESPIN_IOS_BUILD_NUMBER ?? "1";

// The splash's ground and mark are the brand's, in both appearances: the
// mark is generated beside the icon, in each mode's copper on transparency.
const SPLASH = {
  IMAGE_WIDTH: 160,
  LIGHT_IMAGE: "../../packages/brand/assets/mark/mark-color-light-1024.png",
  DARK_IMAGE: "../../packages/brand/assets/mark/mark-color-dark-1024.png",
};

// An asset catalog's sRGB components, as Xcode writes them; the icon bundle's
// `iosColor` in generate-brand-assets.mjs is the same conversion in its own format.
const channel = (hex: string, at: number) =>
  (Number.parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(4);
const colorComponents = (hex: string) => ({
  red: channel(hex, 1),
  green: channel(hex, 3),
  blue: channel(hex, 5),
  alpha: "1.000",
});

// Note that Expo has no setting for the app's tint, so the accent is written
// as the asset catalog's AccentColor, light and dark, which Xcode names as the
// target's global accent: SwiftUI and UIKit tint controls with it.
const withAccentColor = (config: ExpoConfig): ExpoConfig => {
  const written = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const catalog = join(
        IOSConfig.Paths.getSourceRoot(modConfig.modRequest.projectRoot),
        "Images.xcassets",
        `${ACCENT_COLOR_NAME}.colorset`,
      );
      mkdirSync(catalog, { recursive: true });
      const entry = (hex: string, dark: boolean) => ({
        ...(dark ? { appearances: [{ appearance: "luminosity", value: "dark" }] } : {}),
        color: { "color-space": "srgb", components: colorComponents(hex) },
        idiom: "universal",
      });
      const contents = {
        colors: [entry(BRAND_PALETTE.LIGHT.ACCENT, false), entry(BRAND_PALETTE.DARK.ACCENT, true)],
        info: { author: "xcode", version: 1 },
      };
      writeFileSync(join(catalog, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
      return modConfig;
    },
  ]);
  return withXcodeProject(written, (modConfig) => {
    for (const settings of Object.values(
      modConfig.modResults.pbxXCBuildConfigurationSection() as Record<string, unknown>,
    )) {
      const build = (settings as { buildSettings?: Record<string, string> }).buildSettings;
      if (build?.PRODUCT_NAME)
        build.ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = ACCENT_COLOR_NAME;
    }
    return modConfig;
  });
};

// Note that the deployment target is iOS 26 while the SDK is iOS 27's,
// because iOS 26 runs on every iPhone iOS 27 does and already draws Liquid
// Glass, so what 27 adds is used behind a version check. Expo generates the
// UIScene lifecycle and the New Architecture on its own; neither is named
// here because neither can be set another way.
const config = (_context?: ConfigContext): ExpoConfig =>
  withAccentColor({
    name: "Vespin",
    slug: "vespin",
    version: "0.1.0",
    scheme: URL_SCHEME,
    orientation: "default",
    userInterfaceStyle: "automatic",
    platforms: ["ios"],
    ios: {
      bundleIdentifier: BUNDLE_IDENTIFIER,
      buildNumber: BUILD_NUMBER,
      deploymentTarget: "26.0",
      supportsTablet: true,
      icon: "../../packages/brand/assets/ios/Vespin.icon",
      associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`],
      // The TestFlight build takes its pushes from production APNs, which
      // the distribution profile release-ios.yml exports it with allows; a
      // simulator build is unsigned and carries no entitlement at all.
      entitlements: { "aps-environment": "production" },
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: BRAND_PALETTE.LIGHT.GROUND,
          image: SPLASH.LIGHT_IMAGE,
          imageWidth: SPLASH.IMAGE_WIDTH,
          dark: { backgroundColor: BRAND_PALETTE.DARK.GROUND, image: SPLASH.DARK_IMAGE },
        },
      ],
    ],
    // Builds come from GitHub's macOS runners and TestFlight, never an
    // over-the-air update, so Expo's update client is left out of the app.
    updates: { enabled: false },
  });

export default config;
