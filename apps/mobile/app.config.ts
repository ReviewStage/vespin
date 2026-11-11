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

/**
 * The App Group the app and its extensions share files through, and the
 * Info.plist key every target that shares it names it under, so Swift reads
 * the group from its bundle rather than spelling it again. The Apple
 * Developer account registers the group once, and the app's JavaScript finds
 * its container through the app's own entitlement.
 */
export const APP_GROUP = "group.dev.vespin.ios";
const APP_GROUP_PLIST_KEY = "VespinAppGroup";
const APP_GROUPS_ENTITLEMENT = "com.apple.security.application-groups";
const APP_GROUP_ENTITLEMENTS = { [APP_GROUPS_ENTITLEMENT]: [APP_GROUP] } as const;

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

/** A Swift file an app extension builds, copied into its folder beside the app's from the app's directory. */
type ExtensionFile = { readonly FROM: string; readonly NAME: string };

/** A value an extension's Info.plist or entitlements hold. */
type PlistValue =
  | string
  | boolean
  | number
  | readonly string[]
  | { readonly [key: string]: PlistValue };

/**
 * An app extension the app embeds: its target, the bundle id automatic
 * signing registers beside the app's, its Swift (the app's native code),
 * its extension point and, where the point names them, its principal class
 * and attributes, the brand's colors its asset catalog holds, by the name
 * its Swift reads each by, the entitlements it is signed with, and any
 * other keys its Info.plist carries over the rest.
 */
type AppExtension = {
  readonly TARGET: string;
  readonly BUNDLE_IDENTIFIER: string;
  readonly SOURCES: readonly ExtensionFile[];
  readonly EXTENSION_POINT: string;
  readonly PRINCIPAL_CLASS?: string;
  readonly ATTRIBUTES?: Readonly<Record<string, PlistValue>>;
  readonly COLORS?: Readonly<Record<string, keyof typeof BRAND_PALETTE.LIGHT>>;
  readonly ENTITLEMENTS?: Readonly<Record<string, PlistValue>>;
  readonly INFO?: Readonly<Record<string, PlistValue>>;
};

const EXTENSION_SWIFT_VERSION = "5.0";
// What an asset catalog's own Contents.json says, as Xcode writes it.
const ASSET_CATALOG_INFO = { info: { author: "xcode", version: 1 } };

// Note that each extension's Info.plist, entitlements, and asset catalog are
// named for its target, because the xcode library's addPbxGroup reuses a
// file reference of the same path, so a second extension's `Info.plist` or
// `Assets.xcassets` would join the first's reference.
const extensionPlistName = (extension: AppExtension) => `${extension.TARGET}-Info.plist`;
const extensionEntitlementsName = (extension: AppExtension) => `${extension.TARGET}.entitlements`;
const extensionCatalogName = (extension: AppExtension) => `${extension.TARGET}.xcassets`;

// The Notification Service Extension, which sets a decide push's buttons.
const NOTIFICATION_SERVICE: AppExtension = {
  TARGET: "NotificationService",
  BUNDLE_IDENTIFIER: `${BUNDLE_IDENTIFIER}.NotificationService`,
  SOURCES: [{ FROM: "notification-service", NAME: "NotificationService.swift" }],
  EXTENSION_POINT: "com.apple.usernotifications.service",
  PRINCIPAL_CLASS: "NotificationService",
  ENTITLEMENTS: APP_GROUP_ENTITLEMENTS,
};

// The Stop button's intent, which iOS runs in the app's process, so the app
// builds it too, beside the widget that draws it.
const STOP_AGENT_INTENT: ExtensionFile = { FROM: "live-activity", NAME: "StopAgentIntent.swift" };

// The widget extension that draws the member's running agents as a Live
// Activity. Its attributes are the app's module's own file, since ActivityKit
// matches the app's activity to the widget's by the type's name.
const LIVE_ACTIVITY: AppExtension = {
  TARGET: "AgentsLiveActivity",
  BUNDLE_IDENTIFIER: `${BUNDLE_IDENTIFIER}.AgentsLiveActivity`,
  SOURCES: [
    { FROM: "live-activity", NAME: "AgentsLiveActivity.swift" },
    STOP_AGENT_INTENT,
    { FROM: "modules/live-activity/ios", NAME: "AgentsActivityAttributes.swift" },
  ],
  EXTENSION_POINT: "com.apple.widgetkit-extension",
  COLORS: { Working: "WORKING", Attention: "ATTENTION", Complete: "COMPLETE" },
  ENTITLEMENTS: APP_GROUP_ENTITLEMENTS,
};

