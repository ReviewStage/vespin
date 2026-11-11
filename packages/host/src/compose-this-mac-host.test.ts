/**
 * compose-this-mac-host.test.ts -- This Mac's host kept as the member and the account's experiments say: nothing enrolled until This Mac is turned on, then enrolled under a new id, its record written and its agent registered; turned off by unregistering its agent and removing the host; a record of the account's kept under its id, never enrolled again while it stands, registered again after an app update; a build that does not register running the install script and the install's own uninstall in their place; an agent macOS holds for approval left for the member and told the windows; a refused record removed; the agent unregistered with its files kept where Bring your own host is off or its account signs out, and left alone by a run never signed in; how the member keeps this Mac awake handed to the host; a record that is not the account's left alone; and This Mac told the windows as its record moves.
 *
 * The composer runs over a real state folder of its own, a fake service
 * that enrolls the Mac, lists the account's hosts, serves the install
 * script, and takes a host's leave, and a fake `SMAppService` and account
 * install that say what they were asked and hold the agent's status, on the test's clock; the state folder is watched as the
 * app watches it, and the settings are told again by the test. Synthetic
 * ids and secrets throughout.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH, type OwnEnrollOutcome } from "@repo/features";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { HOST_RELEASE } from "@repo/features/host-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { GATEWAY_EVENT } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { EXPERIMENT, type Experiment, KEEP_AWAKE, type KeepAwake } from "@repo/settings";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Duration, Effect, Layer, Option, PubSub, Result, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { systemError } from "effect/PlatformError";
import { TestClock } from "effect/testing";
import type { AppThisMacHost, AppThisMacHosts } from "./app-state.js";
import { composeThisMacHost } from "./compose-this-mac-host.js";
import {
  reporterLayer,
  THIS_MAC_AGENT_STATUS,
  type ThisMacAgentStatus,
  ThisMacHost,
} from "./effect/seams.js";
import { type HostDevice, readHostDevice, writeHostDevice } from "./host-device-record.js";
import { readKeepAwake } from "./keep-awake-record.js";
import { keepOwnedAgent } from "./local-agent-state.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const USER_ID = "user-fixture";
const MINTED_ID = "5f0c7a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const KEPT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MACHINE_ID = "e".repeat(64);
const SERVICE = "https://app.test";
const SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"c".repeat(43)}`;
const OLD_SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"d".repeat(43)}`;
const AGENT_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
/** Where the fake service takes an enroll, so its responder reads the version the enroll carried, and a host's leave. */
const ENROLL_URL = `${SERVICE}/enroll`;
const LEAVE_URL = `${SERVICE}${HOSTED_SERVICE_PATH.DEVICE_AGENT_LEAVE}`;
/** The install script the fake service serves, and where. */
const INSTALL_URL = `${SERVICE}${HOST_WIRE.INSTALL_SCRIPT_PATH}`;
const INSTALL_SCRIPT = "echo install fixture";
const FILES = Layer.merge(NodeFileSystem.layer, NodePath.layer);
/** The desktop's own window, as the Gateway hands a method its caller. */

const BRING_YOUR_OWN_HOST_ON = {
  [EXPERIMENT.BRING_YOUR_OWN_HOST]: true,
};

interface MacOptions {
  /** Whether an account is signed in as the composer starts; one is by default. */
  readonly signedIn?: boolean;
  /** The experiments the account has on; Bring your own host by default. */
  readonly experiments?: Partial<Record<Experiment, boolean>>;
  /** The devices the service lists among the account's hosts, beside each it enrolls. */
  readonly listed?: readonly string[];
  /** Where macOS stands on the agent as the app launches; not registered by default. */
  readonly status?: ThisMacAgentStatus;
  /** Whether this app's own version registered the agent; it did by default. */
  readonly registeredHere?: boolean;
  /** Whether macOS holds the agent for the member's approval once it is registered. */
  readonly heldForApproval?: boolean;
  /** How many registers fail before one lands. */
  readonly failedRegisters?: number;
  /** Whether this build registers the agent; a signed release's does by default. */
  readonly registers?: boolean;
  /** Whether the service takes a host's leave; it does by default. */
  readonly leaveTaken?: boolean;
  /** An agent's folder whose removal fails, as one the member's own permissions lock. */
  readonly lockedFolder?: string;
}

