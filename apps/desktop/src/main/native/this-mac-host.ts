import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVICE_ARCH } from "@repo/features/device-agent-wire";
import { buildCarriesDeveloperIdSigning } from "@repo/host/app-identity";
import { DARWIN_HOST } from "@repo/host/daemon";
import { THIS_MAC_AGENT_STATUS, ThisMacHost, type ThisMacHostSeam } from "@repo/host/effect";
import { Duration, Effect, Layer, Option, Result, Schedule, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { app } from "electron";

/**
 * this-mac-host.ts -- This Mac's host as the host asks it (`@repo/host/effect`'s `ThisMacHost`): the host daemon the app carries in its own bundle, run by the LaunchAgent the bundle holds, registered, unregistered, and read through `SMAppService`; in a build not signed for release, the account install the install script puts under the home.
 *
 * The agent is `Contents/Library/LaunchAgents/dev.vespin.host.plist`
 * (`BUNDLED_HOST` in `scripts/package-layout.mjs`), which Electron's
 * `setLoginItemSettings` and `getLoginItemSettings` reach as an
 * `agentService` by that name: `SMAppService.agent(plistName:)`. Its
 * `register()` bootstraps it at once and at every login, and its
 * `unregister()` terminates it; macOS may hold a registered agent until the
 * member allows it in System Settings › Login Items (`requires-approval`).
 * Its state stays where the daemon keeps it, under the member's own home
 * (`DARWIN_HOST.stateRoot`).
 *
 * Only a build signed for release registers or unregisters the agent, since
 * its plist and the program it names are that build's: a development run,
 * a named instance, and a Test build leave it as it stands and keep the
 * account install instead, which works for any build: the install script
 * the service serves, run with its job enabled, and its own
 * `vespin-host uninstall`.
 *
 * An app update replaces the bundle in place, and a running agent goes on
 * running the program it started from until it is started again, which
 * `register()` on an agent already registered does not do. So the version
 * that registered it is kept in the app's own data, and a launch of another
 * version unregisters it, waits for its daemon to exit, and registers it
 * again. Each installed app has its own data, so a Test build never reads
 * the release's.
 *
 * The one `launchctl` call left is for the job the app ran before it
 * carried the host, `dev.vespin.host.standalone`, which `SMAppService` never
 * registered: before the agent is registered, that job is disabled where
 * its plist stands and booted out where launchd holds it, its files left
 * where they stand, so two daemons never run on
 * one Mac.
 */

/** The agent's plist, by its name under `Contents/Library/LaunchAgents` (`BUNDLED_HOST.plistPath`). */
const SERVICE = { type: "agentService", serviceName: "dev.vespin.host.plist" } as const;

/** The job the account install loaded before the app carried the host (`MAC_LABEL` in the install script), and its plist under the home, which launchd loads at login while the job is enabled. */
const STANDALONE_LABEL = "dev.vespin.host.standalone";
const STANDALONE_PLIST = ["Library", "LaunchAgents", `${STANDALONE_LABEL}.plist`] as const;

/** The launcher inside the bundle, by its path under `Contents` (`BUNDLED_HOST.launcherPath`), which the account install's `vespin-host` command is linked to once the agent is registered. */
const LAUNCHER = ["MacOS", "vespin-host"] as const;

/** The daemon's script inside the bundle, and the arguments the agent's plist starts it with: how its process reads in the process table. */
const DAEMON_RUN = { script: "host/lib/vespin-host.mjs", args: "run --bundled" } as const;

/** Where the app keeps the version that last registered the agent, in its own data. */
const REGISTERED_FILE = "this-mac-host-registered";

/** How long launchctl and ps may take to answer, and how long and how often the agent's daemon is waited on to exit once it was unregistered. */
const ANSWER_WITHIN = Duration.seconds(30);
const EXIT_WITHIN = Duration.seconds(30);
const EXIT_READ_EVERY = Duration.millis(250);

/** How long the account install's script, which downloads a release, and its uninstall may take. */
const INSTALL_WITHIN = Duration.minutes(10);
/** The account install's own command, by the link the install script makes under the home (`LINK` in the install script). */
const INSTALL_COMMAND = [".local", "bin", "vespin-host"] as const;

/** The Mac as its host registers it (`DARWIN_HOST`), on Apple silicon alone. */
const machine = Effect.sync(() => ({
  name: DARWIN_HOST.deviceName(),
  platform: DARWIN_HOST.platform,
  arch: DEVICE_ARCH.ARM64,
  ...DARWIN_HOST.machine(),
}));

/** How the command given exited and what it printed; none where it could not start or did not answer in time. */
const ran = (command: string, args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args]);
      const [out, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
        { concurrency: "unbounded" },
      );
      return { code: Number(code), out };
    }),
  ).pipe(
    Effect.timeoutOption(ANSWER_WITHIN),
    Effect.orElseSucceed(() => Option.none<{ readonly code: number; readonly out: string }>()),
  );