// The share extension: the system's share sheet offers the app for text and
// a web link, and its sheet keeps what was shared as New task's draft
// (`share-extension/`), named in the share sheet as the app is.
const SHARE_EXTENSION: AppExtension = {
  TARGET: "ShareExtension",
  BUNDLE_IDENTIFIER: `${BUNDLE_IDENTIFIER}.ShareExtension`,
  SOURCES: [
    { FROM: "share-extension", NAME: "ShareViewController.swift" },
    { FROM: "share-extension", NAME: "ShareSheet.swift" },
    { FROM: "share-extension", NAME: "SharedItems.swift" },
    { FROM: "share-extension", NAME: "AppGroupFiles.swift" },
  ],
  EXTENSION_POINT: "com.apple.share-services",
  PRINCIPAL_CLASS: "ShareViewController",
  ATTRIBUTES: {
    NSExtensionActivationRule: {
      NSExtensionActivationSupportsText: true,
      NSExtensionActivationSupportsWebURLWithMaxCount: 1,
    },
  },
  COLORS: { AccentColor: "ACCENT" },
  ENTITLEMENTS: APP_GROUP_ENTITLEMENTS,
  INFO: { CFBundleDisplayName: "Vespin" },
};

// The build number TestFlight orders uploads by: release-ios.yml names its
// run in it, and a local build, which never uploads, is build 1.
const BUILD_NUMBER = process.env.VESPIN_IOS_BUILD_NUMBER ?? "1";

// The Sentry project the app reports to and uploads its symbols under: the
// desktop's, under the one DSN the release secrets hold for both
// (`SENTRY_DSN`), written into the build's `extra` for `src/crash-reports.ts`
// to read, empty where the build names none. Sentry's config plugin adds the
// build phases that upload the Hermes source maps and the dSYMs, which
// sentry-cli does under `SENTRY_AUTH_TOKEN`; a build without the token, a
// local or simulator build among them, uploads nothing rather than failing.
const SENTRY = {
  ORGANIZATION: "stage-review",
  PROJECT: "vespin-desktop",
  URL: "https://sentry.io/",
} as const;

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

// An asset catalog's color set of one of the brand's colors, light and dark.
const colorSet = (role: keyof typeof BRAND_PALETTE.LIGHT) => {
  const entry = (hex: string, dark: boolean) => ({
    ...(dark ? { appearances: [{ appearance: "luminosity", value: "dark" }] } : {}),
    color: { "color-space": "srgb", components: colorComponents(hex) },
    idiom: "universal",
  });
  return {
    colors: [entry(BRAND_PALETTE.LIGHT[role], false), entry(BRAND_PALETTE.DARK[role], true)],
    info: { author: "xcode", version: 1 },
  };
};

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
      writeFileSync(
        join(catalog, "Contents.json"),
        `${JSON.stringify(colorSet("ACCENT"), null, 2)}\n`,
      );
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

// A string as plist XML's text.
const plistText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// A plist value as XML, indented by `depth` tabs.
const plistXml = (value: PlistValue, depth: number): string => {
  const indent = "\t".repeat(depth);
  if (typeof value === "string") return `${indent}<string>${plistText(value)}</string>`;
  if (typeof value === "boolean") return `${indent}<${value}/>`;
  if (typeof value === "number") return `${indent}<integer>${value}</integer>`;
  if (Array.isArray(value))
    return `${indent}<array>\n${value.map((item) => plistXml(item, depth + 1)).join("\n")}\n${indent}</array>`;
  return `${indent}<dict>\n${plistEntries(value as Record<string, PlistValue>, depth + 1)}\n${indent}</dict>`;
};

