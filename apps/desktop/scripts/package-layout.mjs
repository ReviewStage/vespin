import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/**
 * The native helpers, named once. Each is a native source and the binary it
 * becomes: the build compiles this list and packaging ships it in the app's
 * resources, so a helper cannot be built without reaching the bundle or
 * shipped without being built. Each Swift source becomes a standalone
 * executable the app spawns.
 */
export const NATIVE_HELPERS = [
  {
    source: "MicrophoneRoute.swift",
    binary: "mac-microphone-route",
    frameworks: ["CoreAudio", "IOKit"],
  },
  {
    source: "OpenLoginItems.swift",
    binary: "open-login-items",
    frameworks: ["ServiceManagement"],
  },
  {
    source: "ComputerUse.swift",
    binary: "mac-computer-use",
    frameworks: [
      "AppKit",
      "ApplicationServices",
      "AVFoundation",
      "CoreMedia",
      "ImageIO",
      "ScreenCaptureKit",
      "UniformTypeIdentifiers",
    ],
  },
];

/**
 * Vespin's host daemon, shipped inside the bundle as the LaunchAgent macOS
 * runs through `SMAppService`, each piece where Apple's "Placing content in a
 * bundle" puts it. Under `Contents`: the launcher, which is the agent's
 * `BundleProgram`, in `MacOS`; the pinned Node it runs, a helper tool, in
 * `Helpers`; and the agent's plist in `Library/LaunchAgents`, where
 * `SMAppService.agent(plistName:)` looks for it. Under `Contents/Resources`,
 * which holds no code: the daemon's and the runner's bundles, in `host/lib`.
 * The launcher is built from its Swift source as the helpers are, but ships
 * apart from them; its source names these same paths.
 */
export const BUNDLED_HOST = {
  label: "dev.vespin.host",
  launcher: {
    source: "HostLauncher.swift",
    binary: "vespin-host",
    frameworks: ["Foundation"],
  },
  launcherPath: "MacOS/vespin-host",
  nodePath: "Helpers/node",
  libPath: "host/lib",
  plistPath: "Library/LaunchAgents/dev.vespin.host.plist",
};

/**
 * macOS 26's Liquid Glass, laid behind the panel window
 * (`src/main/native/liquid-glass.ts`): `electron-liquid-glass`'s prebuilt
 * N-API addon for the packaged architecture, copied beside the helpers by
 * the native build and shipped and signed as they are. The package's own
 * JavaScript is not bundled; the main process loads the addon itself.
 */
export const LIQUID_GLASS_ADDON = {
  packageName: "electron-liquid-glass",
  prebuild: path.join("prebuilds", "darwin-arm64", "node.napi.armv8.node"),
  binary: "liquid-glass.node",
};

/**
 * node-pty, which runs a shell on this Mac for a Terminal tab
 * (`src/main/native/mac-shell.ts`): its JavaScript and its prebuilt N-API
 * addon and `spawn-helper` for the packaged architecture, copied as one
 * folder beside the helpers by the native build and shipped in the app's
 * resources, where main loads it, rather than bundled, since its JavaScript
 * finds the addon and the helper beside itself. The two binaries are signed
 * as the helpers are.
 */
export const NODE_PTY = {
  packageName: "node-pty",
  folder: "node-pty",
  prebuilds: path.join("prebuilds", `darwin-${PACKAGED_ARCHITECTURE}`),
  binaries: ["pty.node", "spawn-helper"],
};

export function packagedAppPath(repoRoot) {
  return path.join(
    repoRoot,
    "artifacts",
    "release-builder",
    `mac-${PACKAGED_ARCHITECTURE}`,
    "Vespin.app",
  );
}
