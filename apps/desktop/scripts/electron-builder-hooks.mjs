import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signAsync } from "@electron/osx-sign";
import { BUNDLED_HOST_ENTITLEMENTS, macAppDesignatedRequirement } from "./package-config.mjs";
import { BUNDLED_HOST } from "./package-layout.mjs";
import {
  awaitNotarizationDecision,
  notaryInfoArguments,
  notaryLogArguments,
  notarySubmitArguments,
  RELEASE_LATEST_DMG_FILE_NAME,
  releaseDmgFileName,
  releaseZipFileName,
  resolveNotaryCredentials,
  STAPLE_ATTEMPTS,
  STAPLE_RETRY_INTERVAL_MS,
  stapleArguments,
  stapleWithRetry,
} from "./release-config.mjs";

const ELECTRON_BUILDER_NOTARIZE_ENV = "APP_ELECTRON_BUILDER_NOTARIZE";

// As many tries, and as far apart, as electron-builder's own signing makes
// (app-builder-lib's `macCodeSign.sign`), which this hook stands in for.
const SIGN_ATTEMPTS = 4;
const SIGN_RETRY_INTERVAL_MS = 5_000;

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function submitForNotarization(artifactPath, credentials) {
  let notaryOutput;

  try {
    notaryOutput = execFileSync("xcrun", notarySubmitArguments(artifactPath, credentials), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    notaryOutput = error.stdout?.toString() ?? "";

    if (!notaryOutput) throw error;
  }

  let submission;

  try {
    submission = JSON.parse(notaryOutput);
  } catch {
    process.stderr.write(notaryOutput);
    throw new Error("Could not parse the notarization response");
  }

  if (!submission.id) {
    process.stderr.write(notaryOutput);
    throw new Error("Apple did not return a notarization submission ID");
  }

  const readStatus = () => {
    try {
      return JSON.parse(
        execFileSync("xcrun", notaryInfoArguments(submission.id, credentials), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        }),
      ).status;
    } catch {
      return undefined;
    }
  };

  try {
    await awaitNotarizationDecision({ readStatus, wait: sleep });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    execFileSync("xcrun", notaryLogArguments(submission.id, credentials), {
      stdio: "inherit",
    });
    throw new Error(`Apple did not accept ${artifactPath} for notarization`, { cause: error });
  }
}

function staple(artifactPath) {
  return stapleWithRetry({
    staple: () => execFileSync("xcrun", stapleArguments(artifactPath), { stdio: "inherit" }),
    wait: sleep,
    attempts: STAPLE_ATTEMPTS,
    intervalMs: STAPLE_RETRY_INTERVAL_MS,
  });
}

/**
 * electron-builder's signing options, as `mac.sign` hands them over, with
 * two changes of this app's own. The host's two executables (`BUNDLED_HOST`)
 * are signed with entitlements of their own, since electron-builder signs
 * every other file with the app's inherited entitlements and has no option
 * for one file's. And the app bundle, alone, is signed with the designated
 * requirement that accepts a Developer ID from any of `teamIds`
 * (`macAppDesignatedRequirement`), where there are any: a Developer ID
 * release names them, and an ad-hoc package names none, so its requirement
 * stays codesign's, which its own signature satisfies. Everything else, the
 * identity, hardened runtime, timestamp, and the inside-out order
 * `@electron/osx-sign` signs in, is electron-builder's.
 */
export function electronBuilderSignOptions(configuration, teamIds) {
  const appPath = path.resolve(configuration.app);
  const contents = path.join(appPath, "Contents");

  const ownEntitlements = new Map([
    [path.resolve(contents, BUNDLED_HOST.launcherPath), BUNDLED_HOST_ENTITLEMENTS.launcher],
    [path.resolve(contents, BUNDLED_HOST.nodePath), BUNDLED_HOST_ENTITLEMENTS.node],
  ]);

  const appRequirements =
    teamIds === undefined ? {} : { requirements: `=${macAppDesignatedRequirement(teamIds)}` };

  return {
    ...configuration,
    optionsForFile: (filePath) => {
      const fileOptions = configuration.optionsForFile(filePath);
      const resolvedPath = path.resolve(filePath);

      if (resolvedPath === appPath) return { ...fileOptions, ...appRequirements };

      const entitlements = ownEntitlements.get(resolvedPath);

      // Note that a fresh list each time, since osx-sign replaces a list it is handed with the plist it writes for it.
      return entitlements === undefined
        ? fileOptions
        : { ...fileOptions, entitlements: [...entitlements] };
    },
  };
}