// A dictionary's keys and values as XML, each key at `depth` tabs.
const plistEntries = (entries: Readonly<Record<string, PlistValue>>, depth: number): string =>
  Object.entries(entries)
    .map(
      ([key, value]) =>
        `${"\t".repeat(depth)}<key>${plistText(key)}</key>\n${plistXml(value, depth)}`,
    )
    .join("\n");

// A whole plist document of one dictionary.
const plistDocument = (entries: Readonly<Record<string, PlistValue>>) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
${plistXml(entries, 0)}
</plist>
`;

// An extension's Info.plist: its extension point and, where it has them, its
// principal class and attributes, the app's version and build, which App
// Store Connect refuses an extension to differ from, the App Group where it
// shares it, and its own keys over the rest.
const extensionPlist = (extension: AppExtension, version: string, build: string) =>
  plistDocument({
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: extension.TARGET,
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
    CFBundleShortVersionString: version,
    CFBundleVersion: build,
    NSExtension: {
      NSExtensionPointIdentifier: extension.EXTENSION_POINT,
      ...(extension.PRINCIPAL_CLASS === undefined
        ? undefined
        : { NSExtensionPrincipalClass: `$(PRODUCT_MODULE_NAME).${extension.PRINCIPAL_CLASS}` }),
      ...(extension.ATTRIBUTES === undefined
        ? undefined
        : { NSExtensionAttributes: extension.ATTRIBUTES }),
    },
    ...(extension.ENTITLEMENTS?.[APP_GROUPS_ENTITLEMENT] === undefined
      ? undefined
      : { [APP_GROUP_PLIST_KEY]: APP_GROUP }),
    ...extension.INFO,
  });

// Note that Expo has no setting for an app extension, so each extension's
// folder is written beside the app's, its Swift copied from the app's
// directory and its colors written as its asset catalog, and its target
// added to the project Expo generates, embedded in the app, built for the
// app's deployment target, and signed as the app is. A project that holds
// the target already, as a prebuild over an existing `ios/` does, is left as
// it stands.
const withAppExtension = (config: ExpoConfig, extension: AppExtension): ExpoConfig => {
  const colors = Object.entries(extension.COLORS ?? {});
  const written = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { projectRoot, platformProjectRoot } = modConfig.modRequest;
      const folder = join(platformProjectRoot, extension.TARGET);
      mkdirSync(folder, { recursive: true });
      for (const { FROM, NAME } of extension.SOURCES)
        copyFileSync(join(projectRoot, FROM, NAME), join(folder, NAME));
      writeFileSync(
        join(folder, extensionPlistName(extension)),
        extensionPlist(extension, modConfig.version ?? "1.0", modConfig.ios?.buildNumber ?? "1"),
      );
      if (extension.ENTITLEMENTS !== undefined)
        writeFileSync(
          join(folder, extensionEntitlementsName(extension)),
          plistDocument(extension.ENTITLEMENTS),
        );
      if (colors.length > 0) {
        const catalog = join(folder, extensionCatalogName(extension));
        mkdirSync(catalog, { recursive: true });
        writeFileSync(
          join(catalog, "Contents.json"),
          `${JSON.stringify(ASSET_CATALOG_INFO, null, 2)}\n`,
        );
      }
      for (const [name, role] of colors) {
        const set = join(folder, extensionCatalogName(extension), `${name}.colorset`);
        mkdirSync(set, { recursive: true });
        writeFileSync(join(set, "Contents.json"), `${JSON.stringify(colorSet(role), null, 2)}\n`);
      }
      return modConfig;
    },
  ]);
  return withXcodeProject(written, (modConfig) => {
    const project = modConfig.modResults;
    if (project.pbxTargetByName(extension.TARGET)) return modConfig;
    const sources = extension.SOURCES.map(({ NAME }) => NAME);
    const resources = colors.length > 0 ? [extensionCatalogName(extension)] : [];
    const entitlements =
      extension.ENTITLEMENTS === undefined ? [] : [extensionEntitlementsName(extension)];
    const group = project.addPbxGroup(
      [...sources, ...resources, extensionPlistName(extension), ...entitlements],
      extension.TARGET,
      extension.TARGET,
    );
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    // Note that the xcode library's addTarget writes into these sections without making them, and a fresh Expo project has neither.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    const target = project.addTarget(
      extension.TARGET,
      "app_extension",
      extension.TARGET,
      extension.BUNDLE_IDENTIFIER,
    );
    project.addBuildPhase(sources, "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase(resources, "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    for (const settings of Object.values(
      project.pbxXCBuildConfigurationSection() as Record<string, unknown>,
    )) {
      const build = (settings as { buildSettings?: Record<string, string> }).buildSettings;
      if (build?.PRODUCT_NAME !== `"${extension.TARGET}"`) continue;
      Object.assign(build, {
        CODE_SIGN_STYLE: "Automatic",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${extension.TARGET}/${extensionPlistName(extension)}`,
        IPHONEOS_DEPLOYMENT_TARGET: modConfig.ios?.deploymentTarget ?? "26.0",
        PRODUCT_BUNDLE_IDENTIFIER: extension.BUNDLE_IDENTIFIER,
        SKIP_INSTALL: "YES",
        // What Swift built into the app and an extension alike leaves out of the extension.
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"$(inherited) APP_EXTENSION"',
        SWIFT_VERSION: EXTENSION_SWIFT_VERSION,
        TARGETED_DEVICE_FAMILY: '"1,2"',
        ...(entitlements.length === 0
          ? undefined
          : { CODE_SIGN_ENTITLEMENTS: `${extension.TARGET}/${entitlements[0]}` }),
      });
    }
    return modConfig;
  });
};

