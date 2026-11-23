import path from "node:path";
import type { AppLinkInbox } from "@repo/features/app-links";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { type RunMode, runModeFor } from "@repo/host";
import {
  buildCarriesDeveloperIdSigning,
  resolveAppName,
  resolveInstance,
} from "@repo/host/app-identity";
import { RUN_PROFILE } from "@repo/host/app-state";
import { buildCommit } from "@repo/host/build-commit";
import type { HostReporter } from "@repo/host/effect";
import { type SentryEnvironment, sentryEnvironment } from "@repo/host/sentry-environment";
import type { MenuBarChange } from "./app-menu";
import type { DesktopConfig } from "./services/desktop-config";

/**
 * What the launch reads of Electron's own `app` before anything else exists.
 * It is a seam rather than the module itself for one reason: the order these
 * calls run in is the whole of what this file has to get right, and an order
 * is a value a test can read.
 */
export interface BootstrapApp {
  setName: (name: string) => void;
  getPath: (name: "appData") => string;
  setPath: (name: "userData" | "sessionData", directory: string) => void;
  getVersion: () => string;
  readonly isPackaged: boolean;
}

export interface BootstrapDependencies {
  app: BootstrapApp;
  argv: readonly string[];
  environment: NodeJS.ProcessEnv;
  /** Where this build's own files sit; the entry reads it from its own module. */
  resourceDirectory: string;
  report: HostReporter["report"];
  openExternal: (url: string) => Promise<void>;
  quit: () => void;
  showMenuBar: (change?: MenuBarChange) => void;
  /** The links of ours the system hands the app, heard from module scope, before the launch. */
  appLinks: AppLinkInbox;
  /** Whether this bundle was built for the desktop's end-to-end run (`buildForEndToEnd`). */
  endToEndBuild: boolean;
  /**
   * The crash reporter, begun here rather than inside a service: Electron
   * spawns its GPU process during bootstrap, and the reporter has to stand
   * before a child process it is to file a minidump for. The one ordering it
   * owes is the paths' — it writes its own state under the app's `userData` — so
   * it runs immediately after they move and before anything else exists.
   * It files reports under the environment of the instance this process is.
   */
  initializeCrashReporting: (runMode: RunMode, environment: SentryEnvironment) => void;
}

/**
 * The one host a packaged end-to-end build may be pointed at: the loopback
 * address the suite's local server stands on, so even that build can reach
 * no service but one on the machine it runs on.
 */
const END_TO_END_HOSTNAME = "127.0.0.1";

/**
 * Baked by `build.mjs` from `APP_E2E_BUILD` (`package-config.mjs`'s
 * `e2eBuildDefine`), which a release never sets. Absent under tsx, which
 * reads as no end-to-end build.
 */
declare const PACKAGED_FOR_E2E: boolean | undefined;

/** Whether this bundle was built for the desktop's end-to-end run, the nightly smoke's (`apps/e2e`). */
export function buildForEndToEnd(): boolean {
  try {
    // SAFETY: esbuild replaces this free identifier on every bundle build.
    return PACKAGED_FOR_E2E === true;
  } catch {
    return false;
  }
}

/** Reads one `--name value` argument. */
function argumentValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);

  return index >= 0 ? argv[index + 1] : undefined;
}

/** What a packaged end-to-end build reads from its environment in place of the release's own. */
interface EndToEndOverrides {
  readonly accountBaseUrl?: string;
  readonly stateRoot?: string;
}

/**
 * What a packaged end-to-end build takes from its environment, and nothing
 * else does: the account service on loopback (`APP_ACCOUNT_BASE_URL`) and a
 * state root of the run's own (`APP_STATE_ROOT`), so the smoke stands on a
 * fresh profile against the suite's server. A development run reads the
 * account override on its own terms, and a release reads neither. An origin
 * off loopback is refused rather than read, so this build cannot be sent to
 * a service on the web either.
 */
function endToEndOverrides(
  packaged: boolean,
  endToEndBuild: boolean,
  environment: NodeJS.ProcessEnv,
): EndToEndOverrides {
  if (!packaged || !endToEndBuild) return {};
  const requested = environment.APP_ACCOUNT_BASE_URL;

  const accountBaseUrl =
    requested !== undefined && URL.parse(requested)?.hostname === END_TO_END_HOSTNAME
      ? requested
      : undefined;

  return {
    ...(accountBaseUrl === undefined ? undefined : { accountBaseUrl }),
    ...(environment.APP_STATE_ROOT ? { stateRoot: environment.APP_STATE_ROOT } : undefined),
  };
}

/**
 * Everything the launch has to settle before Electron derives anything from
 * it, in the one order: which instance of the app this process is, where its
 * state lives, and the crash reporter over those paths. What it answers is the
 * config every service below is told, so nothing below reads an Electron global
 * for a fact established here.
 */
export function bootstrapDesktop(dependencies: BootstrapDependencies): DesktopConfig {
  const { app, argv, environment } = dependencies;
  // Which instance of the app this process is decides where its state lives and
  // which Keychain entry protects its credentials; see app-identity.ts for why a
  // development run must never share the release's. Applied before anything
  // derives a path.
  // A named development instance (`run.sh --instance`) answers to a name of
  // its own, so its state, lock, and Keychain entry are its own too.
  const requested = environment.APP_INSTANCE || undefined;
  const instance = resolveInstance({ packaged: app.isPackaged, requested });

  if (!app.isPackaged && requested !== undefined && instance === undefined) {
    dependencies.report(
      `APP_INSTANCE "${requested}" is not an instance name; running as the plain one`,
    );
  }

  const identity = {
    packaged: app.isPackaged,
    developerIdSigned: buildCarriesDeveloperIdSigning(),
  };

  const appName = resolveAppName({ ...identity, instance });
  app.setName(appName);
  const overrides = endToEndOverrides(app.isPackaged, dependencies.endToEndBuild, environment);
  const stateRoot = overrides.stateRoot ?? path.join(app.getPath("appData"), appName);
  app.setPath("userData", stateRoot);
  app.setPath("sessionData", stateRoot);

  const captureOutput = argumentValue(argv, "--capture-evidence");
  const fixtureName = argumentValue(argv, "--fixture");
  const captureMode = captureOutput !== undefined;
  const fixtureMode = captureMode || fixtureName !== undefined;
  const profile = argumentValue(argv, "--profile") ?? RUN_PROFILE.IDLE;
  const runMode = runModeFor({ capture: captureMode, fixture: fixtureName !== undefined });
  dependencies.initializeCrashReporting(runMode, sentryEnvironment(identity));

  const commit = buildCommit();

  // The account service's development override stops at packaging, bar an end-to-end build's loopback one.
  const accountBaseUrl =
    (app.isPackaged ? overrides.accountBaseUrl : environment.APP_ACCOUNT_BASE_URL) ??
    `${LINK_ORIGIN}/api/auth`;

  return {
    stateRoot,
    ...(instance === undefined ? undefined : { instance }),
    runMode,
    appVersion: app.getVersion(),
    ...(commit ? { commit } : undefined),
    packaged: app.isPackaged,
    environment,
    platform: process.platform,
    resourceDirectory: dependencies.resourceDirectory,
    hostedServiceBaseUrl: accountBaseUrl.replace(/\/api\/auth\/?$/, ""),
    launch: {
      captureOutput,
      profile,
      captureMode,
      fixtureMode,
    },
    report: dependencies.report,
    openExternal: dependencies.openExternal,
    quit: dependencies.quit,
    showMenuBar: dependencies.showMenuBar,
    appLinks: dependencies.appLinks,
  };
}