/** The clock nudged, and the state folder's reads and writes, which wait on no clock, let land, until the condition holds. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 20_000 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }
    assert.ok(holds(), "the composer never got there");
  });

/** The clock nudged, and the state folder's reads and writes let land, for the time given. */
const nudged = (time: Duration.Input) =>
  Effect.gen(function* () {
    const rounds = Duration.toMillis(time) / 100;
    for (let round = 0; round < rounds; round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }
  });

/**
 * This Mac's host composed over a state folder of its own, with what each
 * fake was asked, in the order it was asked: the service's enrolls, by the
 * device id and the version they carried, and leaves, and the agent's
 * registers and unregisters; and This Mac as the windows were last told it,
 * under the account.
 */
const thisMac = (stateRoot: string, options: MacOptions = {}) =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const enrolled: { deviceId: string; version: string | null }[] = [];
    let failedRegisters = options.failedRegisters ?? 0;
    let status = options.status ?? THIS_MAC_AGENT_STATUS.NOT_REGISTERED;
    let registeredHere = options.registeredHere ?? true;
    let loaded = false;
    const scripts: string[] = [];
    const experiments: Partial<Record<Experiment, boolean>> = {
      ...(options.experiments ?? BRING_YOUR_OWN_HOST_ON),
    };
    const settingsTold = yield* PubSub.unbounded<void>();
    const listed = new Set(options.listed ?? []);
    let version: string | null = null;
    let told: AppThisMacHosts | undefined;
    let keepAwake: KeepAwake = KEEP_AWAKE.WORKING;
    let userId: string | undefined = options.signedIn === false ? undefined : USER_ID;
    const client = {
      enrollOwn: (deviceId: string) =>
        HttpClient.get(ENROLL_URL).pipe(
          Effect.orDie,
          Effect.map((): OwnEnrollOutcome => {
            enrolled.push({ deviceId, version });
            asked.push("enroll");
            listed.add(deviceId);
            return { deviceId, deviceSecret: SECRET };
          }),
        ),
    };
    const files = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fileSystem) => ({
        ...fileSystem,
        remove: (path: string, removing?: Parameters<typeof fileSystem.remove>[1]) =>
          path === options.lockedFolder
            ? Effect.fail(
                systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: path,
                }),
              )
            : fileSystem.remove(path, removing),
      })),
    ).pipe(Layer.provide(NodeFileSystem.layer));
    const composer = yield* composeThisMacHost({
      kernel: {
        hostedServiceBaseUrl: SERVICE,
        createId: () => MINTED_ID,
        emit: (kind, payload) => {
          // SAFETY: what the composer tells on this event is the windows' This Mac, built as `AppThisMacHosts`.
          if (kind === GATEWAY_EVENT.THIS_MAC_HOST_CHANGED) told = payload as AppThisMacHosts;
        },
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => userId,
      experimentOn: (experiment) => Effect.succeed(experiments[experiment] === true),
      settingsTold: Effect.map(PubSub.subscribe(settingsTold), Stream.fromSubscription),
      keepAwake: Effect.sync(() => keepAwake),
      hostListed: (deviceId) => Effect.succeed(Option.some(listed.has(deviceId))),
      client,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          files,
          NodePath.layer,
          scriptedSpawner(() => undefined).layer,
          fakeHttpClientLayer((url, init) => {
            if (url === ENROLL_URL) {
              version = new Headers(init.headers).get(HOST_WIRE.VERSION_HEADER);
              return new Response("{}");
            }
            if (url === INSTALL_URL) return new Response(INSTALL_SCRIPT);
            assert.equal(url, LEAVE_URL);
            asked.push("leave");
            return options.leaveTaken === false
              ? new Response("{}", { status: 503 })
              : Response.json({ done: true });
          }),
          reporterLayer(() => undefined),
          Layer.succeed(ThisMacHost, {
            stateRoot,
            home: homeOf(stateRoot),
            launcher: launcherOf(stateRoot),
            runsHost: true,
            registers: options.registers ?? true,
            machine: Effect.succeed({
              name: "Studio",
              platform: DEVICE_PLATFORM.DARWIN,
              arch: DEVICE_ARCH.ARM64,
              machineId: MACHINE_ID,
            }),
            status: Effect.sync(() => status),
            registeredHere: Effect.sync(() => registeredHere),
            register: Effect.sync(() => {
              asked.push("register");
              if (failedRegisters > 0) {
                failedRegisters -= 1;
                return Result.fail("macOS did not register it: not-registered");
              }
              status =
                options.heldForApproval === true
                  ? THIS_MAC_AGENT_STATUS.REQUIRES_APPROVAL
                  : THIS_MAC_AGENT_STATUS.ENABLED;
              registeredHere = true;
              return Result.succeed(undefined);
            }),
            unregister: Effect.sync(() => {
              asked.push("unregister");
              status = THIS_MAC_AGENT_STATUS.NOT_REGISTERED;
              return Result.succeed(undefined);
            }),
            loaded: Effect.sync(() => loaded),
            install: (script) =>
              Effect.sync(() => {
                asked.push("install");
                scripts.push(script);
                loaded = true;
                return Result.succeed(undefined);
              }),
            uninstall: (keepAgents) =>
              Effect.sync(() => {
                asked.push(keepAgents ? "uninstall --keep-agents" : "uninstall");
                loaded = false;
                return Result.succeed(undefined);
              }),
          }),
        ),
      ),
    );
    yield* composer.lifetime;
    const held = (): AppThisMacHost | undefined => told?.[USER_ID]?.rows;
    /** Run agents on this Mac turned on or off, as its switch turns it; what it answered. */
    const turn = (on: boolean, deleteFolders?: boolean) =>
      composer.acts.HOSTS_THIS_MAC_SET(
        deleteFolders === undefined ? { on } : { on, deleteFolders },
      );
    /** The experiment given turned on or off, and the settings told again, as a switch in Settings does. */
    const flip = (experiment: Experiment, on: boolean) =>
      Effect.suspend(() => {
        experiments[experiment] = on;
        return PubSub.publish(settingsTold, undefined);
      });
    /** The member allowing the agent in Login Items, which tells the app nothing. */
    const allow = () => {
      status = THIS_MAC_AGENT_STATUS.ENABLED;
    };
    /** Keep this Mac awake chosen, and the settings told again, as its menu in Settings does. */
    const keepAwakeChosen = (choice: KeepAwake) =>
      Effect.suspend(() => {
        keepAwake = choice;
        return PubSub.publish(settingsTold, undefined);
      });
    /** The account signed out, and the settings told again, as a sign-out does. */
    const signOut = Effect.suspend(() => {
      userId = undefined;
      return PubSub.publish(settingsTold, undefined);
    });
    return { asked, enrolled, scripts, held, turn, flip, allow, keepAwakeChosen, signOut };
  });