/** What the command given printed where it exited 0; none where it failed, could not start, or did not answer in time. */
const output = (command: string, args: readonly string[]) =>
  Effect.map(
    ran(command, args),
    Option.flatMap((done) => (done.code === 0 ? Option.some(done.out) : Option.none())),
  );

/**
 * The command given run to its end, its input on stdin where it is given
 * some: nothing where it exited 0, or the words it failed with. Note that
 * its input is no terminal, so the account install's commands ask nothing.
 */
const completed = (command: string, args: readonly string[], input?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], {
        stdin: input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(input)),
      });
      const [, said, code] = yield* Effect.all(
        [
          Stream.runDrain(handle.stdout),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return Number(code) === 0
        ? Result.succeed<void>(undefined)
        : Result.fail(said.trim() || `${command} ${args.join(" ")} exited ${Number(code)}`);
    }),
  ).pipe(
    Effect.timeoutOption(INSTALL_WITHIN),
    Effect.map(
      Option.getOrElse(() =>
        Result.fail<string>(`${command} did not answer in ${Duration.format(INSTALL_WITHIN)}`),
      ),
    ),
    Effect.catch((failure) => Effect.succeed(Result.fail(`${command}: ${String(failure)}`))),
  );

interface ThisMacHostFacts {
  /** The app's own data folder, where it keeps the version that registered the agent. */
  readonly stateRoot: string;
  /** This app's version. */
  readonly appVersion: string;
  /** Whether this process runs from a packaged bundle. */
  readonly packaged: boolean;
}

