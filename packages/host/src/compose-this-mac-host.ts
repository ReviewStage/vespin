import { type HostedDeviceAgentClient, OWN_ENROLL_FAILURE } from "@repo/features";
import type { ThisMacHostSetAnswerView } from "@repo/features/agent-view";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { HOST_RELEASE } from "@repo/features/host-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { carried, GATEWAY_EVENT } from "@repo/gateway";
import { EXPERIMENT, type Experiment, type KeepAwake } from "@repo/settings";
import { cappedExponential } from "@repo/wire/effect";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  MutableRef,
  Option,
  type Path,
  PubSub,
  Result,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { ChildProcessSpawner } from "effect/process";
import { type AppThisMacHost, type AppThisMacHosts, NO_KEYS_HELD } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { AGENT_ACTS } from "./contract/index.js";
import { appHostCommandLinked, COMMAND_LINK_OUTCOME } from "./daemon/app-host-command.js";
import { HOST_LEAVE_OUTCOME } from "./daemon/host-leave.js";
import { uninstallBundledHost } from "./daemon/host-uninstall.js";
import { Reporter, THIS_MAC_AGENT_STATUS, ThisMacHost } from "./effect/seams.js";
import type { HostActTable } from "./host-acts.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import {
  type HostDevice,
  hostDeviceMoves,
  readHostDevice,
  removeHostDevice,
  writeHostDevice,
} from "./host-device-record.js";
import type { HostKernel } from "./host-kernel.js";
import { handKeepAwake } from "./keep-awake-record.js";
import { ownedAgents, ownedAgentsMoves } from "./local-agent-state.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-this-mac-host.ts -- This Mac's host, the host daemon the app carries in its bundle, its LaunchAgent registered with macOS while the account has Bring your own host on and unregistered while it has it off.
 *
 * The agent and its registration are the app's (`ThisMacHost`, through
 * `SMAppService`); its state, and the record its host runs on, stand under
 * the member's own home (`ThisMacHost`'s `stateRoot`,
 * `~/.local/state/vespin-host`), so every build of the app reads the same
 * host. Only a build signed for release registers or unregisters the agent
 * (`registers`). Any other, a development run, a named instance, or a Test
 * build, keeps the account install instead, which works for any build:
 * turning This Mac on enrolls it as below, then the loop runs the install
 * script the service serves where launchd holds no account install; turning
 * it off runs the install's own `vespin-host uninstall`, with
 * `--keep-agents` where its agents' folders are kept; and it leaves the
 * host running while Bring your own host is off or nobody is signed in.
 * Where it stands is read at launch
 * and again on every change that could move it: the settings told again (a
 * sign-in, a sign-out, an experiment turned on or off), This Mac turned on
 * or off, and a move in the host's state folder, which its own host writes
 * apart from this app; and it is acted on only when it changed. macOS tells
 * no app when the member allows the agent in System Settings › Login Items,
 * so while it waits on that, its status is read again every
 * `APPROVAL_READ_EVERY` until it moves. Signing out unregisters the agent,
 * which stops the host and keeps it from starting at the next login, where
 * this run read it as the account's while signed in, so a Mac never runs
 * agents for an account no longer signed in; nothing is removed, so signing
 * in again starts the same host on the same record. A run that was never
 * signed in leaves the host alone.
 *
 * This Mac runs agents only where the member turned it on: Settings ›
 * Machines' Run agents on this Mac (`HOSTS_THIS_MAC_SET`), whose switch
 * reads the record itself, on while one of the account's stands unrefused,
 * so there is no setting beside it to agree with. Turning it on enrolls the
 * Mac on the member's own sign-in (`enrollOwn`), under the record's device
 * id where a refused one has it, and under an id minted here where there is
 * none; its record is written where the host reads it, and the agent is
 * registered, which starts the host. Turning it off unregisters the agent,
 * waits for its daemon to exit, and removes the host
 * (`uninstallBundledHost`): the box leaves the account, its agents' folders
 * go unless the member keeps them, and its state goes. A leave the service
 * did not take, and an agent's folder that could not be removed, are
 * answered, so the window says so. Nothing here enrolls a Mac unasked, so a
 * Mac removed from anywhere stays off until it is turned on.
 *
 * With Bring your own host on, a host of the account standing is kept
 * running: its agent registered where macOS holds none, and registered again
 * where another version of the app registered it, since an update replaces
 * the bundle under a running daemon and `register()` does not start an agent
 * already registered. An agent macOS holds for the member's approval is
 * left for them, the windows told (`needsApproval`). With Bring your own host
 * off, a host of the account is unregistered, its state, record and agents'
 * folders kept, so turning it on again starts the same host on the same
 * record. A record the service refused, the host removed from Settings ›
 * Machines anywhere, has its agent unregistered and the host removed, its
 * agents' folders kept, as the account install removes itself, since a
 * bundled host rests rather than removing itself. Once the agent is
 * registered, `~/.local/bin/vespin-host` is moved to the app's launcher
 * where it stands nowhere or links into the account install
 * (`appHostCommandLinked`), so the command a member types reaches the host
 * that runs.
 *
 * A record is the account's where the service lists its device among the
 * account's hosts; another account's, or one enrolled with another service
 * than the app's, as a development build pointed at a Preview would see, is
 * left alone, since there is only one such host on a Mac, and turning This
 * Mac on or off over another account's answers that it is
 * (`anotherAccount`). Note that the Mac is enrolled only where no host of
 * the account stands, because an enroll keys the device again and refuses
 * the secret its host runs on; so once a record stands, a step that failed
 * is tried again by registering again, never by enrolling. A step that failed is tried again after
 * `RETRY`, for as long as what the app keeps the host at stands, and nothing
 * is shown of it: launchd and the host's own setup carry the rest. A Mac the
 * host cannot run on (`ThisMacHost`'s `runsHost`) is never enrolled.
 *
 * How the member keeps this Mac awake (`keep-awake.ts` in `@repo/settings`)
 * is handed to the host on each of those passes, written into its state
 * where it differs from what stands there (`keep-awake-record.ts`), since
 * the host is a process of its own that never reads the app's settings.
 *
 * Which machine this Mac is, the device its record names, and whether its
 * agent waits on the member's approval are told to the windows under the
 * account signed in (`LIVE_READ.THIS_MAC_HOST`) as the host starts, after
 * its own enroll, and on every one of those changes where any of them or
 * the account moved, so a record the host writes as it pairs, or once its
 * secret is refused, reaches them as the state folder's watch hears of it,
 * whether or not a window draws a machine.
 */

/** How long the host's state folder stays still before it is read again, so a write of several steps is read once, whole. */
const SETTLE = Duration.millis(200);

/** How often an agent macOS holds for the member's approval has its status read again, since nothing tells the app it was allowed. */
const APPROVAL_READ_EVERY = Duration.seconds(3);

/** How soon a step that failed is tried again: from `FIRST`, twice as long each time, never longer than `LONGEST`. */
const RETRY_AFTER = {
  FIRST: Duration.seconds(10),
  LONGEST: Duration.hours(1),
} as const;

const RETRY = cappedExponential(RETRY_AFTER.FIRST, RETRY_AFTER.LONGEST);

/** The words a removal failed with, as a person reads them: its error's message, without a stack. */
function failedWords(cause: Cause.Cause<unknown>): string {
  const failure = Cause.squash(cause);

  return failure instanceof Error ? failure.message : String(failure);
}

/** What the app keeps This Mac's host at for the account signed in, and how many times it was turned on; stopped, with no account, where nobody is signed in; none where it keeps it at nothing, and leaves it as it stands. */
type Kept =
  | { readonly userId: string; readonly running: boolean; readonly turns: number }
  | typeof SIGNED_OUT
  | undefined;

/** What the app keeps This Mac's host at while nobody is signed in. */
const SIGNED_OUT = { userId: undefined, running: false, turns: 0 } as const;

const sameKept = (one: Kept, other: Kept) =>
  one?.userId === other?.userId && one?.running === other?.running && one?.turns === other?.turns;

/** Whether two reads of This Mac name the same device and machine, and stand the same. */
const sameThisMac = (one: AppThisMacHost, other: AppThisMacHost) =>
  one.deviceId === other.deviceId &&
  one.machineId === other.machineId &&
  one.enrolled === other.enrolled &&
  one.agentFolders === other.agentFolders &&
  one.needsApproval === other.needsApproval &&
  one.setupFailed === other.setupFailed;

/** What turning This Mac on or off answers: done, or that it could not be. */
const DONE = { done: true } as const satisfies ThisMacHostSetAnswerView;

const UNDONE = {
  failure: AGENT_CALL_FAILURE.UNANSWERED,
} as const satisfies ThisMacHostSetAnswerView;

/** What turning This Mac on or off answers where its host is another account's, which only that account, or an uninstall on this Mac, may remove. */
const ANOTHER_ACCOUNTS = {
  failure: AGENT_CALL_FAILURE.NOT_FOUND,
  anotherAccount: true,
} as const satisfies ThisMacHostSetAnswerView;

export interface ThisMacHostDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "createId" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
  /** Whether the account signed in has the experiment given on, as the settings hold it now. */
  experimentOn: (experiment: Experiment) => Effect.Effect<boolean>;
  /** How the member keeps this Mac awake, as the settings hold it now, which the host is handed in its state. */
  keepAwake: Effect.Effect<KeepAwake>;
  /** A pulse each time the settings are told again, which a sign-in, a sign-out, and an experiment turned on or off each do, subscribed as it is yielded. */
  settingsTold: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
  /** Whether the service lists the device given among the account's hosts; none where it could not answer. */
  hostListed: (
    deviceId: string,
  ) => Effect.Effect<Option.Option<boolean>, never, HttpClient.HttpClient>;
  client: Pick<HostedDeviceAgentClient, "enrollOwn">;
}

