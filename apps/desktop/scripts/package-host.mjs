/**
 * package-host.mjs -- Vespin's host daemon readied for the bundle: the daemon's and the runner's bundles built, the Mac's host release laid out unpacked with its pinned Node, and the LaunchAgent's plist written, all under `.build/host`, where packaging reads them (`electron-builder-config.mjs`).
 *
 * The release is laid out by the host's own packaging
 * (`apps/host/scripts/package.ts --folder`), as a Mac's host release is,
 * so the bundle carries the same files and the same Node a standalone
 * install does.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageAssetPaths } from "./package-assets.mjs";
import { APP_ID } from "./package-config.mjs";
import { BUNDLED_HOST } from "./package-layout.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");

/**
 * The agent's plist, holding only what `SMAppService` reads for an agent:
 * its `Label`, its `BundleProgram` (the launcher, relative to the bundle),
 * its `ProgramArguments`, which launchd hands the launcher as they stand, and
 * the app it belongs to, as `AssociatedBundleIdentifiers`. It runs at login,
 * and again a minute after any exit, as the standalone install's agent does
 * (`apps/web/install/install.sh`'s `write_launch_agent`), with no
 * `ProcessType`, for that agent's reason.
 */
function launchAgentPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${BUNDLED_HOST.label}</string>
	<key>BundleProgram</key>
	<string>Contents/${BUNDLED_HOST.launcherPath}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${BUNDLED_HOST.launcher.binary}</string>
		<string>run</string>
		<string>--bundled</string>
	</array>
	<key>AssociatedBundleIdentifiers</key>
	<array>
		<string>${APP_ID}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>60</integer>
</dict>
</plist>
`;
}

function pnpm(...args) {
  execFileSync("pnpm", args, { cwd: appRoot, stdio: "inherit" });
}

if (process.platform !== "darwin") {
  throw new Error("Packaging Vespin's host into the app requires macOS");
}

const { host } = packageAssetPaths({ appRoot });
pnpm("--filter", "@repo/agent-runner", "build");
pnpm("--filter", "@repo/host-daemon", "build");
pnpm(
  "--filter",
  "@repo/host-daemon",
  "run",
  "package",
  "--",
  "--os",
  "darwin",
  "--arch",
  "arm64",
  "--folder",
  host.release,
);
fs.writeFileSync(host.plist, launchAgentPlist());
process.stdout.write(`Readied the host for the bundle: ${path.dirname(host.plist)}\n`);