/**
 * Refuses a signed app whose designated requirement does not name every
 * team, since nothing later would: a release that lost the requirement
 * would still notarize, pass every check, and ship, and only the switch to
 * the other team's certificate would find it, by stranding every install.
 */
function assertDesignatedRequirement(appPath, teamIds) {
  const requirement = execFileSync("codesign", ["-d", "-r-", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const designated = requirement.split("\n").find((line) => line.startsWith("designated =>"));

  for (const teamId of teamIds) {
    if (designated?.includes(teamId)) continue;
    throw new Error(
      `${appPath} is not signed with a designated requirement naming team ${teamId}: ${designated ?? "none"}`,
    );
  }
}

/** electron-builder's `mac.sign`, signing with `electronBuilderSignOptions` and as many tries as its own signing makes. */
export async function signElectronBuilderApp(configuration, teamIds) {
  const options = electronBuilderSignOptions(configuration, teamIds);

  for (let attempt = 1; ; attempt += 1) {
    try {
      await signAsync(options);
      break;
    } catch (error) {
      if (attempt >= SIGN_ATTEMPTS) throw error;
      sleep(SIGN_RETRY_INTERVAL_MS * attempt);
    }
  }

  if (teamIds !== undefined) assertDesignatedRequirement(configuration.app, teamIds);
}

function shouldNotarize() {
  return process.env[ELECTRON_BUILDER_NOTARIZE_ENV] === "1";
}

export async function notarizeElectronBuilderApp(context) {
  if (!shouldNotarize()) return;
  const credentials = resolveNotaryCredentials(process.env);
  const appPath = path.join(context.appOutDir, "Vespin.app");
  const submissionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-notary-"));

  try {
    const submissionPath = path.join(submissionDirectory, "Vespin.app.zip");
    execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, submissionPath], {
      stdio: "inherit",
    });
    await submitForNotarization(submissionPath, credentials);
    await staple(appPath);
  } finally {
    fs.rmSync(submissionDirectory, { recursive: true, force: true });
  }
}

function writeSha256(artifactPath) {
  const output = execFileSync("shasum", ["-a", "256", path.basename(artifactPath)], {
    cwd: path.dirname(artifactPath),
    encoding: "utf8",
  });

  fs.writeFileSync(`${artifactPath}.sha256`, output);

  return `${artifactPath}.sha256`;
}

export async function finalizeElectronBuilderArtifacts(buildResult) {
  const artifacts = [...buildResult.artifactPaths];

  // A `--dir` build (the evidence run's) stops at the unpacked app: there is no
  // DMG or zip to checksum, notarize, or name latest, and demanding one would
  // fail the very build that asked for none.
  const builtTargets = [...buildResult.platformToTargets.values()].flatMap((targets) => [
    ...targets.keys(),
  ]);

  if (!builtTargets.includes("dmg")) return artifacts;

  const { version } = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  const outputDirectory = buildResult.outDir;
  const dmgPath = path.join(outputDirectory, releaseDmgFileName(version));
  const zipPath = path.join(outputDirectory, releaseZipFileName(version));

  if (!fs.existsSync(dmgPath)) throw new Error(`electron-builder did not write ${dmgPath}`);

  if (!fs.existsSync(zipPath)) throw new Error(`electron-builder did not write ${zipPath}`);

  if (shouldNotarize()) {
    const credentials = resolveNotaryCredentials(process.env);
    await submitForNotarization(dmgPath, credentials);
    await staple(dmgPath);
  }

  const latestDmgPath = path.join(outputDirectory, RELEASE_LATEST_DMG_FILE_NAME);
  fs.copyFileSync(dmgPath, latestDmgPath);
  artifacts.push(latestDmgPath, writeSha256(dmgPath), writeSha256(zipPath));

  return artifacts;
}