/** A state folder of the test's own, standing empty beside the home its host runs with (`homeOf`), which a removal of the host deletes. */
const freshState = Effect.gen(function* () {
  const stateRoot = join(yield* temporaryDirectoryScoped("this-mac-"), "state");
  yield* (yield* FileSystem.FileSystem).makeDirectory(stateRoot);
  return stateRoot;
});

/** The home the host runs with, beside its state folder. */
const homeOf = (stateRoot: string) => join(dirname(stateRoot), "home");

/** The launcher inside the app, which `~/.local/bin/vespin-host` is linked to once the agent is registered. */
const launcherOf = (stateRoot: string) =>
  join(dirname(stateRoot), "Vespin.app", "Contents", "MacOS", "vespin-host");

/** An agent's folder the host made, under its home. */
const agentFolderOf = (stateRoot: string) => join(homeOf(stateRoot), ".vespin", "agents", AGENT_ID);

/** The state folder with the record given written, as the host would have left it. */
const recorded = (record: HostDevice) =>
  Effect.gen(function* () {
    const stateRoot = yield* freshState;
    yield* writeHostDevice(stateRoot, record);
    return stateRoot;
  });

/** The account's standing record, as its host left it. */
const STANDING = { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE } as const;

/** What turning This Mac on or off answers over another account's host. */
const ANOTHER_ACCOUNTS = { failure: "not-found", anotherAccount: true } as const;

/** What This Mac reads as with no record, as the windows draw it. */
const UNENROLLED = {
  machineId: MACHINE_ID,
  enrolled: false,
  agentFolders: 0,
  needsApproval: false,
  setupFailed: false,
} as const;