type ThisMacHostServices =
  | Reporter
  | ThisMacHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

/** The one act This Mac's host answers, asked only to turn it on or off. */
type ThisMacHostActs = Pick<typeof AGENT_ACTS, "HOSTS_THIS_MAC_SET">;

export interface ThisMacHostComposer extends Composer {
  /** Run agents on this Mac turned on or off, as the panel's port asks it. */
  readonly acts: HostActTable<ThisMacHostActs>;
}

export function composeThisMacHost(
  dependencies: ThisMacHostDependencies,
): Effect.Effect<ThisMacHostComposer, never, ThisMacHostServices> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const host = yield* ThisMacHost;
    const services = yield* Effect.context<ThisMacHostServices>();
    const { kernel, account, client } = dependencies;
    const serviceOrigin = new URL(kernel.hostedServiceBaseUrl).origin;

    /** Whether the record was enrolled with this app's service; one enrolled with another is left alone. */
    const ownService = (record: HostDevice) =>
      URL.canParse(record.serviceOrigin) && new URL(record.serviceOrigin).origin === serviceOrigin;

    const ownServiceRecord = Effect.map(readHostDevice(host.stateRoot), Option.filter(ownService));

    // Note that which machine this is never changes, so it is read once, as This Mac is first told.
    const machineId = yield* Effect.cached(
      Effect.map(host.machine, (machine) => machine.machineId),
    );

    /** Whether the last try at keeping the host running failed starting it, until one lands. */
    const keepFailed = MutableRef.make(false);

    /** Whether the try under way reached a step that starts the host, past the reads before it. */
    const starting = MutableRef.make(false);

    /** This Mac as the windows draw it: which machine it is, the device its record names, where it was enrolled with this app's service, whether it stands unrefused, how many agents' folders its host made, whether its agent waits on the member's approval, and whether the app could not start its host. */
    const read = Effect.map(
      Effect.all([ownServiceRecord, machineId, ownedAgents(host.stateRoot), host.status]),
      ([record, id, folders, status]): AppThisMacHost => ({
        ...(Option.isSome(record) ? { deviceId: record.value.deviceId } : undefined),
        ...(id === undefined ? undefined : { machineId: id }),
        enrolled: Option.isSome(record) && record.value.refused !== true,
        agentFolders: folders.length,
        needsApproval: status === THIS_MAC_AGENT_STATUS.REQUIRES_APPROVAL,
        setupFailed: MutableRef.get(keepFailed),
      }),
    );

    /** This Mac as last told the windows, and the account it was told under; none before the first. */
    let told: { readonly userId: string | undefined; readonly thisMac: AppThisMacHost } | undefined;

    /** This Mac told the windows under the account signed in, where it or the account moved since it was last told; nothing is held while nobody is signed in. */
    const tellThisMac = Effect.gen(function* () {
      const userId = dependencies.accountId();
      const thisMac = yield* read;

      if (told !== undefined && told.userId === userId && sameThisMac(told.thisMac, thisMac))
        return;
      told = { userId, thisMac };

      const held: AppThisMacHosts =
        userId === undefined ? NO_KEYS_HELD : { [userId]: { rows: thisMac } };

      kernel.emit(GATEWAY_EVENT.THIS_MAC_HOST_CHANGED, carried(held));
    });

    /** The device this run last read as the account's while signed in, so a sign-out after it is the sign-out of that host's own account; none where the last read was not. */
    const ownedHere = MutableRef.make<string | undefined>(undefined);

    /** Whether the record's device is the account's, as the service lists its hosts; the answer kept as read here. */
    const accountOwns = (record: HostDevice) =>
      Effect.flatMap(dependencies.hostListed(record.deviceId), (listed) => {
        if (Option.isNone(listed)) return Effect.fail("read the account's hosts");
        MutableRef.set(ownedHere, listed.value ? record.deviceId : undefined);

        return Effect.succeed(listed.value);
      });

    /**
     * The Mac enrolled under the device id given, or one minted, on the
     * version of the release the script installs, and its record written;
     * whether it was, false where the id is another account's. Note that it
     * runs whole once begun, since the service answers the secret once.
     */
    const enrolled = (kept: Option.Option<string>, version: string) =>
      Effect.gen(function* () {
        const deviceId = Option.getOrElse(kept, kernel.createId);

        const outcome = yield* client
          .enrollOwn(deviceId, yield* host.machine)
          .pipe(
            Effect.updateService(
              HttpClient.HttpClient,
              HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, version)),
            ),
          );

        if ("failure" in outcome) {
          if (outcome.failure === OWN_ENROLL_FAILURE.NOT_FOUND) return false;

          return yield* Effect.fail("enroll it");
        }

        yield* writeHostDevice(host.stateRoot, {
          deviceId,
          deviceSecret: outcome.deviceSecret,
          serviceOrigin,
        }).pipe(Effect.mapError(() => "save its record"));
        report("this Mac's host was enrolled");
        yield* tellThisMac;

        return true;
      }).pipe(Effect.uninterruptible);

    /** `~/.local/bin/vespin-host` moved to the app's launcher, where it stands nowhere or links into the account install; one that could not be is said, and tried again at the next register. */
    const commandLinked = appHostCommandLinked({ home: host.home, launcher: host.launcher }).pipe(
      Effect.flatMap((outcome) =>
        outcome === COMMAND_LINK_OUTCOME.LINKED
          ? Effect.sync(() => report("vespin-host now runs this Mac's host"))
          : Effect.void,
      ),
      Effect.catch((failure) =>
        Effect.sync(() =>
          report(`this Mac's host: could not link vespin-host: ${failure.message}`),
        ),
      ),
    );

    /** The agent registered, which starts the host on the record it stands on, and the command a member types moved to it. */
    const registered = Effect.gen(function* () {
      const done = yield* host.register;

      if (Result.isFailure(done)) return yield* Effect.fail(`register it: ${done.failure}`);
      report("this Mac's host was registered");
      yield* commandLinked;
      // Note that macOS may hold the agent for the member's approval, which nothing else would tell the windows.
      yield* tellThisMac;
    });

    /** The agent unregistered, which stops the host, once its daemon has exited. */
    const unregistered = Effect.gen(function* () {
      const done = yield* host.unregister;

      if (Result.isFailure(done)) return yield* Effect.fail(`unregister it: ${done.failure}`);
    });

    /** The account install's host removed by its own `vespin-host uninstall`, and the record removed where no install was there to remove it. */
    const uninstalled = (removeAgentFolders: boolean) =>
      Effect.gen(function* () {
        const done = yield* host.uninstall(!removeAgentFolders);

        if (Result.isFailure(done)) return yield* Effect.fail(new Error(done.failure));
        yield* removeHostDevice(host.stateRoot);

        return HOST_LEAVE_OUTCOME.LEFT;
      });

    /** The host removed from the account and this Mac as the input asks: the bundled host, its agent unregistered first so no daemon writes its state as it goes (`uninstallBundledHost`), or the account install where this build does not register. */
    const removed = (removeAgentFolders: boolean) =>
      host.registers
        ? Effect.andThen(
            unregistered,
            Effect.exit(
              uninstallBundledHost({
                stateRoot: host.stateRoot,
                home: host.home,
                version: HOST_RELEASE?.VERSION ?? "0.0.0",
                removeAgentFolders,
              }),
            ),
          )
        : Effect.exit(uninstalled(removeAgentFolders));

    /** A record the service refused: its agent unregistered and the host removed, its agents' folders kept, as the account install removes itself (`uninstall --keep-agents`). */
    const removedRefused = Effect.gen(function* () {
      const exit = yield* removed(false);

      if (Exit.isFailure(exit)) {
        return yield* Effect.fail(`remove it: ${failedWords(exit.cause)}`);
      }

      report("this Mac's host was removed, as the service refused it");
    });

    // Note that keeping the host running and turning This Mac off take turns, so a register under way finishes before an unregister begins, and one asked after reads the record the removal left.
    const oneAtATime = (yield* Semaphore.make(1)).withPermits(1);

    /** The account's record as the keep acts on it: none where nothing of the account's stands, after a refused one is removed. */
    const standing = Effect.gen(function* () {
      const record = yield* ownServiceRecord;

      if (Option.isNone(record)) return Option.none<HostDevice>();

      if (record.value.refused === true) {
        yield* removedRefused;

        return Option.none<HostDevice>();
      }

      return (yield* accountOwns(record.value)) ? record : Option.none<HostDevice>();
    });

    /** The install script the service serves, run: the account install's release installed or upgraded and its host started. */
    const installed = Effect.gen(function* () {
      const script = yield* HttpClient.get(
        new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, serviceOrigin).href,
      ).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
        Effect.mapError(() => "read its install script"),
      );

      const ran = yield* host.install(script);

      if (Result.isFailure(ran)) return yield* Effect.fail(`install it: ${ran.failure}`);
      report("this Mac's host was installed and started");
    });

    /** The account's host running where it stands: its agent registered where macOS holds none, or where another version of the app registered it, or, where this build does not register, the install script run where launchd holds no account install; nothing is enrolled here, since only turning This Mac on enrolls it. */
    const keepRunning = oneAtATime(
      Effect.gen(function* () {
        MutableRef.set(starting, false);

        if (HOST_RELEASE === undefined || !host.runsHost) return;

        if (Option.isNone(yield* standing)) return;
        // Note that only a step that starts the host fails it on the windows' row, never a read before it.
        MutableRef.set(starting, true);

        if (!host.registers) {
          if (!(yield* host.loaded)) yield* installed;

          return;
        }

        const status = yield* host.status;

        // Note that an agent macOS holds for approval is left for the member, whose allowing it starts the bundle as it stands.
        if (status === THIS_MAC_AGENT_STATUS.REQUIRES_APPROVAL) return;

        if (status === THIS_MAC_AGENT_STATUS.ENABLED) {
          if (yield* host.registeredHere) return;
          yield* unregistered;
        }

        yield* registered;
      }),
    );

    /** How many times This Mac was turned on, which the loop reads so a turn on is kept running, its agent registered after its enroll. */
    const turns = MutableRef.make(0);

    /** A pulse each time This Mac was turned on or off, so the loop reads it again at once. */
    const turned = yield* PubSub.sliding<void>(1);

    /** This Mac turned on: enrolled where none of the account's stands unrefused, never over another account's standing host, which is answered as that; done where it is on. */
    const turnedOn = oneAtATime(
      Effect.gen(function* () {
        if (HOST_RELEASE === undefined || !host.runsHost) return UNDONE;
        const record = yield* readHostDevice(host.stateRoot);

        if (Option.isSome(record) && !ownService(record.value)) return UNDONE;

        if (Option.isSome(record) && record.value.refused !== true) {
          return (yield* accountOwns(record.value)) ? DONE : ANOTHER_ACCOUNTS;
        }

        const deviceId = Option.map(record, (kept) => kept.deviceId);

        if (!(yield* enrolled(deviceId, HOST_RELEASE.VERSION))) return UNDONE;
        MutableRef.update(turns, (count) => count + 1);

        return DONE;
      }),
    ).pipe(
      Effect.catch((step) =>
        Effect.sync(() => {
          report(`this Mac's host: could not ${step}`);

          return UNDONE;
        }),
      ),
    );

    /**
     * This Mac turned off, its agents' folders deleted or kept as asked: its
     * agent unregistered and the host removed, which takes it out of the
     * account and off this Mac. Never another account's host, nor one
     * another service enrolled. Done where the host's state is gone, with
     * what of the removal did not land: a leave the service did not take,
     * so the account may still list it, and an agent's folder that could
     * not be removed; undone where its state stands.
     */
    const turnedOff = (deleteFolders: boolean) =>
      oneAtATime(
        Effect.gen(function* () {
          if (!host.runsHost) return UNDONE;
          const device = yield* readHostDevice(host.stateRoot);

          if (Option.isSome(device) && !ownService(device.value)) return UNDONE;
          const record = Option.filter(device, (kept) => kept.refused !== true);

          if (Option.isSome(record) && !(yield* accountOwns(record.value))) return ANOTHER_ACCOUNTS;
          const exit = yield* removed(deleteFolders);

          if (Exit.isSuccess(exit)) {
            report("this Mac's host was removed");

            return exit.value === HOST_LEAVE_OUTCOME.UNANSWERED
              ? { ...DONE, stillListed: true as const }
              : DONE;
          }

          const words = failedWords(exit.cause);

          // Note that the state goes even where an agent's folder stood, so a record still standing is what tells a removal that did not land.
          if (Option.isSome(yield* readHostDevice(host.stateRoot))) {
            report(`this Mac's host could not be removed: ${words}`);

            return UNDONE;
          }

          report(`this Mac's host was removed, but an agent's folder was not: ${words}`);

          return { ...DONE, folderLeft: words };
        }),
      ).pipe(
        Effect.catch((step) =>
          Effect.sync(() => {
            report(`this Mac's host: could not ${step}`);

            return UNDONE;
          }),
        ),
      );

    /** The account's host unregistered, which stops it and keeps it from starting at the next login, its files kept. */
    const keepStopped = oneAtATime(
      Effect.gen(function* () {
        if (!host.runsHost || !host.registers) return;

        if (Option.isNone(yield* standing)) return;
        const status = yield* host.status;

        if (status === THIS_MAC_AGENT_STATUS.NOT_REGISTERED) return;

        if (status === THIS_MAC_AGENT_STATUS.NOT_FOUND) return;
        yield* unregistered;
        report("this Mac's host was stopped");
      }),
    );

    /**
     * The agent unregistered, which stops the host and keeps it from
     * starting at the next login, once its account signed out, its files
     * kept. Note that no account can be asked whether it owns the record
     * once nobody is signed in, so only a host this run read as the
     * account's, under the device it read, is stopped; a refused one already
     * rests, and a build that does not register leaves it as it stands.
     */
    const stoppedSignedOut = oneAtATime(
      Effect.gen(function* () {
        const owned = MutableRef.get(ownedHere);

        if (!host.runsHost || !host.registers || owned === undefined) return;
        const record = yield* ownServiceRecord;

        if (Option.isNone(record) || record.value.refused === true) return;

        if (record.value.deviceId !== owned) return;
        const status = yield* host.status;

        if (status === THIS_MAC_AGENT_STATUS.NOT_REGISTERED) return;

        if (status === THIS_MAC_AGENT_STATUS.NOT_FOUND) return;
        yield* unregistered;
        MutableRef.set(ownedHere, undefined);
        report("this Mac's host was stopped, since its account signed out");
      }),
    );

    /** What the app keeps the host at now, as the account and its experiments stand. */
    const keptNow: Effect.Effect<Kept> = Effect.gen(function* () {
      if (!kernel.runMode.sendsNetwork) return undefined;
      const userId = dependencies.accountId();

      if (userId === undefined) return SIGNED_OUT;

      if (!account.capabilitiesActive()) return undefined;

      return {
        userId,
        running: yield* dependencies.experimentOn(EXPERIMENT.BRING_YOUR_OWN_HOST),
        turns: MutableRef.get(turns),
      };
    });

    /** The host kept as asked, each step that failed tried again after `RETRY` until it lands. */
    const keep = (kept: Kept) =>
      kept === undefined
        ? Effect.void
        : (kept.userId === undefined
            ? stoppedSignedOut
            : kept.running
              ? keepRunning
              : keepStopped
          ).pipe(
            Effect.tapError((step) =>
              Effect.andThen(
                Effect.sync(() => {
                  report(`this Mac's host: could not ${step}, so it is tried again`);
                  MutableRef.set(keepFailed, kept.running && MutableRef.get(starting));
                }),
                tellThisMac,
              ),
            ),
            Effect.retry(RETRY),
            Effect.andThen(Effect.sync(() => MutableRef.set(keepFailed, false))),
            Effect.andThen(tellThisMac),
            Effect.catchDefect(() =>
              Effect.sync(() => report("this Mac's host could not be kept as asked")),
            ),
          );

    /** How the member keeps this Mac awake handed to its host, where it is installed; one that cannot be written is handed again at the next change. */
    const keepAwakeHanded = Effect.flatMap(dependencies.keepAwake, (choice) =>
      Effect.ignore(handKeepAwake(host.stateRoot, choice)),
    );

    // Note that the in-process changes are subscribed before the first read, so one that lands while it reads is read again after it.
    // A change interrupts the keep under way, but for an enroll begun, which runs whole; This Mac is told on every pass.
    const lifetime = Effect.gen(function* () {
      const settingsTold = yield* dependencies.settingsTold;
      const turnedOnOrOff = Stream.fromSubscription(yield* PubSub.subscribe(turned));

      const stateMoved = Stream.merge(
        hostDeviceMoves(host.stateRoot),
        ownedAgentsMoves(host.stateRoot),
      ).pipe(Stream.debounce(SETTLE));

      const awaitingApproval = Stream.tick(APPROVAL_READ_EVERY).pipe(
        Stream.filter(() => told?.thisMac.needsApproval === true),
      );

      const changed = Stream.mergeAll([settingsTold, turnedOnOrOff, stateMoved, awaitingApproval], {
        concurrency: "unbounded",
      });

      yield* Effect.forkScoped(
        Stream.concat(Stream.succeed(undefined), changed).pipe(
          Stream.mapEffect(() =>
            Effect.andThen(Effect.andThen(keepAwakeHanded, tellThisMac), keptNow),
          ),
          Stream.changesWith(sameKept),
          Stream.switchMap((kept) => Stream.fromEffectDrain(keep(kept))),
          Stream.runDrain,
          Effect.provideContext(services),
        ),
      );
    });

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.THIS_MAC_HOST> = {};

    const acts: HostActTable<ThisMacHostActs> = {
      /** Run agents on this Mac turned on or off; done, or that it could not be, its windows told where it now stands. */
      HOSTS_THIS_MAC_SET: ({ on, deleteFolders }) =>
        Effect.gen(function* () {
          const answer = on ? yield* turnedOn : yield* turnedOff(deleteFolders ?? true);
          yield* tellThisMac;
          yield* PubSub.publish(turned, undefined);

          return answer;
        }).pipe(Effect.provideContext(services)),
    };

    return { methods, acts, lifetime: Effect.asVoid(lifetime) } satisfies ThisMacHostComposer;
  });
}