// The Stop button's intent built into the app's own target as well, since
// iOS runs a Live Activity's intent in the app's process: copied beside the
// app's sources and added to its target.
const withStopAgentIntent = (config: ExpoConfig): ExpoConfig => {
  const written = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { projectRoot } = modConfig.modRequest;
      copyFileSync(
        join(projectRoot, STOP_AGENT_INTENT.FROM, STOP_AGENT_INTENT.NAME),
        join(IOSConfig.Paths.getSourceRoot(projectRoot), STOP_AGENT_INTENT.NAME),
      );
      return modConfig;
    },
  ]);
  return withXcodeProject(written, (modConfig) => {
    const project = modConfig.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(modConfig.modRequest.projectRoot);
    const app = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName });
    modConfig.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${projectName}/${STOP_AGENT_INTENT.NAME}`,
      groupName: projectName,
      project,
      targetUuid: app.uuid,
    });
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
      // The App Group it shares files with its extensions through.
      entitlements: { "aps-environment": "production", ...APP_GROUP_ENTITLEMENTS },
      // Declared exempt from US export rules, so App Store Connect stops
      // asking on every build: the app's one cipher of its own (the host's
      // sealed files, `keychain-cipher.ts`) protects only its own data at
      // rest, and everything on the wire is the system's HTTPS.
      // iOS wakes the app for a settled thread's background push, which
      // clears its notification (`src/notification-task.ts`).
      // The member's running agents stand in a Live Activity the service
      // starts and updates by push (`live-activity/`).
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["remote-notification"],
        NSSupportsLiveActivities: true,
        [APP_GROUP_PLIST_KEY]: APP_GROUP,
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
      [
        "@sentry/react-native/expo",
        {
          organization: SENTRY.ORGANIZATION,
          project: SENTRY.PROJECT,
          url: SENTRY.URL,
          disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN,
        },
      ],
    ],
    // A TestFlight build is the one whose number release-ios.yml names, and its reports are filed as production's.
    extra: {
      sentry: {
        dsn: process.env.SENTRY_DSN ?? "",
        released: process.env.VESPIN_IOS_BUILD_NUMBER !== undefined,
      },
    },
    // Builds come from GitHub's macOS runners and TestFlight, never an
    // over-the-air update, so Expo's update client is left out of the app.
    updates: { enabled: false },
  });

// The images the screens draw and the flat app icon, written into the asset
// catalog over the rest, and the Notification Service Extension, the Live
// Activity's widget extension, and the share extension beside the app, with
// the Stop intent the widget draws built into the app as well.
const config = (context?: ConfigContext): ExpoConfig =>
  [NOTIFICATION_SERVICE, LIVE_ACTIVITY, SHARE_EXTENSION].reduce(
    withAppExtension,
    withStopAgentIntent(withMarketingIcon(withImageSets(baseConfig(context)))),
  );

export default config;
