import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BRAND_ASSETS_DIRECTORY } from "@repo/brand/assets-directory";
import { DMG_WINDOW } from "@repo/brand/dmg-window";
import { buildAppIcon } from "./app-icon.mjs";
import { LICENSE_RESOURCE_NAME, NOTICE_RESOURCE_NAME } from "./package-config.mjs";
import { BUNDLED_HOST, LIQUID_GLASS_ADDON, NATIVE_HELPERS, NODE_PTY } from "./package-layout.mjs";

export function packageAssetPaths({ appRoot }) {
  const helperPaths = [
    ...[...NATIVE_HELPERS, LIQUID_GLASS_ADDON].map((helper) => helper.binary),
    NODE_PTY.folder,
  ].map((name) => path.join(appRoot, ".build", "native", name));

  const hostRoot = path.join(appRoot, ".build", "host");
  const hostRelease = path.join(hostRoot, "release");

  // Vespin's host daemon, readied by `package-host.mjs` from the host's own release layout.
  const host = {
    launcher: path.join(appRoot, ".build", "native", BUNDLED_HOST.launcher.binary),
    release: hostRelease,
    node: path.join(hostRelease, "node", "bin", "node"),
    lib: path.join(hostRelease, "lib"),
    plist: path.join(hostRoot, path.basename(BUNDLED_HOST.plistPath)),
  };

  const iconPath = path.join(appRoot, ".build", "Vespin.icns");
  const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
  const noticePath = path.join(appRoot, ".build", NOTICE_RESOURCE_NAME);
  const entitlementsPath = path.join(appRoot, "native", "macos", "entitlements.plist");

  const dmgBackgroundPath = path.join(
    appRoot,
    ".build",
    "electron-builder",
    DMG_WINDOW.BACKGROUND.FILE_NAME,
  );

  return {
    appRoot,
    helperPaths,
    host,
    iconPath,
    licensePath,
    noticePath,
    entitlementsPath,
    dmgBackgroundPath,
  };
}

export function preparePackageAssets({ repoRoot, paths }) {
  const { launcher, node, lib, plist } = paths.host;

  for (const helperPath of [...paths.helperPaths, launcher, node, lib, plist]) {
    // A helper missing here is a feature missing at runtime with no other sign of
    // it, so the package fails rather than shipping without one.
    if (!fs.existsSync(helperPath)) {
      throw new Error(`macOS helper is missing: ${helperPath}`);
    }
  }

  fs.mkdirSync(path.dirname(paths.licensePath), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "LICENSE"), paths.licensePath);
  fs.copyFileSync(path.join(repoRoot, "NOTICE"), paths.noticePath);
  buildAppIcon(paths.appRoot);
}

export function prepareElectronBuilderDmgAssets({ paths }) {
  const dmgBackgroundDirectory = path.join(BRAND_ASSETS_DIRECTORY, "dmg");
  fs.mkdirSync(path.dirname(paths.dmgBackgroundPath), { recursive: true });
  execFileSync(
    "tiffutil",
    [
      "-cathidpicheck",
      path.join(dmgBackgroundDirectory, "dmg-background.png"),
      path.join(dmgBackgroundDirectory, "dmg-background@2x.png"),
      "-out",
      paths.dmgBackgroundPath,
    ],
    { stdio: "inherit" },
  );
}