/** The bundled host as This Mac's host, for the user the app runs as. */
function thisMacHost(facts: ThisMacHostFacts): ThisMacHostSeam {
  const standalone = `gui/${process.getuid?.() ?? 0}/${STANDALONE_LABEL}`;
  const registeredFile = path.join(facts.stateRoot, REGISTERED_FILE);
  const daemonRun = `${path.join(process.resourcesPath, DAEMON_RUN.script)} ${DAEMON_RUN.args}`;

  const status = Effect.sync(() => app.getLoginItemSettings(SERVICE).status);

  const standalonePlist = path.join(os.homedir(), ...STANDALONE_PLIST);

  /** Whether launchd holds the standalone job, as `launchctl print` exits; none where launchctl could not be asked, which is never read as not. */
  const standaloneLoaded = Effect.map(
    ran("launchctl", ["print", standalone]),
    Option.map((done) => done.code === 0),
  );

  /**
   * The standalone job kept from running beside the agent: disabled where
   * its plist stands or launchd holds it, so login loads it no more, and
   * booted out where launchd holds it. Note that a bootout of a job launchd
   * holds no longer fails, so it is read past and the job read again.
   */
  const standaloneGone = Effect.gen(function* () {
    const loaded = yield* standaloneLoaded;
    if (Option.isNone(loaded))
      return Result.fail(`could not ask launchd about ${STANDALONE_LABEL}`);
    if (!loaded.value && !existsSync(standalonePlist)) return Result.succeed<void>(undefined);
    const disabled = yield* output("launchctl", ["disable", standalone]);
    if (Option.isNone(disabled)) return Result.fail(`could not disable ${STANDALONE_LABEL}`);
    if (!loaded.value) return Result.succeed<void>(undefined);
    yield* ran("launchctl", ["bootout", standalone]);
    const still = yield* standaloneLoaded;
    return Option.isSome(still) && !still.value
      ? Result.succeed<void>(undefined)
      : Result.fail(`launchd still holds ${STANDALONE_LABEL}`);
  });

  /** Whether the agent's daemon still runs, as the process table lists it; a table that could not be read counts as running. */
  const daemonRuns = Effect.map(output("ps", ["-A", "-o", "command="]), (table) =>
    Option.match(table, {
      onNone: () => true,
      onSome: (lines) => lines.split("\n").some((line) => line.trimEnd().endsWith(daemonRun)),
    }),
  );

  const daemonExited = Effect.repeat(daemonRuns, {
    schedule: Schedule.spaced(EXIT_READ_EVERY),
    until: (runs) => !runs,
  }).pipe(
    Effect.timeoutOption(EXIT_WITHIN),
    Effect.map((exited) =>
      Option.isSome(exited)
        ? Result.succeed<void>(undefined)
        : Result.fail(`its daemon did not exit in ${Duration.format(EXIT_WITHIN)}`),
    ),
  );

  return {
    stateRoot: DARWIN_HOST.stateRoot(os.homedir()),
    home: os.homedir(),
    launcher: path.join(path.dirname(process.resourcesPath), ...LAUNCHER),
    runsHost:
      process.platform === "darwin" &&
      (process.arch === "arm64" || app.runningUnderARM64Translation),
    registers: facts.packaged && buildCarriesDeveloperIdSigning(),
    machine,
    status,
    registeredHere: Effect.sync(() => {
      try {
        return readFileSync(registeredFile, "utf8") === facts.appVersion;
      } catch {
        return false;
      }
    }),
    register: Effect.gen(function* () {
      const gone = yield* standaloneGone;
      if (Result.isFailure(gone)) return gone;
      yield* Effect.sync(() => app.setLoginItemSettings({ ...SERVICE, openAtLogin: true }));
      const now = yield* status;
      if (
        now !== THIS_MAC_AGENT_STATUS.ENABLED &&
        now !== THIS_MAC_AGENT_STATUS.REQUIRES_APPROVAL
      ) {
        return Result.fail(`macOS did not register it: ${now}`);
      }
      // Note that a version that could not be kept only means the next launch registers it again.
      yield* Effect.ignore(Effect.try(() => writeFileSync(registeredFile, facts.appVersion)));
      return Result.succeed<void>(undefined);
    }),
    unregister: Effect.gen(function* () {
      yield* Effect.sync(() => app.setLoginItemSettings({ ...SERVICE, openAtLogin: false }));
      yield* Effect.ignore(Effect.try(() => rmSync(registeredFile, { force: true })));
      const now = yield* status;
      if (
        now === THIS_MAC_AGENT_STATUS.ENABLED ||
        now === THIS_MAC_AGENT_STATUS.REQUIRES_APPROVAL
      ) {
        return Result.fail(`macOS did not unregister it: ${now}`);
      }
      return yield* daemonExited;
    }),
    loaded: Effect.map(standaloneLoaded, (loaded) => Option.getOrElse(loaded, () => false)),
    install: (script) =>
      Effect.flatMap(output("launchctl", ["enable", standalone]), (enabled) =>
        Option.isNone(enabled)
          ? Effect.succeed(Result.fail(`could not enable ${STANDALONE_LABEL}`))
          : completed("/bin/sh", ["-s"], script),
      ),
    // Note that a Mac enrolled whose install never landed has no command and nothing to uninstall.
    uninstall: (keepAgents) =>
      Effect.suspend(() => {
        const command = path.join(os.homedir(), ...INSTALL_COMMAND);
        return existsSync(command)
          ? completed(command, ["uninstall", ...(keepAgents ? ["--keep-agents"] : [])])
          : Effect.succeed(Result.succeed<void>(undefined));
      }),
  };
}

/** This Mac's host for the host: the agent this app's bundle carries, or the account install in a build that does not register it. */
export function thisMacHostLayer(facts: ThisMacHostFacts) {
  return Layer.sync(ThisMacHost, () => thisMacHost(facts));
}
