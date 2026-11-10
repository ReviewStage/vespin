// app.config.ts -- the iOS app's whole native configuration: Expo generates `ios/` from it on every build, and none is committed.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LUCIDE_SYMBOL_TEMPLATES } from "@repo/brand/lucide-symbols";
import { BRAND_PALETTE } from "@repo/brand/palette";
import { GITHUB_PATH, GOOGLE_MARK_LAYERS } from "@repo/brand/provider-marks";
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

// The app's icon: the Icon Composer bundle iOS 26 and later draw, and the
// brand's flat 1024 cut of its light look, which App Store Connect and
// TestFlight read since they read no `.icon`. Xcode pairs the two by name: an
// app icon set in the asset catalog named as the bundle stands beside it.
const ICON = {
  BUNDLE: "../../packages/brand/assets/ios/Vespin.icon",
  MARKETING: "../../packages/brand/assets/icon/icon-ios-1024.png",
  SIDE: 1024,
};
// A PNG's IHDR color type for 8-bit RGB with no alpha channel, the one App
// Store Connect takes for an app icon (ITMS-90717).
const PNG_COLOR_TYPE_RGB = 2;

// The images the screens draw by name from the asset catalog, as vectors:
// the Keel mark `@repo/ui-native`'s `BrandMark` reads (`BRAND_MARK_ASSET`),
// the brand's own copper SVG in each appearance, and the marks its
// `ProviderButton` reads (`PROVIDER_MARK_ASSET`), the web's sign-in buttons'
// marks from the brand's paths: GitHub's a template SwiftUI draws in the ink
// of the words beside it, Google's in its own four colors.
const IMAGE_SETS = [
  {
    NAME: "BrandMark",
    LIGHT: { FILE: "../../packages/brand/assets/mark/mark-color-light.svg" },
    DARK: { FILE: "../../packages/brand/assets/mark/mark-color-dark.svg" },
    TEMPLATE: false,
  },
  {
    NAME: "GitHubMark",
    LIGHT: {
      SVG: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#000" d="${GITHUB_PATH}"/></svg>`,
    },
    TEMPLATE: true,
  },
  {
    NAME: "GoogleMark",
    LIGHT: {
      SVG: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">${GOOGLE_MARK_LAYERS.map(
        ({ fill, path }) => `<path fill="${fill}" d="${path}"/>`,
      ).join("")}</svg>`,
    },
    TEMPLATE: false,
  },
] as const;

// The Notification Service Extension: its target, the Swift it builds from
// (`notification-service/`, the app's one native code), and the bundle id it
// is signed under, which automatic signing registers beside the app's.
const NOTIFICATION_SERVICE = {
  TARGET: "NotificationService",
  SOURCE_DIRECTORY: "notification-service",
  SOURCE: "NotificationService.swift",
  INFO_PLIST: "Info.plist",
  BUNDLE_IDENTIFIER: `${BUNDLE_IDENTIFIER}.NotificationService`,
  SWIFT_VERSION: "5.0",
};

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

// Note that the bundle's name is the target's app icon, which Expo sets from
// `ios.icon`, so the flat icon is written as an app icon set of that name, and
// refused here, before Xcode or App Store Connect would, unless it is an
// opaque RGB PNG of the marketing icon's side.
const withMarketingIcon = (config: ExpoConfig): ExpoConfig =>
  withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { projectRoot } = modConfig.modRequest;
      const png = readFileSync(join(projectRoot, ICON.MARKETING));
      const [width, height, colorType] = [png.readUInt32BE(16), png.readUInt32BE(20), png[25]];
      if (width !== ICON.SIDE || height !== ICON.SIDE || colorType !== PNG_COLOR_TYPE_RGB)
        throw new Error(
          `${ICON.MARKETING} must be a ${ICON.SIDE}x${ICON.SIDE} RGB PNG with no alpha; it is ${width}x${height}, color type ${colorType}`,
        );
      const iconSet = join(
        IOSConfig.Paths.getSourceRoot(projectRoot),
        "Images.xcassets",
        `${basename(ICON.BUNDLE, ".icon")}.appiconset`,
      );
      mkdirSync(iconSet, { recursive: true });
      const file = basename(ICON.MARKETING);
      writeFileSync(join(iconSet, file), png);
      const contents = {
        images: [
          {
            filename: file,
            idiom: "universal",
            platform: "ios",
            size: `${ICON.SIDE}x${ICON.SIDE}`,
          },
        ],
        info: { author: "xcode", version: 1 },
      };
      writeFileSync(join(iconSet, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
      return modConfig;
    },
  ]);

// The extension's Info.plist: the service extension point and its class, and
// the app's version and build, which App Store Connect refuses an extension
// to differ from.
const notificationServicePlist = (version: string, build: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>${NOTIFICATION_SERVICE.TARGET}</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>${version}</string>
	<key>CFBundleVersion</key>
	<string>${build}</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.usernotifications.service</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).NotificationService</string>
	</dict>
</dict>
</plist>
`;

// Note that Expo has no setting for an app extension, so the Notification
// Service Extension's folder is written beside the app's, its Swift copied
// from `notification-service/`, and its target added to the project Expo
// generates, embedded in the app, built for the app's deployment target, and
// signed as the app is. A project that holds the target already, as a
// prebuild over an existing `ios/` does, is left as it stands.
const withNotificationService = (config: ExpoConfig): ExpoConfig => {
  const written = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { projectRoot, platformProjectRoot } = modConfig.modRequest;
      const folder = join(platformProjectRoot, NOTIFICATION_SERVICE.TARGET);
      mkdirSync(folder, { recursive: true });
      copyFileSync(
        join(projectRoot, NOTIFICATION_SERVICE.SOURCE_DIRECTORY, NOTIFICATION_SERVICE.SOURCE),
        join(folder, NOTIFICATION_SERVICE.SOURCE),
      );
      writeFileSync(
        join(folder, NOTIFICATION_SERVICE.INFO_PLIST),
        notificationServicePlist(modConfig.version ?? "1.0", modConfig.ios?.buildNumber ?? "1"),
      );
      return modConfig;
    },
  ]);
  return withXcodeProject(written, (modConfig) => {
    const project = modConfig.modResults;
    if (project.pbxTargetByName(NOTIFICATION_SERVICE.TARGET)) return modConfig;
    const group = project.addPbxGroup(
      [NOTIFICATION_SERVICE.SOURCE, NOTIFICATION_SERVICE.INFO_PLIST],
      NOTIFICATION_SERVICE.TARGET,
      NOTIFICATION_SERVICE.TARGET,
    );
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    // Note that the xcode library's addTarget writes into these sections without making them, and a fresh Expo project has neither.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    const target = project.addTarget(
      NOTIFICATION_SERVICE.TARGET,
      "app_extension",
      NOTIFICATION_SERVICE.TARGET,
      NOTIFICATION_SERVICE.BUNDLE_IDENTIFIER,
    );
    project.addBuildPhase(
      [NOTIFICATION_SERVICE.SOURCE],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    for (const settings of Object.values(
      project.pbxXCBuildConfigurationSection() as Record<string, unknown>,
    )) {
      const build = (settings as { buildSettings?: Record<string, string> }).buildSettings;
      if (build?.PRODUCT_NAME !== `"${NOTIFICATION_SERVICE.TARGET}"`) continue;
      Object.assign(build, {
        CODE_SIGN_STYLE: "Automatic",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${NOTIFICATION_SERVICE.TARGET}/${NOTIFICATION_SERVICE.INFO_PLIST}`,
        IPHONEOS_DEPLOYMENT_TARGET: modConfig.ios?.deploymentTarget ?? "26.0",
        PRODUCT_BUNDLE_IDENTIFIER: NOTIFICATION_SERVICE.BUNDLE_IDENTIFIER,
        SKIP_INSTALL: "YES",
        SWIFT_VERSION: NOTIFICATION_SERVICE.SWIFT_VERSION,
        TARGETED_DEVICE_FAMILY: '"1,2"',
      });
    }
    return modConfig;
  });
};

/** One appearance's SVG: a file of the brand's, or drawn here. */
type ImageSource = { readonly FILE: string } | { readonly SVG: string };

// Each of `IMAGE_SETS` as a vector image set of the asset catalog, its dark
// appearance beside its light one where it has one, and each of Lucide's
// glyphs `@repo/ui-native` draws (`LUCIDE_SYMBOL`) as a symbol set, a custom
// SF Symbol from the brand's outlined template, so it sizes with Dynamic
// Type, weighs with its text, and sits on its baseline as SF Symbols do.
const withImageSets = (config: ExpoConfig): ExpoConfig =>
  withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { projectRoot } = modConfig.modRequest;
      const catalog = join(IOSConfig.Paths.getSourceRoot(projectRoot), "Images.xcassets");
      const svgOf = (source: ImageSource) =>
        "FILE" in source ? readFileSync(join(projectRoot, source.FILE), "utf8") : source.SVG;
      for (const set of IMAGE_SETS) {
        const imageSet = join(catalog, `${set.NAME}.imageset`);
        mkdirSync(imageSet, { recursive: true });
        const appearances = [
          { file: `${set.NAME}.svg`, source: set.LIGHT, dark: false },
          ...("DARK" in set
            ? [{ file: `${set.NAME}-dark.svg`, source: set.DARK, dark: true }]
            : []),
        ];
        for (const { file, source } of appearances)
          writeFileSync(join(imageSet, file), svgOf(source));
        const contents = {
          images: appearances.map(({ file, dark }) => ({
            ...(dark ? { appearances: [{ appearance: "luminosity", value: "dark" }] } : {}),
            filename: file,
            idiom: "universal",
          })),
          info: { author: "xcode", version: 1 },
          properties: {
            "preserves-vector-representation": true,
            "template-rendering-intent": set.TEMPLATE ? "template" : "original",
          },
        };
        writeFileSync(join(imageSet, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
      }
      for (const { name, svg } of LUCIDE_SYMBOL_TEMPLATES) {
        const symbolSet = join(catalog, `${name}.symbolset`);
        mkdirSync(symbolSet, { recursive: true });
        writeFileSync(join(symbolSet, `${name}.svg`), svg);
        const contents = {
          info: { author: "xcode", version: 1 },
          symbols: [{ filename: `${name}.svg`, idiom: "universal" }],
        };
        writeFileSync(join(symbolSet, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
      }
      return modConfig;
    },
  ]);

// Note that the deployment target is iOS 26 while the SDK is iOS 27's,
// because iOS 26 runs on every iPhone iOS 27 does and already draws Liquid
// Glass, so what 27 adds is used behind a version check. Expo generates the
// UIScene lifecycle and the New Architecture on its own; neither is named
// here because neither can be set another way.
const baseConfig = (_context?: ConfigContext): ExpoConfig =>
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
      icon: ICON.BUNDLE,
      // The app's universal links, and the sign-in's HTTPS callback, which
      // `ASWebAuthenticationSession` catches only on a host the app shares
      // web credentials with.
      associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`, `webcredentials:${ASSOCIATED_DOMAIN}`],
      // The TestFlight build takes its pushes from production APNs, which
      // the distribution profile release-ios.yml exports it with allows; a
      // simulator build is unsigned and carries no entitlement at all.
      entitlements: { "aps-environment": "production" },
      // Declared exempt from US export rules, so App Store Connect stops
      // asking on every build: the app's one cipher of its own (the host's
      // sealed files, `keychain-cipher.ts`) protects only its own data at
      // rest, and everything on the wire is the system's HTTPS.
      // iOS wakes the app for a settled thread's background push, which
      // clears its notification (`src/notification-task.ts`).
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["remote-notification"],
      },
    },
    plugins: [
      "expo-router",
      // A message's photo is picked in the system's photo picker, which reads
      // only what the person picks, so no camera or microphone is asked for.
      [
        "expo-image-picker",
        {
          photosPermission: "Vespin attaches the photos you pick to a message to an agent.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
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

// The images the screens draw and the flat app icon, written into the asset
// catalog over the rest, and the Notification Service Extension beside the app.
const config = (context?: ConfigContext): ExpoConfig =>
  withNotificationService(withMarketingIcon(withImageSets(baseConfig(context))));

export default config;