it.effect.each([
  { case: "its agent registered", registers: true, started: ["enroll", "register"] },
  {
    case: "the install script run, where this build does not register the agent",
    registers: false,
    started: ["enroll", "install"],
  },
] as const)(
  "a Mac with no record runs nothing until it is turned on, then is enrolled under a new id on the release's version, its record written, and $case",
  ({ registers, started }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* freshState;
        const mac = yield* thisMac(stateRoot, { registers });
        yield* until(() => mac.held() !== undefined);
        yield* nudged(Duration.minutes(1));
        assert.equal(mac.asked.length, 0, "nothing is enrolled unasked");
        assert.deepEqual(mac.held(), UNENROLLED);

        assert.deepEqual(yield* mac.turn(true), { done: true });
        yield* until(() => mac.asked.length >= 2);
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(mac.asked, started);
        assert.deepEqual(mac.scripts, registers ? [] : [INSTALL_SCRIPT]);
        assert.deepEqual(mac.enrolled, [{ deviceId: MINTED_ID, version: HOST_RELEASE?.VERSION }]);
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), {
          deviceId: MINTED_ID,
          deviceSecret: SECRET,
          serviceOrigin: SERVICE,
        });
        const fileSystem = yield* FileSystem.FileSystem;
        const mode = (yield* fileSystem.stat(join(stateRoot, "device.json"))).mode & 0o777;
        assert.equal(mode, 0o600, "the record is readable by its owner alone");
        assert.deepEqual(mac.held(), { ...UNENROLLED, deviceId: MINTED_ID, enrolled: true });
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "how the member keeps this Mac awake reaches the host's state as the settings are told again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(STANDING);
        const mac = yield* thisMac(stateRoot, { experiments: {} });
        yield* until(() => mac.held() !== undefined);

        yield* mac.keepAwakeChosen(KEEP_AWAKE.PLUGGED_IN);
        let read = yield* readKeepAwake(stateRoot);
        for (let round = 0; round < 2_000 && read !== KEEP_AWAKE.PLUGGED_IN; round += 1) {
          yield* nudged(Duration.millis(100));
          read = yield* readKeepAwake(stateRoot);
        }
        assert.equal(read, KEEP_AWAKE.PLUGGED_IN);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "a record the host writes reaches the windows as its state folder moves, with no window asking",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* freshState;
        const mac = yield* thisMac(stateRoot, { experiments: {} });
        yield* until(() => mac.held() !== undefined);
        assert.deepEqual(mac.held(), UNENROLLED);

        // As the host daemon writes it once it pairs, apart from this app.
        yield* writeHostDevice(stateRoot, STANDING);
        yield* until(() => mac.held()?.deviceId !== undefined);

        assert.deepEqual(mac.held(), { ...UNENROLLED, deviceId: KEPT_ID, enrolled: true });
        assert.equal(
          mac.asked.length,
          0,
          "nothing of the host is kept with Bring your own host off",
        );
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "Bring your own host turned off unregisters the account's agent, and turned on registers it again as the settings are told, its record kept",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(STANDING);
        const mac = yield* thisMac(stateRoot, {
          experiments: {},
          listed: [KEPT_ID],
          status: THIS_MAC_AGENT_STATUS.ENABLED,
        });
        yield* until(() => mac.asked.length > 0);
        yield* nudged(Duration.minutes(1));
        assert.deepEqual(mac.asked, ["unregister"]);
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), STANDING);

        yield* mac.flip(EXPERIMENT.BRING_YOUR_OWN_HOST, true);
        yield* until(() => mac.asked.length > 1);

        assert.deepEqual(mac.asked, ["unregister", "register"]);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "taking over the account install's host moves vespin-host to the app's launcher, and leaves its state, its agents' folders, the clones, and its releases",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const stateRoot = yield* recorded(STANDING);
        const home = homeOf(stateRoot);
        const link = join(home, ".local", "bin", "vespin-host");
        const releases = join(home, ".local", "share", "vespin-host");
        const kept = [agentFolderOf(stateRoot), join(home, ".vespin", "clones"), releases];
        for (const folder of kept) yield* fileSystem.makeDirectory(folder, { recursive: true });
        yield* fileSystem.makeDirectory(dirname(link), { recursive: true });
        yield* fileSystem.symlink(join(releases, "current", "bin", "vespin-host"), link);
        const mac = yield* thisMac(stateRoot, { listed: [KEPT_ID] });

        yield* until(() => mac.asked.includes("register"));
        let target = yield* fileSystem.readLink(link);
        for (let round = 0; round < 2_000 && target !== launcherOf(stateRoot); round += 1) {
          yield* nudged(Duration.millis(100));
          target = yield* fileSystem.readLink(link);
        }

        assert.equal(target, launcherOf(stateRoot));
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), STANDING);
        for (const folder of kept) assert.ok(yield* fileSystem.exists(folder), folder);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "signing out unregisters the account's agent, which stops it and keeps it from starting, removing nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(STANDING);
        const mac = yield* thisMac(stateRoot, {
          listed: [KEPT_ID],
          status: THIS_MAC_AGENT_STATUS.ENABLED,
        });
        yield* until(() => mac.held() !== undefined);
        yield* nudged(Duration.seconds(1));
        assert.deepEqual(
          mac.asked,
          [],
          "an agent this version registered is left running while signed in",
        );

        yield* mac.signOut;
        yield* until(() => mac.asked.length > 0);
        yield* nudged(Duration.seconds(1));

        assert.deepEqual(mac.asked, ["unregister"]);
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), STANDING);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "a run never signed in leaves the host alone, since another build of the app may be running it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mac = yield* thisMac(yield* recorded(STANDING), {
          listed: [KEPT_ID],
          status: THIS_MAC_AGENT_STATUS.ENABLED,
          signedIn: false,
        });
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(mac.asked, []);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "the account's standing record is never enrolled again, its agent registered only where macOS holds none, and again where another version of the app registered it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stopped = yield* thisMac(yield* recorded(STANDING), { listed: [KEPT_ID] });
        const running = yield* thisMac(yield* recorded(STANDING), {
          listed: [KEPT_ID],
          status: THIS_MAC_AGENT_STATUS.ENABLED,
        });
        const updated = yield* thisMac(yield* recorded(STANDING), {
          listed: [KEPT_ID],
          status: THIS_MAC_AGENT_STATUS.ENABLED,
          registeredHere: false,
        });
        yield* until(() => stopped.asked.length > 0 && updated.asked.length > 1);
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(stopped.asked, ["register"]);
        assert.equal(running.asked.length, 0, "an agent this version registered is left as it is");
        assert.deepEqual(updated.asked, ["unregister", "register"]);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "an agent macOS holds for approval is left for the member and told the windows, until they allow it in Login Items",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* freshState;
        const mac = yield* thisMac(stateRoot, { heldForApproval: true });
        yield* until(() => mac.held() !== undefined);
        yield* mac.turn(true);
        yield* until(() => mac.held()?.needsApproval === true);
        yield* nudged(Duration.minutes(1));
        assert.deepEqual(mac.asked, ["enroll", "register"], "registered once, never again");

        mac.allow();
        yield* until(() => mac.held()?.needsApproval === false);
        assert.deepEqual(mac.asked, ["enroll", "register"]);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "a record the service refused has its agent unregistered and the host removed, its agents' folders kept, never enrolled again unasked",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded({ ...STANDING, refused: true });
        const fileSystem = yield* FileSystem.FileSystem;
        const folder = agentFolderOf(stateRoot);
        yield* fileSystem.makeDirectory(folder, { recursive: true });
        yield* keepOwnedAgent(stateRoot, AGENT_ID);
        const mac = yield* thisMac(stateRoot, { status: THIS_MAC_AGENT_STATUS.ENABLED });
        yield* until(() => mac.asked.length > 0);
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(mac.asked, ["unregister"], "a refused record has nothing to leave");
        assert.equal(yield* fileSystem.exists(stateRoot), false);
        assert.equal(yield* fileSystem.exists(folder), true, "as a remote Remove keeps them");
        assert.equal(mac.held()?.enrolled, false);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "a register that failed after the enroll is tried again after a backoff, never by enrolling again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* freshState;
        const mac = yield* thisMac(stateRoot, { failedRegisters: 1 });
        // Note that the launch's read and the keep it began settle first, so the register counted is the turn's alone.
        yield* until(() => mac.held() !== undefined);
        yield* nudged(Duration.minutes(1));
        yield* mac.turn(true);
        yield* until(() => mac.asked.length >= 2);
        yield* nudged(Duration.seconds(5));
        assert.deepEqual(
          mac.asked,
          ["enroll", "register"],
          "nothing is tried again before the backoff",
        );

        yield* until(() => mac.asked.length >= 3);
        assert.deepEqual(mac.asked, ["enroll", "register", "register"]);
        assert.equal(Option.getOrUndefined(yield* readHostDevice(stateRoot))?.deviceId, MINTED_ID);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect.each([
  {
    case: "unregisters its agent before the host leaves and its state goes",
    registers: true,
    deleteFolders: true,
    removed: ["unregister", "leave"],
  },
  {
    case: "runs the account install's uninstall, keeping its agents' folders as asked, where this build does not register the agent",
    registers: false,
    deleteFolders: false,
    removed: ["uninstall --keep-agents"],
  },
] as const)(
  "turning This Mac off $case, and reads off until it is turned on again",
  ({ registers, deleteFolders, removed }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(STANDING);
        const mac = yield* thisMac(stateRoot, {
          listed: [KEPT_ID],
          registers,
          status: THIS_MAC_AGENT_STATUS.ENABLED,
        });
        yield* until(() => mac.held()?.enrolled === true);
        yield* nudged(Duration.minutes(1));
        // Note that a build that does not register runs the install script at launch, as it keeps the account's host running, so only what the turn asked is read.
        const before = mac.asked.length;

        assert.deepEqual(yield* mac.turn(false, deleteFolders), { done: true });
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(mac.asked.slice(before), removed);
        assert.ok(Option.isNone(yield* readHostDevice(stateRoot)), "its record is gone");
        assert.deepEqual(mac.held(), UNENROLLED);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect.each([
  {
    case: "the service did not take its leave, so the account may still list it",
    options: { leaveTaken: false },
    answer: { done: true, stillListed: true },
  },
  {
    case: "an agent's folder could not be removed",
    options: { lockedFolder: "agent" },
    answer: { done: true, folderLeft: AGENT_ID },
  },
] as const)(
  "turning This Mac off answers where $case, its state gone all the same",
  ({ options, answer }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(STANDING);
        const folder = agentFolderOf(stateRoot);
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory(folder, { recursive: true });
        yield* keepOwnedAgent(stateRoot, AGENT_ID);
        const mac = yield* thisMac(stateRoot, {
          ...options,
          ...("lockedFolder" in options ? { lockedFolder: folder } : undefined),
          listed: [KEPT_ID],
          status: THIS_MAC_AGENT_STATUS.ENABLED,
        });
        yield* until(() => mac.held()?.enrolled === true);

        const answered = yield* mac.turn(false, true);

        assert.equal(yield* fileSystem.exists(join(stateRoot, "device.json")), false);
        assert.ok("done" in answered);
        if ("folderLeft" in answer) {
          assert.ok(
            answered.folderLeft?.includes(answer.folderLeft),
            "the folder's failure is said",
          );
        } else {
          assert.deepEqual(answered, answer);
        }
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "another account's standing host on this Mac is neither turned off nor turned on over",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(STANDING);
        const mac = yield* thisMac(stateRoot, { status: THIS_MAC_AGENT_STATUS.ENABLED });
        yield* until(() => mac.held() !== undefined);

        assert.deepEqual(yield* mac.turn(false), ANOTHER_ACCOUNTS);
        assert.deepEqual(yield* mac.turn(true), ANOTHER_ACCOUNTS);
        yield* nudged(Duration.seconds(10));

        assert.equal(mac.asked.length, 0, "nothing of the other account's host is touched");
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), STANDING);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect.each([
  {
    case: "the record was enrolled with another service",
    record: { ...STANDING, serviceOrigin: "https://preview.app.test" },
    answer: { failure: "unanswered" },
  },
  {
    case: "the record is another account's",
    record: STANDING,
    answer: ANOTHER_ACCOUNTS,
  },
] as const)(
  "nothing is enrolled, registered, unregistered, or removed where $case, even turned off",
  ({ record, answer }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded(record);
        const on = yield* thisMac(stateRoot);
        const off = yield* thisMac(stateRoot, {
          experiments: { [EXPERIMENT.BRING_YOUR_OWN_HOST]: false },
          status: THIS_MAC_AGENT_STATUS.ENABLED,
        });
        yield* nudged(Duration.minutes(1));
        assert.deepEqual(yield* on.turn(false), answer);

        // Note that the length is asserted rather than the list, which an assertion would narrow to an empty one.
        assert.equal(on.asked.length + off.asked.length, 0);
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), record);
      }).pipe(Effect.provide(FILES)),
    ),
);
