import { type HostedMachineCommandClient, MACHINE_COMMAND_CALL_FAILURE } from "@repo/features";
import type { DeviceArch, DeviceMachine, DevicePlatform } from "@repo/features/device-agent-wire";
import { MACHINE_ASKS_READ, machineAsksOfLiveRows } from "@repo/features/machine-ask-live";
import {
  MACHINE_ASK_BOUNDS,
  type MachineAskStandingAnswer,
  type MachineAskSubject,
} from "@repo/features/machine-ask-wire";
import {
  MACHINE_COMMANDS_READ,
  type MachineCommandsLiveAnswer,
  machineCommandsOfLiveRows,
} from "@repo/features/machine-command-live";
import {
  type AllowedAppLook,
  COMPUTER_ACTION,
  COMPUTER_BOUNDS,
  COMPUTER_PERMISSION,
  type ComputerAction,
  type ComputerApp,
  type ComputerPermission,
  computerPermissionsNamed,
  isMacComputerCommand,
  isMacShellCommand,
  MACHINE_COMMAND_BOUNDS,
  MACHINE_COMMAND_KIND,
  MACHINE_COMMAND_MODE,
  MACHINE_REFUSAL,
  type MacComputerCommand,
  type MachineCommandKind,
  type MachineCommandMode,
  type MachineCommandRead,
  type MachineCommandRefusal,
  type MachineCommandResult,
  type MachineDeviceSettings,
  type MacShellResult,
  machineAskSeconds,
  machineCommandKindsQuery,
  machineCommandResultSchema,
} from "@repo/features/machine-command-wire";
import { MACHINES_READ, machinesOfLiveRows } from "@repo/features/machine-live";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { RECORDING_FAILURE } from "@repo/features/recording-wire";
import { carried, GATEWAY_EVENT } from "@repo/gateway";
import {
  Clock,
  Config,
  Deferred,
  Duration,
  Effect,
  FiberHandle,
  FiberSet,
  Option,
  Queue,
  Schedule,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import {
  COMPUTER_HELPER_FAILURE,
  COMPUTER_HELPER_OP,
  type ComputerAppPin,
  type ComputerHelperAnswer,
  type ComputerHelperRecording,
  type ComputerHelperRequest,
  type ComputerPermissions,
  type ComputerUseHelperSeam,
} from "./computer-use-helper.js";
import type { MACHINE_COMMAND_ACTS, MacApp } from "./contract/index.js";
import { Environment, Reporter } from "./effect/seams.js";
import { ActRefused, type HostActTable } from "./host-acts.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { decodedLiveRows, LIVE_RESTART, waitOrRegained } from "./live-follow.js";
import {
  isMachineShellAsk,
  MACHINE_COMMAND_DECISION,
  type MachineCommandAnswer,
  type MachineCommandAsk,
} from "./machine-command-ask.js";
import { type MacShell, runMachineCommand } from "./machine-command-runner.js";
import type { RunMode } from "./run-mode.js";
import type { ThisMachineDevice } from "./this-machine-device.js";

/**
 * compose-machine-commands.ts -- runs on this Mac the commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands or use apps here, asking the developer first where Settings says to.
 *
 * Settings › This Mac decides (`@repo/settings`'s `MACHINE_COMMAND_MODE`): Ask
 * every time, the default, shows the developer each shell command before
 * it runs; Always allow runs any command of the account's agents without
 * asking; Never is the brake, under which no shell command runs. Settings ›
 * Let agents use apps on this Mac is the other switch, for actions on
 * apps, and the gate stands open where either lets agents in: under Never
 * with apps on, a shell command the Mac is handed is answered not run
 * (`COMMANDS_NEVER`), since every read is handed shell commands. While the
 * gate stands, the commands no Mac has
 * claimed, of the kinds this Mac runs, are followed through the live layer
 * (`live-follow.ts`: a poll the service holds until the rows move), and
 * each one
 * heard of is claimed by its id; the service grants a claim once, so when
 * two Macs of one account follow, only the one it granted runs it. Each
 * claimed command runs on a fiber of its own in the concern's scope, by its
 * kind: a shell command in the login shell from the home folder
 * (`machine-command-runner.ts`), and a command of a kind this Mac cannot run
 * answered with a refusal. Its result is posted back, so a long command
 * holds up neither the follow nor the others.
 *
 * Under Ask every time, a claimed shell command is held as an ask
 * (`machine-command-ask.ts`) on the same fiber, so one waiting holds up neither
 * the follow nor another ask: the asks waiting are told as
 * `MACHINE_COMMAND_ASKS_CHANGED` each time one is asked or answered, the panel
 * draws them, and its answer comes back as `MACHINE_COMMAND_ANSWER` by the
 * ask's id. Allow once runs the command; Allow all commands writes the setting to
 * Always allow and runs it; Deny, or no answer before the command's own
 * timeout has passed since it was asked, answers the call as not run, in
 * words the agent can act on, through the same refusal a command of a kind
 * this Mac cannot run is answered with.
 *
 * An action on an app (`MACHINE_COMMAND_KIND.COMPUTER`) is taken only where the
 * desktop ships the computer-use helper (`computer-use-helper.ts`), and runs
 * through it under Settings › Let agents use apps on this Mac, whatever the
 * shell commands' setting says. The helper names the app first, launching
 * nothing: one agents are never offered is refused, one the developer
 * answered Always allow for, or allowed for this agent's conversation before, runs, and any
 * other is asked about as an app (`MacAppAsk`), on the same terms as a shell
 * command's ask. Allow once holds the app for the conversation that asked until the
 * gate moves; Always allow adds it to the apps agents use without asking.
 * Listing the apps names none, so it asks nothing. The action then names
 * the app as it was allowed, pinned by its bundle id, or its process where
 * it has none, so the helper acts on no other app that answers to the
 * agent's words by the time it runs, and the switch is read again just
 * before the helper takes it. What the helper answers is posted only where
 * the wire takes it (`machineCommandResultSchema`), and refused otherwise.
 *
 * Where this process can say which machine it runs on (`MachineCommandsDevice`),
 * the Mac joins as a device of the account signed in, under the id this
 * install keeps for it (`this-machine-device.ts`), and every read, claim, and
 * presence names that device, so the service hands it what was queued for
 * it or for no machine, and never what was meant for another of the
 * account's. The join carries this Mac's own settings for commands and apps,
 * its switch for apps among them, up where the service holds none for it
 * yet, and the service's are written over Settings where they differ; from
 * then on each change to them here is written to the service, and the
 * service's own row for the device is followed live (`MACHINES_READ`), so a
 * change made on another device or the web is written over Settings as it
 * lands, without joining again. Until it has joined, or where it cannot, the Mac
 * claims as the account alone, as it did before devices claimed.
 *
 * A live read writes nothing, so the Mac says it listens for its kinds
 * itself, every `LISTENING_EVERY`, well inside the service's freshness
 * window: the one timer that remains, because presence is a fact about this
 * process that no row change can carry.
 *
 * The gate is a value that changes rather than one read again on a timer:
 * the account it stands open for and the kinds it takes, worked out afresh
 * each time a setting or the account changes
 * (`MachineCommandsDependencies.changed`). Both switches off, a sign-out, or
 * another account signing in ends the follow and the beats at once, the
 * agents' calls are told no Mac listens, and every command still running
 * is stopped, its process group killed, as commands set to Never stops them
 * too; apps switched on or off reads again for the kinds the gate now takes
 * and stops nothing. A gate shut waits for it to open, reading nothing. Every read names the account
 * the follow started for, so one the service signs out ends the follow.
 * Quitting closes the scope, which kills every command still running with
 * its process group.
 */

/** How long the follow rests after a turn that died, before it tries again. */
const DIED_REST = Duration.seconds(5);

/** How often a Mac following its commands says it listens: a third of the service's forty-five-second freshness window. */
const LISTENING_EVERY = Duration.seconds(15);

/**
 * How a claim the service did not answer is asked again: a second apart, a
 * few times, well inside the service's thirty-second claim window, since
 * the rows that named it may not change again to say so.
 */
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** How often the Mac looks again at whether it has joined, and whether its settings here differ from the service's, beside each change that may move either: a join or a write the service did not answer is tried again so. */
const DEVICE_LOOK_EVERY = Duration.seconds(15);

/** What the device's looks run on: a look again at whether it joined and its settings moved, or the service's say over it heard live. */
const DEVICE_LOOK = { AGAIN: "again", HEARD: "heard" } as const;

/** The device this Mac joined as for an account, the settings the service keeps for it as last read or written, the service's say Settings has not yet taken, and the apps whose looks it last posted for it; none before it posted any. */
interface Joined {
  readonly userId: string;
  readonly deviceId: string;
  readonly settings: MachineDeviceSettings;
  readonly pending?: MachineDeviceSettings | undefined;
  readonly looks?: readonly string[] | undefined;
}

/** One turn of the device's looks: a look again, or the service's say over the device it joined as (`from`), heard live. */
type DeviceLook =
  | { readonly kind: typeof DEVICE_LOOK.AGAIN }
  | {
      readonly kind: typeof DEVICE_LOOK.HEARD;
      readonly from: Joined;
      readonly service: MachineDeviceSettings;
    };

const LOOK_AGAIN: DeviceLook = { kind: DEVICE_LOOK.AGAIN };

/** How long the helper has to name an app before it is asked about, apart from the action's own time. */
const DESCRIBE_WITHIN = Duration.seconds(10);

/** How long the helper has to put the agent's cursor away, behind any action it is still on. */
const RELEASE_WITHIN = Duration.seconds(10);

/** Why a release is let go as its turn comes: another agent's action took the cursor meanwhile. */
const CURSOR_TAKEN_WORDS = "another agent took the cursor.";

/** The actions that never move the agent's cursor, so never hand it to the agent asking. Note that an app's read is not among them, because it brings the cursor in where it shows nowhere yet. */
const STILL_CURSOR: ReadonlySet<string> = new Set([
  COMPUTER_ACTION.LIST_APPS,
  COMPUTER_ACTION.RECORD,
  COMPUTER_ACTION.STOP_RECORDING,
]);

/** The service's side of the commands, as this concern asks it. */
export type MachineCommandClient = Pick<
  HostedMachineCommandClient,
  | "liveRead"
  | "claim"
  | "listening"
  | "settle"
  | "postRecording"
  | "join"
  | "saveDeviceSettings"
  | "saveDeviceAppLooks"
  | "postAsk"
  | "lapseAsk"
  | "closeAsk"
  | "answerAsk"
>;

/** This Mac as a device of the accounts signed in on it: the ids it joins as, the machine it names itself as, and its own say over commands and apps. */
export interface MachineCommandsDevice extends ThisMachineDevice {
  /** The machine as it names itself to the service. */
  readonly machine: Effect.Effect<
    {
      readonly name: string;
      readonly platform: DevicePlatform;
      readonly arch: DeviceArch;
    } & DeviceMachine
  >;
  /** This Mac's own say over commands and apps, as Settings holds it now. */
  readonly settings: Effect.Effect<MachineDeviceSettings>;
  /** The service's say written over Settings, where it differs, answering whether every write landed. */
  readonly applySettings: (settings: MachineDeviceSettings) => Effect.Effect<boolean>;
}

export interface MachineCommandsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** How Settings lets agents run commands on this Mac, read as the gate is worked out and as each claimed command is about to run. */
  mode: Effect.Effect<MachineCommandMode>;
  /**
   * Subscribes, for as long as the subscriber's scope stands, to every
   * change that may move the gate: a setting written, or the account
   * signed in, out, or switched. What each carries is not read: the gate is
   * worked out afresh from `mode`, `account`, and `accountId` on each.
   */
  changed: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
  /** Writes the setting to Always allow, answering whether the write landed: the prompt's Allow all commands, which also runs the command asked. */
  allowAlways: Effect.Effect<boolean>;
  client: MachineCommandClient;
  /** The computer-use helper and its settings, where this Mac ships one; none takes no action on an app. */
  computer?: MacComputerUse;
  /**
   * Finishes once the agent given is no longer at work, its turn ended,
   * failed, or stopped, as the account's task list says, which puts the
   * agent's cursor away; none leaves the cursor to the helper's own clock.
   */
  turnEnded?: (agentId: string) => Effect.Effect<void>;
  /** This Mac as a device of the account, where this process can say which machine it runs on; none claims as the account alone. */
  device?: MachineCommandsDevice;
}

/** The device the Mac joined as for the account given; none where it has not joined for it. */
const joinedAs = (joined: Joined | undefined, userId: string) =>
  joined?.userId === userId ? joined.deviceId : undefined;

/** Whether two lists of apps are the same, in order. */
const sameApps = (one: readonly string[], other: readonly string[]) =>
  one.length === other.length && one.every((app, index) => app === other[index]);

/** Whether two says over commands and apps are the same, the apps in order, and a switch for apps only one names told apart, so a Mac carries its own up where the service holds none. */
const sameSettings = (one: MachineDeviceSettings, other: MachineDeviceSettings) =>
  one.commandMode === other.commandMode &&
  one.computerUse === other.computerUse &&
  sameApps(one.alwaysAllowedApps, other.alwaysAllowedApps);

/** The service's say over this Mac as the account's machines read names it, by the device it joined as; none where the read names no such machine, or one whose app never joined. */
function heardSettings(
  rows: typeof MACHINES_READ.rows.Type,
  deviceId: string,
): MachineDeviceSettings | undefined {
  return machinesOfLiveRows(rows.machines).find((machine) => machine.id === deviceId)?.settings;
}

/** An app as the helper names and draws it: by the bundle id it was asked for, its name, and its icon where it drew one. */
interface NamedApp {
  readonly bundleId: string;
  readonly name: string;
  readonly iconPng?: string;
}

/** An app as the helper named it, and whether that answer stands or is asked again later. */
interface AppNaming {
  readonly app: NamedApp;
  readonly stands: boolean;
}

/**
 * The apps as a device posts their looks: each by its name, and its icon
 * while every icon carried so far fits `MAX_LOOKS_ICON_CHARS`, so a post at
 * every bound stays under what the service takes; an app past it, or whose
 * icon is past an icon's own bound, is posted by its name alone.
 */
function postedLooks(named: readonly NamedApp[]): readonly AllowedAppLook[] {
  let room = COMPUTER_BOUNDS.MAX_LOOKS_ICON_CHARS;

  return named.map(({ bundleId, name, iconPng }) => {
    const fits =
      iconPng !== undefined &&
      iconPng.length <= COMPUTER_BOUNDS.MAX_ICON_CHARS &&
      iconPng.length <= room;

    if (!fits) return { app: bundleId, name };
    room -= iconPng.length;

    return { app: bundleId, name, iconPng };
  });
}

/** What actions on apps run through and under: the helper, and the settings that let them. */
export interface MacComputerUse {
  readonly helper: ComputerUseHelperSeam;
  /** Whether Settings lets agents use apps on this Mac, read as each action arrives. */
  readonly enabled: Effect.Effect<boolean>;
  /** Whether the account has Computer use on (Settings › Experimental), read as the settings change, so turning it on asks macOS for the grants. */
  readonly offered: Effect.Effect<boolean>;
  /** The apps the developer answered Always allow for, by bundle id, or by name where an app has none. */
  readonly allowedApps: Effect.Effect<readonly string[]>;
  /** Adds an app to them, answering whether the write landed: an app's Always allow. */
  readonly allowApp: (app: string) => Effect.Effect<boolean>;
}

export interface MachineCommandsComposer extends Composer {
  readonly acts: HostActTable<typeof MACHINE_COMMAND_ACTS>;
}

/**
 * Where the gate stands open: the account the Mac takes commands for, and
 * whether Settings lets agents run commands (`shell`) and use apps
 * (`apps`) here, each by its own setting.
 */
interface GateStanding {
  readonly userId: string;
  readonly shell: boolean;
  readonly apps: boolean;
}

/** Whether the gate stands as it did: for the same account and the same kinds. */
function sameGate(now: GateStanding | undefined, was: GateStanding): boolean {
  return now?.userId === was.userId && now.shell === was.shell && now.apps === was.apps;
}

/**
 * The kinds a gate standing open reads, claims, and listens for: actions on
 * apps where they are let, and shell always, since every read is handed
 * shell commands whatever it names (`machineCommandKindsRead`), so one taken
 * under Never is answered not run rather than left for its call to wait out.
 */
function kindsOf(standing: GateStanding): readonly MachineCommandKind[] {
  return standing.apps
    ? [MACHINE_COMMAND_KIND.SHELL, MACHINE_COMMAND_KIND.COMPUTER]
    : [MACHINE_COMMAND_KIND.SHELL];
}

/** What a shell command answers where Settings lets agents run no commands on this Mac, while it stands open for their actions on apps. */
const COMMANDS_NEVER: MachineCommandRefusal = {
  refused:
    "Not run: the developer doesn't let agents run commands on their Mac (Settings › This Mac is set to Never).",
};

/** What a command taken as the setting was switched off, or the account signed out, answers. */
const SWITCHED_OFF: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Not run: commands on this Mac were switched off as it arrived.",
  truncated: false,
  timedOut: false,
};

/** What a command the developer declined answers. */
const DECLINED: MachineCommandRefusal = {
  refused: "Not run: the developer declined this command.",
  outcome: MACHINE_REFUSAL.DECLINED,
};

/** A denial as the agent reads it: the refusal, and after it the words the developer gave with it, where they gave any. */
function declinedWith(
  declined: MachineCommandRefusal,
  note: string | undefined,
): MachineCommandRefusal {
  return note === undefined
    ? declined
    : { ...declined, refused: `${declined.refused} They said: "${note}"` };
}

/** What the developer answered an ask: Allow or Deny, and with a Deny, the words they gave the agent. */
type Answered = Pick<MachineCommandAnswer, "decision" | "note">;

/** One ask waiting on the developer, as the Mac holds it: the ask, the account it was claimed for, its answer to come, and whether its post landed with the service, which an answer given here then goes through; none where it was never posted. */
interface HeldAsk {
  readonly ask: MachineCommandAsk;
  readonly userId: string;
  readonly decided: Deferred.Deferred<Answered>;
  posted?: Deferred.Deferred<boolean>;
}

/** What an ask asks about, as the service keeps it. */
function subjectOf(ask: MachineCommandAsk): MachineAskSubject {
  return isMachineShellAsk(ask) ? { command: ask.command } : { app: ask.app };
}

/** An answer the service holds, as the ask's wait takes it. */
function answeredOf(standing: MachineAskStandingAnswer): Answered {
  return standing.note === undefined
    ? { decision: standing.decision }
    : { decision: standing.decision, note: standing.note };
}

/** Whether the service answered a call with a failure rather than its answer. */
function isFailed<A extends object>(
  answer: A,
): answer is Extract<A, { readonly failure: unknown }> {
  return "failure" in answer;
}

/** How a call to the service about an ask is asked again where it went unanswered: a second apart, a few times. */
const ASK_CALL_RETRY = { schedule: Schedule.spaced(Duration.seconds(1)), times: 3 } as const;

/** How long a window's close waits for its ask's post to land, so a slow post neither strands it nor holds up the call. */
const POST_WITHIN = Duration.seconds(5);

/** How long a withdrawn ask's refusal may take to post, so a gate shut on it is not held up. */
const WITHDRAWN_SETTLE = Duration.seconds(5);

/** What a command the developer did not answer for answers: not run, since its ask closed, or was withdrawn, before anyone answered. */
const UNANSWERED: MachineCommandRefusal = {
  refused:
    "Not run: the developer did not answer in time whether to allow this command on their Mac.",
  outcome: MACHINE_REFUSAL.UNANSWERED,
};

/** What a command asked under an account that signed out before it was answered answers. */
const ACCOUNT_CHANGED: MachineCommandRefusal = {
  refused: "Not run: the account signed in on the developer's Mac changed before it was allowed.",
};

/** The grants as Settings shows them where there is no helper to read them. */
const NO_PERMISSIONS: ComputerPermissions = { screenRecording: false, accessibility: false };

/** Why an action does not run where Settings has agents use no apps on this Mac. */
const APPS_OFF_WORDS =
  "the developer switched off Settings › Let agents use apps on this Mac, so no app can be used.";

/** What an action answers where Settings has agents use no apps on this Mac. */
const APPS_SWITCHED_OFF: MachineCommandRefusal = { refused: `Not run: ${APPS_OFF_WORDS}` };

/** What an action on an app the developer declined answers. */
const APP_DECLINED: MachineCommandRefusal = {
  refused: "Not run: the developer declined to let agents use this app.",
  outcome: MACHINE_REFUSAL.DECLINED,
};

/** What an action on an app the developer did not answer for in time answers. */
const APP_UNANSWERED: MachineCommandRefusal = {
  refused: "Not run: the developer did not answer in time whether agents may use this app.",
  outcome: MACHINE_REFUSAL.UNANSWERED,
};

/** What an action on an app agents are never offered answers, by the app's name. */
function neverOffered(app: string): MachineCommandRefusal {
  return {
    refused: `Not run: agents are never offered ${app}, as with terminals, password managers, System Settings, and ${PRODUCT_NAME}.`,
  };
}

/**
 * The grants each action needs before the helper is asked to take it:
 * reading a window needs both, since it walks the app's elements and
 * captures its window; recording one needs Screen Recording alone; every
 * other action on an app needs Accessibility to press, type, and post
 * input; listing the apps and stopping a recording need neither.
 */
const ACTION_NEEDS = {
  [COMPUTER_ACTION.LIST_APPS]: [],
  [COMPUTER_ACTION.GET_APP_STATE]: [
    COMPUTER_PERMISSION.SCREEN_RECORDING,
    COMPUTER_PERMISSION.ACCESSIBILITY,
  ],
  [COMPUTER_ACTION.CLICK]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.TYPE_TEXT]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.PRESS_KEY]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.SCROLL]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.DRAG]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.SET_VALUE]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.PERFORM_SECONDARY_ACTION]: [COMPUTER_PERMISSION.ACCESSIBILITY],
  [COMPUTER_ACTION.RECORD]: [COMPUTER_PERMISSION.SCREEN_RECORDING],
  [COMPUTER_ACTION.STOP_RECORDING]: [],
} as const satisfies Record<ComputerAction, readonly ComputerPermission[]>;

/** Whether the Mac holds one grant, as the helper read them. */
function granted(permissions: ComputerPermissions, permission: ComputerPermission): boolean {
  return permission === COMPUTER_PERMISSION.SCREEN_RECORDING
    ? permissions.screenRecording
    : permissions.accessibility;
}

/**
 * What an action answers where the Mac lacks a grant it needs: each grant
 * missing by name and where it is turned on, short enough to read on the
 * call's row, and asking the agent to pass it on, since nothing it does can
 * grant them.
 */
function permissionsMissing(
  missing: readonly [ComputerPermission, ...ComputerPermission[]],
): MachineCommandRefusal {
  const names = computerPermissionsNamed(missing);
  const them = missing.length === 1 ? "it" : "them";

  return {
    refused:
      `Not run: ${PRODUCT_NAME} on the developer's Mac needs ${names}. ` +
      `Ask them to turn ${them} on in ${PRODUCT_NAME}'s Settings › This Mac.`,
    missingPermissions: missing,
  };
}

/** What a read of a window answers where the helper captured no picture of it, so no empty picture goes on to the model or the transcript. */
function nothingCaptured(app: string): MachineCommandRefusal {
  return {
    refused: `Not run: ${app}'s window could not be captured. Read it again with get_app_state.`,
  };
}

/** What an action answers where the helper answered a request with an answer of another kind. */
const UNEXPECTED_ANSWER: MachineCommandRefusal = {
  refused: "Not run: the computer-use helper answered something else.",
};

/** How an action names the app allowed: by its bundle id where it has one, with the pin. */
type PinnedApp = ComputerAppPin & { readonly app?: string };

/**
 * The pin that holds an action to the app allowed: its bundle id, which the
 * helper finds it by too, or its process where it has none; nothing where
 * it has neither, as an app with no bundle id that is not running.
 */
function pinOf(app: ComputerApp, pid: number | undefined): PinnedApp {
  if (app.bundleId !== undefined) return { app: app.bundleId, pin_bundle_id: app.bundleId };

  return pid === undefined ? {} : { pin_pid: pid };
}

const isSendable = Schema.is(machineCommandResultSchema);

/** Room in a posted body for what stands beside the result: its key and the command's id. */
const SETTLE_ENVELOPE_BYTES = 128;

const encoder = new TextEncoder();

/** A result as the service takes it, or the helper's other-answer refusal where it would not, as a window larger than the wire or the body's cap carries, so the call is never left waiting on a result it refuses. */
function sendable(result: MachineCommandResult): MachineCommandResult {
  if (!isSendable(result)) return UNEXPECTED_ANSWER;
  const bytes = encoder.encode(JSON.stringify(result)).byteLength + SETTLE_ENVELOPE_BYTES;

  return bytes <= MACHINE_COMMAND_BOUNDS.MAX_RESULT_BYTES ? result : UNEXPECTED_ANSWER;
}

/** What an action came to, as the helper answered it. */
function computerResult(answer: ComputerHelperAnswer, app?: ComputerApp): MachineCommandResult {
  if ("outcome" in answer) {
    // Note that a read with no picture of its window is refused, because an empty picture handed on breaks the model's turn and draws a blank window.
    if ("shots" in answer.outcome && !answer.outcome.shots.some((shot) => shot.jpeg !== "")) {
      return nothingCaptured(answer.outcome.app.name);
    }

    // Note that a done action names the app it acted on, which the helper's own answer does not.
    const outcome =
      "done" in answer.outcome && app !== undefined ? { ...answer.outcome, app } : answer.outcome;

    return { computer: outcome };
  }

  if ("failure" in answer) return { refused: `Not run: ${answer.message}` };

  return UNEXPECTED_ANSWER;
}

/** What a stop answers where its video could not be posted up, which the helper keeps until the next recording, so a stop asked again posts it again. */
const RECORDING_UNSENT: MachineCommandRefusal = {
  refused:
    "Not run: the recording could not be sent up from the developer's Mac just now; call " +
    "stop_recording again.",
};

/** What a stop answers where this Mac holds no recording of the conversation that asks: none runs, as the helper says where none ever did. */
const NO_RECORDING: MachineCommandResult = { computer: { unrecorded: RECORDING_FAILURE.NONE } };

/** Why a stop is refused as its turn comes, where a record taken ahead of it made another conversation the recording's owner. */
const NOT_OWNER_WORDS = "no recording of this conversation runs: start one with record.";

/** Who a recording is: the account and the agent's conversation that started it, which alone may stop it and receive its video. */
interface RecordingOwner {
  readonly userId: string;
  readonly conversationId: string;
}

/** Whom the agent's cursor stands for: the account and the agent whose action moved it last, none for a conversation that is no agent's. */
interface CursorHolder {
  readonly userId: string;
  readonly agentId: string | undefined;
}

/** The bytes a base64 text spells: three for every four characters, less its padding. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;

  return (base64.length / 4) * 3 - padding;
}

/** What a command of a kind this Mac cannot run answers, such as one a newer service queued. */
const CANNOT_RUN: MachineCommandRefusal = {
  refused:
    `Not run: ${PRODUCT_NAME} on the developer's Mac cannot run this kind of command; updating ${PRODUCT_NAME} there ` +
    "may let it.",
};

/** What a command answers where the environment names no home folder to run it from. */
const NO_HOME: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Could not start the command: this Mac names no home folder.",
  truncated: false,
  timedOut: false,
};

/** Where commands run, from the environment the host was handed; nothing where it names no home. */
const macShell = Effect.gen(function* () {
  const environment = yield* Environment;
  const home = yield* Effect.orDie(Config.option(Config.String(VARIABLE.HOME)).parse(environment));

  const shell = yield* Effect.orDie(
    Config.withDefault(Config.String(VARIABLE.SHELL), DEFAULT_SHELL).parse(environment),
  );

  return Option.map(home, (folder): MacShell => ({ path: shell, home: folder }));
});

export function composeMachineCommands(
  dependencies: MachineCommandsDependencies,
): Effect.Effect<
  MachineCommandsComposer,
  never,
  Environment | Reporter | ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const shell = yield* macShell;
    const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
    const http = yield* HttpClient.HttpClient;
    const { kernel, account, mode, allowAlways, client, computer } = dependencies;
    /** The apps each agent's conversation was allowed once, by its id, until the gate moves. */
    const allowedOnce = new Map<string, Set<string>>();
    /** The apps allowed without asking as last read, so an app taken off that list loses every grant it was allowed once beside it. */
    let alwaysAllowed: readonly string[] = [];
    /**
     * Who started the recording the helper holds, running or kept until the
     * next: the one conversation whose stop reaches it, since the helper keeps
     * one recording for the whole Mac and would hand it to any stop. Note that
     * it is forgotten as the gate moves, so another account never receives it.
     */
    let recordingOwner: RecordingOwner | undefined;
    /**
     * Whom the agent's cursor stands for, which the helper keeps one of for
     * the whole Mac, and the watch on that agent's turn, which puts the
     * cursor away as the turn ends; another agent's action takes both over.
     */
    let cursorHolder: CursorHolder | undefined;
    let cursorWatch: FiberHandle.FiberHandle<void> | undefined;
    /** The asks waiting on the developer, by the command's id, the earliest asked first, each with the account it was claimed for. */

    const asks = new Map<string, HeldAsk>();

    /** The asks this Mac holds whose post landed, by the command's id: the follow of the account's asks stands while there are any. */
    const landedAsks = yield* SubscriptionRef.make<ReadonlySet<string>>(new Set());

    /** The device the Mac joined as, and the settings the service keeps for it; none before it has joined for the account signed in. */
    const joined = yield* SubscriptionRef.make<Joined | undefined>(undefined);

    /** Where an ask's calls to the service run beside its command, so none holds it up; made as the concern starts. */
    let errands: FiberSet.FiberSet | undefined;

    const errand = (effect: Effect.Effect<unknown>) =>
      errands === undefined ? Effect.void : Effect.asVoid(FiberSet.run(errands, effect));

    /** One call to the service about an ask, asked again where it went unanswered; its answer, or none where it never took it. */
    const askedOfService = <A extends object>(
      call: Effect.Effect<A, never, HttpClient.HttpClient>,
    ): Effect.Effect<Exclude<A, { readonly failure: unknown }> | undefined> =>
      asked(call).pipe(
        Effect.flatMap((answer) =>
          isFailed(answer)
            ? Effect.fail(answer)
            : // SAFETY: an answer that is no failure is one of the call's own answers, which a generic narrowing does not carry.
              Effect.succeed(answer as Exclude<A, { readonly failure: unknown }>),
        ),
        Effect.retry(ASK_CALL_RETRY),
        Effect.option,
        Effect.map(Option.getOrUndefined),
      );

    const setPosted = (id: string, landed: boolean) =>
      SubscriptionRef.update(landedAsks, (ids) => {
        const next = new Set(ids);

        if (landed) next.add(id);
        else next.delete(id);

        return next;
      });

    const tellAsks = () =>
      kernel.emit(
        GATEWAY_EVENT.MACHINE_COMMAND_ASKS_CHANGED,
        carried({ asks: [...asks.values()].map((held) => held.ask) }),
      );

    /**
     * The developer's answer to one ask, a claimed shell command or an app
     * an action names, asked of the panel and waited for until `closesAt`,
     * which the ask carries so the prompt and the agent's row count down to
     * it; no answer by then is none. The ask is withdrawn however the wait
     * ends, an interruption included, so a prompt never outlives its command.
     *
     * Where the Mac joined as a device of the account, the ask also goes up
     * to the service, so any device of the account may answer it, and the
     * answer the service took first, here or elsewhere, is the answer
     * (`asksHeard`). An ask answered comes down everywhere; one whose wait
     * ended with no answer is said closed, so an answer given after it is
     * the service's to keep for the agent's next try, and one that beat the
     * close is taken as given in time. Each of its calls waits on its post,
     * so none lands before it.
     */
    const consent = (
      shown: (times: { readonly askedAt: number; readonly expiresAt: number }) => MachineCommandAsk,
      userId: string,
      closesAt: number,
    ): Effect.Effect<Answered | undefined> =>
      Effect.gen(function* () {
        const ask = shown({ askedAt: kernel.now(), expiresAt: closesAt });
        const decided = yield* Deferred.make<Answered>();
        const now = yield* Clock.currentTimeMillis;
        const deviceId = joinedAs(yield* SubscriptionRef.get(joined), userId);
        const landed = deviceId === undefined ? undefined : yield* Deferred.make<boolean>();
        const held: HeldAsk = { ask, userId, decided };

        if (landed !== undefined) held.posted = landed;
        asks.set(ask.id, held);
        tellAsks();

        if (deviceId !== undefined && landed !== undefined) {
          const windowSeconds = Math.min(
            MACHINE_ASK_BOUNDS.MAX_WINDOW_SECONDS,
            Math.max(1, Math.ceil((closesAt - now) / 1000)),
          );

          yield* errand(
            Effect.gen(function* () {
              const stands = yield* askedOfService(
                client.postAsk({ id: ask.id, deviceId, subject: subjectOf(ask), windowSeconds }),
              );

              if (stands !== undefined) yield* setPosted(ask.id, true);
              yield* Deferred.succeed(landed, stands !== undefined);

              // Note that a post the service answered at once, as a grant for this agent's retry, decides the ask.
              if (stands?.answer !== undefined) {
                yield* Deferred.succeed(decided, answeredOf(stands.answer));
              }
            }),
          );
        }

        const lettingGo = Effect.sync(() => {
          asks.delete(ask.id);
          tellAsks();
        });

        // Note that a withdrawn ask is let go and said closed beside the command, since its call is answered at once (`withdrawnAs`).
        const answer = yield* Deferred.await(decided).pipe(
          Effect.timeoutOption(Duration.millis(Math.max(0, closesAt - now))),
          Effect.map(Option.getOrUndefined),
          Effect.onInterrupt(() =>
            Effect.andThen(
              lettingGo,
              landed === undefined ? Effect.void : errand(ended(ask.id, landed, false)),
            ),
          ),
        );

        yield* lettingGo;

        if (landed === undefined) return answer;
        const beat = yield* ended(ask.id, landed, answer !== undefined);

        return answer ?? beat;
      });

    /**
     * An ask's wait ended, told to the service once its post has landed,
     * or after a few seconds of a post that has not: taken down where an
     * answer was taken, or else said closed, answering the answer that beat
     * the close, where one did. Note that a take-down runs beside the command,
     * since nothing waits on it.
     */
    const ended = (id: string, landed: Deferred.Deferred<boolean>, answered: boolean) =>
      Effect.gen(function* () {
        const up = Option.getOrElse(
          yield* Effect.timeoutOption(Deferred.await(landed), POST_WITHIN),
          () => false,
        );

        yield* setPosted(id, false);

        if (!up) return undefined;

        if (answered) {
          yield* errand(askedOfService(client.closeAsk(id)));

          return undefined;
        }

        const lapsed = yield* askedOfService(client.lapseAsk(id));

        return lapsed?.answer === undefined ? undefined : answeredOf(lapsed.answer);
      });

    /** The answers the service took for the asks this Mac waits on, heard as the account's asks move: each decides its ask, whichever device gave it. */
    const asksHeard = (rows: typeof MACHINE_ASKS_READ.rows.Type) =>
      Effect.forEach(machineAsksOfLiveRows(rows.asks), (line) => {
        const held = asks.get(line.id);

        return held === undefined || line.answer === undefined
          ? Effect.void
          : Effect.asVoid(Deferred.succeed(held.decided, answeredOf(line.answer)));
      });

    /**
     * An ask's wait that answers the call with `refusal` at once where the
     * ask is withdrawn, as a gate shut on it or the quit withdraws it, so the
     * agent hears back now rather than once the service gives up; a post
     * that does not land in a few seconds is let go.
     */
    const withdrawnAs =
      (id: string, refusal: MachineCommandRefusal) =>
      <A>(wait: Effect.Effect<A>): Effect.Effect<A> =>
        wait.pipe(
          Effect.onInterrupt(() =>
            settled(id, refusal).pipe(Effect.timeoutOption(WITHDRAWN_SETTLE), Effect.ignore),
          ),
        );

    /** The asks of any account but the one signed in, let go: their prompts come down, and their calls hear nothing from this Mac. */
    const withdrawOtherAccounts = Effect.gen(function* () {
      const signedIn = dependencies.accountId();

      for (const held of asks.values()) {
        if (held.userId !== signedIn) yield* Deferred.interrupt(held.decided);
      }
    });

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideService(call, HttpClient.HttpClient, http);

    /** What one command comes to, by its kind: a shell command run, and any other kind refused. */
    const ran = (command: MachineCommandRead): Effect.Effect<MachineCommandResult> => {
      if (!isMacShellCommand(command)) return Effect.succeed(CANNOT_RUN);

      return Option.match(shell, {
        onNone: () => Effect.succeed(NO_HOME),
        onSome: (where) => runMachineCommand(command, where),
      }).pipe(Effect.provideContext(services));
    };

    /** One result posted back; one the service did not take is let go, its call already given up. */
    const settled = (id: string, result: MachineCommandResult) =>
      Effect.asVoid(asked(client.settle(id, result)));

    /** One command run and its result posted back. */
    const run = (command: MachineCommandRead) =>
      Effect.flatMap(ran(command), (result) => settled(command.id, result));

    /**
     * One claimed command as the setting now says: run, or under Ask every
     * time, a shell command run only once the developer allows it, and
     * answered as declined, with the words they gave, or unanswered
     * otherwise. One deadline from the claim stands over the ask and the run
     * together, the ask's window (`machineAskSeconds`) and then the
     * command's own timeout, which the service waits out past queueing, so
     * the ask closes in time to leave the run the whole of its timeout
     * however late it is allowed. Note that the wait for the answer is
     * interruptible inside the claim's uninterruptible region, because a
     * gate shut meanwhile, or the quit, must not hold on a prompt nobody
     * will answer; an ask withdrawn so answers the call as unanswered at
     * once (`withdrawnAs`), rather than leave it to the service's clock. An
     * Always allow the setting could not keep still runs the command, which
     * the developer allowed, and is reported, since the next command asks
     * again.
     */
    const decided = (command: MachineCommandRead, userId: string) =>
      Effect.gen(function* () {
        if (isMacComputerCommand(command)) return yield* used(command, userId);
        const how = yield* mode;

        if (how === MACHINE_COMMAND_MODE.NEVER && isMacShellCommand(command)) {
          return yield* settled(command.id, COMMANDS_NEVER);
        }

        // Note that a kind this Mac cannot run is refused without asking, since nothing would run.
        if (how !== MACHINE_COMMAND_MODE.ASK || !isMacShellCommand(command)) {
          return yield* run(command);
        }

        const runs = Duration.toMillis(Duration.seconds(command.timeoutSeconds));

        const deadline =
          (yield* Clock.currentTimeMillis) +
          Duration.toMillis(Duration.seconds(machineAskSeconds(command.timeoutSeconds))) +
          runs;

        const answer = yield* Effect.interruptible(
          consent(
            (times) => ({ id: command.id, command: command.command, ...times }),
            userId,
            deadline - runs,
          ),
        ).pipe(withdrawnAs(command.id, UNANSWERED));

        if (answer === undefined) return yield* settled(command.id, UNANSWERED);
        const { decision, note } = answer;

        if (decision === MACHINE_COMMAND_DECISION.DENY) {
          return yield* settled(command.id, declinedWith(DECLINED, note));
        }

        if (dependencies.accountId() !== userId) return yield* settled(command.id, ACCOUNT_CHANGED);

        if (decision === MACHINE_COMMAND_DECISION.ALLOW_ALWAYS && !(yield* allowAlways)) {
          report("the Always allow setting could not be saved; the next command asks again");
        }

        const left = Math.ceil((deadline - (yield* Clock.currentTimeMillis)) / 1000);

        if (left < 1) return yield* settled(command.id, UNANSWERED);
        yield* run({ ...command, timeoutSeconds: Math.min(command.timeoutSeconds, left) });
      });

    /**
     * Whether the agent may use the app its action names: the app named by
     * the helper, launching nothing, then refused, allowed already, or asked
     * about until `closesAt`. Answers why not, or the app as the helper
     * named it where it may, with the pin that holds the action to it.
     */
    const appAllowed = (
      use: MacComputerUse,
      command: MacComputerCommand & { readonly action: { readonly app: string } },
      userId: string,
      closesAt: number,
    ): Effect.Effect<
      MachineCommandRefusal | { readonly app: ComputerApp; readonly pin: PinnedApp }
    > =>
      Effect.gen(function* () {
        const named = yield* use.helper.ask(
          { op: COMPUTER_HELPER_OP.DESCRIBE_APP, app: command.action.app },
          DESCRIBE_WITHIN,
        );

        if ("failure" in named) return { refused: `Not run: ${named.message}` };

        if (!("described" in named)) {
          return { refused: "Not run: the computer-use helper answered something else." };
        }

        const app = named.described;

        if (app.refused) return neverOffered(app.name);
        const pin = pinOf(app, named.pid);
        const key = app.bundleId ?? app.name;
        const allowed = yield* use.allowedApps;

        for (const removed of alwaysAllowed.filter((each) => !allowed.includes(each))) {
          for (const once of allowedOnce.values()) once.delete(removed);
        }

        alwaysAllowed = allowed;

        if (allowed.includes(key) || allowedOnce.get(command.conversationId)?.has(key) === true) {
          return { app, pin };
        }

        const asked = {
          id: command.id,
          app: {
            name: app.name,
            ...(app.bundleId === undefined ? undefined : { bundleId: app.bundleId }),
            ...(app.iconPng === undefined ? undefined : { iconPng: app.iconPng }),
          },
          ...(command.agentId === undefined ? undefined : { agentId: command.agentId }),
        };

        const answer = yield* Effect.interruptible(
          consent((times) => ({ ...asked, ...times }), userId, closesAt),
        ).pipe(withdrawnAs(command.id, APP_UNANSWERED));

        if (answer === undefined) return APP_UNANSWERED;
        const { decision, note } = answer;

        if (decision === MACHINE_COMMAND_DECISION.DENY) return declinedWith(APP_DECLINED, note);

        if (dependencies.accountId() !== userId) return ACCOUNT_CHANGED;
        // Note that an Always allow the settings kept is held by them alone, so a Remove in Settings takes it back; one they could not keep holds for this conversation, as Allow once does.
        const always = decision === MACHINE_COMMAND_DECISION.ALLOW_ALWAYS;

        // Note that the app is held as allowed without asking at once, so a Remove before the next read still takes back every once grant beside it.
        if (always && (yield* use.allowApp(key))) {
          alwaysAllowed = [...alwaysAllowed, key];

          return { app, pin };
        }

        if (always) report("an app's Always allow could not be saved; the next agent asks again");
        allowedOnce.set(
          command.conversationId,
          new Set([...(allowedOnce.get(command.conversationId) ?? []), key]),
        );

        return { app, pin };
      });

    /**
     * The grants an action needs that the Mac lacks, read off the helper,
     * which answers at once and raises no prompt; why not where the helper
     * could not say, since it would not take the action either.
     */
    const lacking = (
      use: MacComputerUse,
      op: ComputerAction,
    ): Effect.Effect<MachineCommandRefusal | undefined> => {
      const needs: readonly ComputerPermission[] = ACTION_NEEDS[op];

      if (needs.length === 0) return Effect.succeed(undefined);

      return Effect.map(
        use.helper.ask({ op: COMPUTER_HELPER_OP.PERMISSIONS }, DESCRIBE_WITHIN),
        (answer) => {
          if ("failure" in answer) return { refused: `Not run: ${answer.message}` };

          if (!("permissions" in answer)) return UNEXPECTED_ANSWER;
          const [first, ...rest] = needs.filter((need) => !granted(answer.permissions, need));

          return first === undefined ? undefined : permissionsMissing([first, ...rest]);
        },
      );
    };

    /**
     * One claimed action on an app as Settings now says: refused where agents
     * use no apps here, refused at once, naming them, where the Mac lacks a
     * grant the action needs, so neither the developer nor the agent waits
     * on an action that cannot run; the app allowed or asked about where the
     * action names one, and run through the helper within the command's own
     * timeout, on the same terms as a shell command allowed late.
     */
    const used = (command: MacComputerCommand, userId: string) =>
      Effect.gen(function* () {
        if (computer === undefined) return yield* settled(command.id, CANNOT_RUN);

        if (!(yield* computer.enabled)) return yield* settled(command.id, APPS_SWITCHED_OFF);
        const runs = Duration.toMillis(Duration.seconds(command.timeoutSeconds));

        const deadline =
          (yield* Clock.currentTimeMillis) +
          Duration.toMillis(Duration.seconds(machineAskSeconds(command.timeoutSeconds))) +
          runs;

        const { action } = command;
        const owner: RecordingOwner = { userId, conversationId: command.conversationId };
        const stops = action.op === COMPUTER_ACTION.STOP_RECORDING;

        const owns = () =>
          recordingOwner?.userId === owner.userId &&
          recordingOwner.conversationId === owner.conversationId;

        // Note that a stop from any conversation but the one that recorded is answered as no recording, before the helper is asked, so a video never reaches another agent or account.
        if (stops && !owns()) return yield* settled(command.id, NO_RECORDING);

        const missing = yield* lacking(computer, action.op);

        if (missing !== undefined) return yield* settled(command.id, missing);
        let app: ComputerApp | undefined;
        let request: ComputerHelperRequest = action;

        // Note that only an action that names an app asks about it, since listing the apps and stopping a recording act on none.
        if ("app" in action) {
          const allowed = yield* appAllowed(
            computer,
            { ...command, action },
            userId,
            deadline - runs,
          );

          if ("refused" in allowed) return yield* settled(command.id, allowed);
          app = allowed.app;
          // Note that the action names the app as it was allowed, never the agent's words for it, since those may find another app by the time it runs.
          request = { ...action, ...allowed.pin };
        }

        const left = deadline - (yield* Clock.currentTimeMillis);

        if (left < 1000) return yield* settled(command.id, APP_UNANSWERED);

        // Note that the switch is read again here, since the developer may have switched apps off while the app was asked about.
        if (!(yield* computer.enabled)) return yield* settled(command.id, APPS_SWITCHED_OFF);

        // Note that the switch, and a stop's owner, are read once more as the helper's turn comes, since the action may wait behind another first, a record that makes another conversation the owner among them.
        const stillLet = Effect.map(computer.enabled, (on) => {
          if (!on) return APPS_OFF_WORDS;

          return stops && !owns() ? NOT_OWNER_WORDS : undefined;
        });

        // Note that the cursor is the agent's from the moment its action is handed to the helper, since the action may move it though it then fails.
        if (!STILL_CURSOR.has(action.op)) yield* heldBy({ userId, agentId: command.agentId });

        // Note that the action gets its own time to run and no more, which is all that is left of the deadline only where it was allowed late.
        const answer = yield* computer.helper.ask(
          request,
          Duration.millis(Math.min(runs, left)),
          stillLet,
        );

        if ("recording" in answer)
          return yield* settled(command.id, yield* posted(command.id, answer.recording));

        if (
          action.op === COMPUTER_ACTION.RECORD &&
          "outcome" in answer &&
          "done" in answer.outcome
        ) {
          recordingOwner = owner;
        }

        yield* settled(command.id, sendable(computerResult(answer, app)));
      });

    /**
     * The agent's cursor held for the agent whose action just ran: its turn
     * watched, and the cursor put away as the turn ends, unless another
     * agent's action took the cursor over first. An agent that already holds
     * it keeps its watch.
     */
    const heldBy = (holder: CursorHolder) =>
      Effect.gen(function* () {
        // Note that an agent already holding the cursor keeps its holder, whose watch puts the cursor away by that very holder.
        if (cursorHolder?.userId === holder.userId && cursorHolder.agentId === holder.agentId)
          return;
        cursorHolder = holder;

        if (cursorWatch === undefined) return;
        const { turnEnded } = dependencies;

        // Note that a conversation that is no agent's, or a Mac that cannot watch turns, leaves the cursor to the helper's own clock.
        if (holder.agentId === undefined || turnEnded === undefined) {
          return yield* FiberHandle.clear(cursorWatch);
        }

        yield* FiberHandle.run(
          cursorWatch,
          Effect.andThen(turnEnded(holder.agentId), released(holder)),
        );
      });

    /** The agent's cursor put away, where the holder given still holds it. */
    const released = (holder: CursorHolder) =>
      Effect.gen(function* () {
        if (cursorHolder !== holder || computer === undefined) return;
        cursorHolder = undefined;

        // Note that another agent's action may take the cursor while the release waits its turn at the helper, so it is refused then rather than hiding that agent's cursor.
        const free = Effect.sync(() =>
          cursorHolder === undefined ? undefined : CURSOR_TAKEN_WORDS,
        );

        yield* Effect.ignore(
          computer.helper.ask({ op: COMPUTER_HELPER_OP.RELEASE_CURSOR }, RELEASE_WITHIN, free),
        );
      });

    /**
     * A stopped recording's video posted up for its command, and what the
     * command came to once it was: the recording, named by its length and
     * size, or that it could not be sent, which a stop asked again sends.
     */
    const posted = (id: string, recording: ComputerHelperRecording) =>
      Effect.map(asked(client.postRecording(id, recording.mp4)), (answer): MachineCommandResult => {
        if ("failure" in answer) return RECORDING_UNSENT;
        const { seconds, width, height } = recording;

        return {
          computer: { recorded: { seconds, width, height, byteCount: base64Bytes(recording.mp4) } },
        };
      });

    /**
     * Where the gate stands now: open for the account signed in, in a run
     * that sends, where Settings lets agents run commands here (any mode
     * but Never) or use apps here (the switch on, where the helper ships),
     * each by its own setting; shut otherwise.
     */
    const gateFor = Effect.gen(function* () {
      const userId = dependencies.accountId();

      if (userId === undefined || !kernel.runMode.sendsNetwork || !account.capabilitiesActive()) {
        return undefined;
      }

      const shell = (yield* mode) !== MACHINE_COMMAND_MODE.NEVER;
      const apps = computer !== undefined && (yield* computer.enabled);

      return shell || apps ? { userId, shell, apps } : undefined;
    });

    /** The gate as last worked out: what the Mac takes commands for, none while it is shut. */
    const gate = yield* SubscriptionRef.make<GateStanding | undefined>(undefined);
    /**
     * How many times the gate has moved: shut, opened, opened for another
     * account, or commands set to Never while apps keep it open, each of
     * which stops the commands running. Note that apps switched on or off
     * moves nothing, since a shell command running must not stop for it;
     * the follow is read again for the kinds it now names, and an action
     * already claimed reads the switch again before the helper takes it.
     */
    let moves = 0;

    const gateMoved = Effect.flatMap(gateFor, (now) =>
      Effect.map(SubscriptionRef.getAndSet(gate, now), (was) => {
        if (was?.userId !== now?.userId || (was?.shell === true && now?.shell === false)) {
          moves += 1;
        }
      }),
    );

    /** Waits until the gate stands open, for whichever account. */
    const opened = SubscriptionRef.changes(gate).pipe(
      Stream.filter((now) => now !== undefined),
      Stream.runHead,
    );
    /** Waits until the gate no longer stands as `standing`: shut, open for another account, or open for other kinds. */

    const left = (standing: GateStanding) =>
      SubscriptionRef.changes(gate).pipe(
        Stream.filter((now) => !sameGate(now, standing)),
        Stream.runHead,
      );

    /**
     * One command heard of, claimed by its id and, once granted, run on a
     * fiber of its own; with the gate shut since, answered as not run
     * instead. A claim the service did not answer is asked again a few times
     * (`CLAIM_RETRY`), since the rows that named it may not change again to
     * say so. Note that the claim and its answer are uninterruptible and run
     * on a set of the concern's own (`claims`), never cleared, rather than the
     * follow's fiber or the set of commands running, because a command the
     * service granted is this Mac's alone to answer, a follow ended mid-claim
     * would otherwise leave its call waiting out its time, and a clear of the
     * commands running would wait out the claim, holding up the next
     * account's follow past its own commands' claim window.
     */
    const claimed = (
      running: FiberSet.FiberSet,
      userId: string,
      device: string | undefined,
      command: MachineCommandRead,
    ) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.claim(command.id, device)).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(CLAIM_RETRY.every),
            times: CLAIM_RETRY.times,
            until: (granted) =>
              !("failure" in granted) ||
              granted.failure !== MACHINE_COMMAND_CALL_FAILURE.UNANSWERED,
          }),
        );

        // A claim refused, or never answered, runs nothing: the command is another Mac's, or its call has given up.
        if ("failure" in answer) return;
        const { command: granted } = answer;

        if ((yield* gateFor)?.userId !== userId) {
          yield* asked(client.settle(granted.id, SWITCHED_OFF));

          return;
        }

        yield* FiberSet.run(running, decided(granted, userId));
      }).pipe(Effect.uninterruptible);

    /** The unclaimed commands of the kinds the gate stands open for that the device the Mac joined as may claim, their rows inline, held past `after` where it names one, for its account. */
    const seal = (
      standing: GateStanding,
      device: string | undefined,
      poll: boolean,
      after?: string,
    ) =>
      asked(
        client.liveRead(
          MACHINE_COMMANDS_READ,
          {
            userId: standing.userId,
            kinds: machineCommandKindsQuery(kindsOf(standing)),
            ...(device === undefined ? undefined : { device }),
          },
          poll ? { after } : undefined,
        ),
      );

    /**
     * That this Mac listens for the kinds the gate stands open for, said
     * every `LISTENING_EVERY` for as long as the follow stands, which ends
     * as the gate moves from them.
     */
    const presence = (standing: GateStanding, device: string | undefined) =>
      Effect.gen(function* () {
        for (;;) {
          yield* asked(client.listening(kindsOf(standing), device));
          yield* Effect.sleep(LISTENING_EVERY);
        }
      });

    /**
     * The device the Mac claims as for the account signed in, told to the
     * windows at every look, so the panel can tell this Mac from the
     * account's others. Note that it is told again though it did not move,
     * because the event is not kept for a listener that attaches after it,
     * and the client writes it only where it moved.
     */
    const tellDevice = Effect.gen(function* () {
      const userId = dependencies.accountId();

      const now =
        userId === undefined ? undefined : joinedAs(yield* SubscriptionRef.get(joined), userId);

      kernel.emit(
        GATEWAY_EVENT.MACHINE_COMMAND_DEVICE_CHANGED,
        carried(now === undefined ? {} : { deviceId: now }),
      );
    });

    /** Waits until the device the Mac claims as for `userId` is no longer `device`: it joined, or joined again under another id. */
    const rejoined = (userId: string, device: string | undefined) =>
      SubscriptionRef.changes(joined).pipe(
        Stream.filter((now) => joinedAs(now, userId) !== device),
        Stream.runHead,
      );

    /**
     * One app as the helper names and draws it, launching nothing, and
     * whether that answer stands: one it finds none of by that bundle id is
     * named by it alone and stands, while one it failed to answer, as while
     * it is busy, is named by it alone for now and asked again later.
     */
    const appNamed = (use: MacComputerUse, bundleId: string) =>
      Effect.map(
        use.helper.ask({ op: COMPUTER_HELPER_OP.DESCRIBE_APP, app: bundleId }, DESCRIBE_WITHIN),
        (named): AppNaming => {
          if (!("described" in named)) {
            return {
              app: { bundleId, name: bundleId },
              stands: !("failure" in named) || named.failure !== COMPUTER_HELPER_FAILURE.FAILED,
            };
          }

          const { name, iconPng } = named.described;

          return {
            app: { bundleId, name, ...(iconPng === undefined ? undefined : { iconPng }) },
            stands: true,
          };
        },
      );

    /** Each app given as the helper names and draws it (`appNamed`). */
    const appsNamed = (use: MacComputerUse, apps: readonly string[]) =>
      Effect.forEach(apps, (bundleId) => Effect.map(appNamed(use, bundleId), ({ app }) => app));

    /**
     * The Mac joined as a device of the account signed in, where it has not
     * yet: under the id this install keeps for it, or a new one where the
     * service refused that as another account's, carrying this Mac's own
     * settings up, and the service's written over Settings where they
     * differ, the device held only once they were. Once joined, its settings
     * here written to the service where they moved since. A join, or a write
     * the service or Settings did not take, is let be, for the next look to
     * try again.
     */
    const reconciled = (device: MachineCommandsDevice) =>
      Effect.gen(function* () {
        const userId = dependencies.accountId();

        if (userId === undefined || !kernel.runMode.sendsNetwork || !account.capabilitiesActive())
          return;
        const standing = yield* SubscriptionRef.get(joined);
        const here = yield* device.settings;

        if (standing?.userId === userId) {
          // Note that a say heard from the service that Settings refused is written again before anything goes up, since this Mac's own then is no edit of the developer's but the one the service's replaced.
          if (standing.pending !== undefined) {
            if (
              sameSettings(here, standing.pending) ||
              (yield* device.applySettings(standing.pending))
            ) {
              return yield* SubscriptionRef.set(joined, { ...standing, pending: undefined });
            }

            return yield* Effect.sleep(DEVICE_LOOK_EVERY);
          }

          if (sameSettings(here, standing.settings)) return;
          const saved = yield* asked(client.saveDeviceSettings(standing.deviceId, here));

          if ("failure" in saved) return;
          yield* SubscriptionRef.set(joined, { ...standing, settings: here });

          return;
        }

        const machine = yield* device.machine;

        const joinAs = (deviceId: string) =>
          Effect.map(asked(client.join({ deviceId, ...machine, settings: here })), (answer) => ({
            deviceId,
            answer,
          }));

        let attempt = yield* joinAs(yield* device.idFor(userId));

        if (
          "failure" in attempt.answer &&
          attempt.answer.failure === MACHINE_COMMAND_CALL_FAILURE.NOT_FOUND
        ) {
          attempt = yield* joinAs(yield* device.renewFor(userId));
        }

        const { deviceId, answer } = attempt;

        // Note that a join answered after the account changed is let go, for the next look to join the account signed in now.
        if ("failure" in answer || dependencies.accountId() !== userId) return;

        // Note that the device is held only once Settings took the service's say, so a write it refused is no edit of this Mac's to carry up over the service's: the next look joins again and writes it again. The looks run one after another, so the change a write tells is looked at once the device is held, and finds the two the same.
        if (
          !sameSettings(here, answer.settings) &&
          !(yield* device.applySettings(answer.settings))
        ) {
          // Note that a refused write tells a change too, which would start the next look at once, so the look rests first rather than joining and writing again without a pause.
          return yield* Effect.sleep(DEVICE_LOOK_EVERY);
        }

        yield* SubscriptionRef.set(joined, { userId, deviceId, settings: answer.settings });
      });

    /**
     * The service's say over this Mac as its live read carried it, taken
     * where it moved since it was last read or written: held as the
     * device's, then written over Settings where they differ, so a change
     * made on another device or the web reaches this Mac without joining
     * again. It runs in turn with the looks (`reconciled`), never beside
     * one, so a look never carries this Mac's say up over the service's
     * between the two. Note that a write Settings refused is held as
     * pending, which the next look writes again rather than carrying this
     * Mac's old say up over it, and that a say heard for an account no longer
     * signed in is let go.
     */
    const heard = (device: MachineCommandsDevice, from: Joined, service: MachineDeviceSettings) =>
      Effect.gen(function* () {
        const standing = yield* SubscriptionRef.get(joined);

        if (
          dependencies.accountId() !== from.userId ||
          standing?.userId !== from.userId ||
          standing.deviceId !== from.deviceId ||
          (sameSettings(standing.settings, service) && standing.pending === undefined)
        )
          return;

        const taken =
          sameSettings(yield* device.settings, service) || (yield* device.applySettings(service));

        yield* SubscriptionRef.set(joined, {
          ...standing,
          settings: service,
          pending: taken ? undefined : service,
        });
      });

    /** Waits until the Mac no longer stands joined as the device it joined as for `from`'s account. */
    const unjoined = (from: Joined) =>
      SubscriptionRef.changes(joined).pipe(
        Stream.filter((now) => now?.userId !== from.userId || now.deviceId !== from.deviceId),
        Stream.runHead,
      );

    /**
     * The account's machines followed (`MACHINES_READ`, which polls the
     * service, held) for as long as the Mac stands joined as one device,
     * each change to its own row's say handed to `take`; the read asked
     * again after a pause where the service did not answer it or broke it
     * off, and followed again as the Mac joins as another device or for
     * another account. Note that it waits, reading nothing, while the Mac
     * has not joined.
     */
    const settingsFollowed = (
      take: (from: Joined, service: MachineDeviceSettings) => Effect.Effect<void>,
    ) =>
      Effect.forever(
        Effect.gen(function* () {
          const from = yield* SubscriptionRef.get(joined);

          if (from === undefined) {
            return yield* Effect.asVoid(
              SubscriptionRef.changes(joined).pipe(
                Stream.filter((now) => now !== undefined),
                Stream.runHead,
              ),
            );
          }

          const read = (after?: string) =>
            asked(
              client.liveRead(
                MACHINES_READ,
                { userId: from.userId },
                after === undefined ? undefined : { after },
              ),
            );

          const sealed = yield* asked(client.liveRead(MACHINES_READ, { userId: from.userId }));

          if ("failure" in sealed) {
            return yield* Effect.raceFirst(
              waitOrRegained(LIVE_RESTART),
              Effect.asVoid(unjoined(from)),
            );
          }

          const rows = decodedLiveRows({ poll: read }, sealed, MACHINES_READ.rows);

          const following = Stream.runForEach(rows, (now) => {
            const service = heardSettings(now, from.deviceId);

            return service === undefined ? Effect.void : take(from, service);
          }).pipe(Effect.catch(() => waitOrRegained(LIVE_RESTART)));

          yield* Effect.raceFirst(following, Effect.asVoid(unjoined(from)));
        }),
      );

    /**
     * The account's asks followed (`MACHINE_ASKS_READ`, which polls the
     * service, held) while the Mac stands joined and an ask whose post landed
     * still waits here, each change heard (`asksHeard`); the read asked again
     * after a pause where the service did not answer it or broke it off.
     * Note that it reads nothing while no such ask waits, since only those
     * can bring an answer here.
     */
    const asksFollowed = Effect.forever(
      Effect.gen(function* () {
        const from = yield* SubscriptionRef.get(joined);

        if (from === undefined || (yield* SubscriptionRef.get(landedAsks)).size === 0) {
          return yield* Effect.asVoid(
            Stream.runHead(
              Stream.filter(
                Stream.zipLatest(
                  SubscriptionRef.changes(joined),
                  SubscriptionRef.changes(landedAsks),
                ),
                ([now, ids]) => now !== undefined && ids.size > 0,
              ),
            ),
          );
        }

        const read = (after?: string) =>
          asked(
            client.liveRead(
              MACHINE_ASKS_READ,
              { userId: from.userId },
              after === undefined ? undefined : { after },
            ),
          );

        const sealed = yield* read();

        const done = Effect.raceFirst(
          Effect.asVoid(unjoined(from)),
          Effect.asVoid(
            Stream.runHead(
              Stream.filter(SubscriptionRef.changes(landedAsks), (ids) => ids.size === 0),
            ),
          ),
        );

        if ("failure" in sealed) return yield* Effect.raceFirst(waitOrRegained(LIVE_RESTART), done);
        const rows = decodedLiveRows({ poll: read }, sealed, MACHINE_ASKS_READ.rows);

        yield* Effect.raceFirst(
          Stream.runForEach(rows, asksHeard).pipe(Effect.catch(() => waitOrRegained(LIVE_RESTART))),
          done,
        );
      }),
    );

    /**
     * How this Mac names and draws the apps it always allows, posted for the
     * device it joined as where they moved since it last posted them, so the
     * account's `@` lists off this Mac show each by its name and icon
     * (`hosts.allowedApps`). Nothing is posted while the account has
     * Computer use off. A post the service did not take, or one with an app
     * the helper failed to name, is let be, for the next look to post again.
     */
    const looksPosted = (use: MacComputerUse) =>
      Effect.gen(function* () {
        const userId = dependencies.accountId();

        if (userId === undefined || !kernel.runMode.sendsNetwork || !account.capabilitiesActive())
          return;
        const standing = yield* SubscriptionRef.get(joined);

        if (standing?.userId !== userId || !(yield* use.offered)) return;
        const apps = standing.settings.alwaysAllowedApps;

        if (standing.looks !== undefined && sameApps(standing.looks, apps)) return;
        const named = yield* Effect.forEach(apps, (bundleId) => appNamed(use, bundleId));

        // Note that Computer use is read again once the helper has named them, since it may have been turned off meanwhile.
        if (!(yield* use.offered)) return;
        const looks = postedLooks(named.map(({ app }) => app));
        const saved = yield* asked(client.saveDeviceAppLooks(standing.deviceId, looks));

        if ("failure" in saved) return;
        // Note that an app the helper failed to name holds no looks as posted, so the next look names it again once the helper answers, whatever list it then holds.
        const held = named.every(({ stands }) => stands) ? apps : undefined;

        // Note that the looks are held only for the standing they were posted for, so a join or a write meanwhile posts them again.
        yield* SubscriptionRef.update(joined, (now) =>
          now === standing ? { ...standing, looks: held } : now,
        );
      });

    /**
     * The unclaimed commands followed (`live-follow.ts`, which polls the
     * service, held) until the gate leaves the account or the session signs
     * out, each new one claimed by its id, the earliest queued first
     * (`claimed`). A command is claimed once per follow, and forgotten once
     * it leaves the rows, so the ids this keeps are only those still
     * waiting. A follow ends where the gate shuts, the session signs out, or
     * the account signed in changes.
     */
    const followed = (
      running: FiberSet.FiberSet,
      claims: FiberSet.FiberSet,
      standing: GateStanding,
      device: string | undefined,
      first: MachineCommandsLiveAnswer,
    ) =>
      Effect.suspend(() => {
        const { userId } = standing;
        let tried = new Set<string>();

        const claimNew = (commands: readonly MachineCommandRead[]) =>
          Effect.gen(function* () {
            const fresh = commands.filter((command) => !tried.has(command.id));
            tried = new Set(commands.map((command) => command.id));

            for (const command of fresh) {
              yield* FiberSet.run(claims, claimed(running, userId, device, command));
            }
          });

        const rows = decodedLiveRows(
          { poll: (after) => seal(standing, device, true, after) },
          first,
          MACHINE_COMMANDS_READ.rows,
        );

        const following = Stream.runForEach(rows, (read) =>
          claimNew(machineCommandsOfLiveRows(read)),
        );

        const follow = Effect.raceFirst(following, presence(standing, device)).pipe(
          Effect.catch(() => waitOrRegained(LIVE_RESTART)),
        );

        // Note that a follow ends as the Mac joins, or joins again, so the next names the device it claims as.
        return Effect.raceFirst(
          follow,
          Effect.raceFirst(Effect.asVoid(left(standing)), Effect.asVoid(rejoined(userId, device))),
        );
      });

    /** How many times the gate had moved when the running set was last cleared. */
    let clearedAt = 0;

    /**
     * One turn of the loop: the commands followed until the gate leaves the
     * account, the read asked again after a pause, or as soon as the service
     * answers again, where it did not answer it or signed the session out;
     * with the gate moved since the commands running were claimed, every
     * one of them stopped (its process group killed as its scope closes),
     * though it opened again for the same account; with it shut, a wait for
     * it to open.
     * Every turn begins by letting go of the asks of any account but the one
     * signed in, since a follow ends as the account changes.
     */
    const turn = (running: FiberSet.FiberSet, claims: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        yield* withdrawOtherAccounts;

        if (moves !== clearedAt) {
          clearedAt = moves;
          allowedOnce.clear();
          recordingOwner = undefined;

          // Note that the cursor of an account the gate left is put away at once, rather than by its turn's watch.
          if (cursorHolder !== undefined) {
            if (cursorWatch !== undefined) yield* FiberHandle.clear(cursorWatch);
            yield* released(cursorHolder);
          }

          yield* FiberSet.clear(running);

          // Note that the clear waits out any claim under way, during which the gate may have moved again, so the next turn starts from where it stands now.
          if (moves !== clearedAt) return;
        }

        // The account the follow starts for, which every read names, so one under another's session is refused as signed out.
        const standing = yield* SubscriptionRef.get(gate);

        if (standing === undefined) return yield* Effect.asVoid(opened);
        const device = joinedAs(yield* SubscriptionRef.get(joined), standing.userId);
        const sealed = yield* seal(standing, device, false);

        if ("failure" in sealed) {
          return yield* Effect.raceFirst(
            waitOrRegained(LIVE_RESTART),
            Effect.asVoid(left(standing)),
          );
        }

        yield* followed(running, claims, standing, device, sealed);
      });

    const lifetime = Effect.gen(function* () {
      const running = yield* FiberSet.make();
      const claims = yield* FiberSet.make();
      errands = yield* FiberSet.make();
      cursorWatch = yield* FiberHandle.make<void>();
      // Note that the changes are subscribed to before the gate is first worked out, so one that lands meanwhile is heard rather than lost.
      const changes = yield* dependencies.changed;
      yield* gateMoved;
      yield* Effect.forkScoped(Stream.runForEach(changes, () => gateMoved));

      // Note that the Mac joins, and keeps its settings with the service's, whatever the gate says, since Never is itself one of them.
      if (dependencies.device !== undefined) {
        const device = dependencies.device;

        // Note that what the service says of this Mac is heard on the same stream the looks run off, so the two never run beside each other.
        const said = yield* Queue.unbounded<DeviceLook>();
        const again = () => LOOK_AGAIN;

        const looks = Stream.merge(
          Stream.succeed(LOOK_AGAIN),
          Stream.merge(
            Stream.merge(Stream.map(yield* dependencies.changed, again), Stream.fromQueue(said)),
            Stream.map(Stream.fromSchedule(Schedule.spaced(DEVICE_LOOK_EVERY)), again),
          ),
        );

        const look = (event: DeviceLook) =>
          event.kind === DEVICE_LOOK.HEARD
            ? heard(device, event.from, event.service)
            : Effect.andThen(
                Effect.andThen(reconciled(device), tellDevice),
                computer === undefined ? Effect.void : looksPosted(computer),
              );

        yield* Effect.forkScoped(
          Stream.runForEach(looks, (event) =>
            Effect.catchDefect(look(event), () =>
              Effect.sync(() => report("this Mac could not join as a device")),
            ),
          ),
        );

        yield* Effect.forkScoped(
          Effect.catchDefect(asksFollowed, () =>
            Effect.sync(() => report("this Mac could not follow its asks")),
          ),
        );

        yield* Effect.forkScoped(
          Effect.catchDefect(
            settingsFollowed((from, service) =>
              Effect.asVoid(Queue.offer(said, { kind: DEVICE_LOOK.HEARD, from, service })),
            ),
            () => Effect.sync(() => report("this Mac could not follow its settings")),
          ),
        );
      }

      // A turn that died is reported and the reads rest before the next.
      const guarded = Effect.catchDefect(turn(running, claims), () =>
        Effect.andThen(
          Effect.sync(() => report("the Mac command read failed")),
          Effect.sleep(DIED_REST),
        ),
      );

      yield* Effect.forkScoped(Effect.forever(guarded));

      if (computer !== undefined) yield* askedAtSetUp(computer);
    });

    /** Whether computer use is set up on this Mac: Computer use on for the account, and This Mac's switch on. */
    const setUp = (use: MacComputerUse) =>
      Effect.zipWith(use.offered, use.enabled, (offered, enabled) => offered && enabled);

    /**
     * macOS asked for the grants the Mac lacks each time computer use comes
     * to be set up here, as the account turns it on or This Mac's switch
     * does, so the developer grants them before an agent first needs them
     * rather than at its first refusal. Note that computer use already set
     * up as the host starts asks nothing, since a prompt at every launch
     * would nag, and that a gate already asking waits for no answer.
     */
    const askedAtSetUp = (use: MacComputerUse) =>
      Effect.gen(function* () {
        const changes = yield* dependencies.changed;
        let was = yield* setUp(use);
        yield* Effect.forkScoped(
          Stream.runForEach(changes, () =>
            Effect.gen(function* () {
              const now = yield* setUp(use);

              if (now && !was) yield* grantsAsked;
              was = now;
            }),
          ),
        );
      });

    /** The Mac's two grants as the helper reads them, or after it asks macOS for them; neither where there is no helper or it could not say. */
    const permissionsRead = (
      op: typeof COMPUTER_HELPER_OP.PERMISSIONS | typeof COMPUTER_HELPER_OP.REQUEST_PERMISSIONS,
    ): Effect.Effect<ComputerPermissions> => {
      if (computer === undefined) return Effect.succeed(NO_PERMISSIONS);

      return Effect.map(computer.helper.ask({ op }, DESCRIBE_WITHIN), (answer) =>
        "permissions" in answer ? answer.permissions : NO_PERMISSIONS,
      );
    };

    /** The Mac's two grants once the helper asked macOS for them; refused where there is no helper or it could not ask, so an ask that never reached macOS is never answered as one that did. */
    const permissionsAsked = (): Effect.Effect<ComputerPermissions, ActRefused> => {
      if (computer === undefined) return Effect.fail(new ActRefused({}));

      return Effect.flatMap(
        computer.helper.ask({ op: COMPUTER_HELPER_OP.REQUEST_PERMISSIONS }, DESCRIBE_WITHIN),
        (answer) =>
          "permissions" in answer
            ? Effect.succeed(answer.permissions)
            : Effect.fail(new ActRefused({})),
      );
    };

    /** macOS asked for the grants the Mac lacks, by its own prompts and the pane of the first missing; nothing where it has both. */
    const grantsAsked = Effect.flatMap(
      permissionsRead(COMPUTER_HELPER_OP.PERMISSIONS),
      (granted) =>
        granted.screenRecording && granted.accessibility
          ? Effect.void
          : Effect.asVoid(permissionsRead(COMPUTER_HELPER_OP.REQUEST_PERMISSIONS)),
    );

    /** Each app allowed without asking, named and drawn by the helper; one it no longer finds by its bundle id alone. */
    const allowedAppsNamed = (use: MacComputerUse) =>
      Effect.flatMap(use.allowedApps, (allowed) => appsNamed(use, allowed));

    /**
     * The apps the composer's @ list offers on this Mac: those running
     * first, each with its icon, then those installed, each once by its
     * bundle id, none agents are never offered, and each marked where the
     * developer answered Always allow; none while Settings has agents use no
     * apps here. Note that the list is answered to this Mac's own panel
     * alone and never posted anywhere: what leaves the Mac is only the one
     * app a mention names, in the message it is written into.
     */
    const appsOnThisMac = (use: MacComputerUse): Effect.Effect<{ apps: readonly MacApp[] }> =>
      Effect.gen(function* () {
        if (!(yield* use.enabled)) return { apps: [] };
        const allowed = new Set(yield* use.allowedApps);
        const running = yield* use.helper.ask({ op: COMPUTER_ACTION.LIST_APPS }, DESCRIBE_WITHIN);

        const installed = yield* use.helper.ask(
          { op: COMPUTER_HELPER_OP.LIST_INSTALLED_APPS },
          DESCRIBE_WITHIN,
        );

        const listed = (answer: ComputerHelperAnswer, runs: boolean): readonly MacApp[] =>
          "outcome" in answer && "apps" in answer.outcome
            ? answer.outcome.apps
                .filter((app) => !app.refused)
                .map(({ name, bundleId, iconPng }) => ({
                  name,
                  ...(bundleId === undefined ? undefined : { bundleId }),
                  running: runs,
                  allowed: allowed.has(bundleId ?? name),
                  ...(iconPng === undefined ? undefined : { iconPng }),
                }))
            : [];

        const seen = new Set<string>();

        const apps = [...listed(running, true), ...listed(installed, false)].filter((app) => {
          const key = app.bundleId ?? app.name;
          const fresh = !seen.has(key);
          seen.add(key);

          return fresh;
        });

        return { apps };
      });

    /** One app's icon as the helper draws it, launching nothing; none where it finds no such app. */
    const appIcon = (use: MacComputerUse, app: string) =>
      Effect.map(
        use.helper.ask({ op: COMPUTER_HELPER_OP.DESCRIBE_APP, app }, DESCRIBE_WITHIN),
        (named) =>
          "described" in named && named.described.iconPng !== undefined
            ? { iconPng: named.described.iconPng }
            : {},
      );

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MACHINE_COMMANDS> = {};

    const acts: HostActTable<typeof MACHINE_COMMAND_ACTS> = {
      /** The developer's answer to one ask, by its id; one no longer waiting, answered or timed out, is answered all the same, since the prompt goes with it. */
      MACHINE_COMMAND_ANSWER: ({ id, decision, note }) =>
        Effect.gen(function* () {
          const held = asks.get(id);

          if (held === undefined) return;
          // Note that words are kept only with a denial, since an Allow hands the agent nothing to read.
          const denied = decision === MACHINE_COMMAND_DECISION.DENY && note !== undefined;
          const given: Answered = denied ? { decision, note } : { decision };
          const landed = held.posted === undefined ? false : yield* Deferred.await(held.posted);

          // Note that an ask the service never held is this Mac's alone to answer.
          if (!landed) return yield* Deferred.succeed(held.decided, given);

          // Note that an ask the service holds is decided by the answer it took first, never by this one alone, so an answer another device gave first stands; one it never took leaves the ask waiting.
          const standing = yield* askedOfService(client.answerAsk({ id, ...given }));

          if (standing !== undefined) yield* Deferred.succeed(held.decided, answeredOf(standing));
        }),
      /** Computer use as Settings shows it: the Mac's grants, and the apps agents use without asking. */
      COMPUTER_USE_STATUS: () =>
        Effect.all({
          permissions: permissionsRead(COMPUTER_HELPER_OP.PERMISSIONS),
          apps: computer === undefined ? Effect.succeed([]) : allowedAppsNamed(computer),
        }),
      /** The apps the composer's @ list offers on this Mac (`appsOnThisMac`). */
      COMPUTER_USE_APPS: () =>
        computer === undefined ? Effect.succeed({ apps: [] }) : appsOnThisMac(computer),
      /** One app's icon, for a row of the @ list that names an app installed but not running. */
      COMPUTER_USE_APP_ICON: ({ app }) =>
        computer === undefined ? Effect.succeed({}) : appIcon(computer, app),
      /** macOS asked for the grants it lacks, by its own prompts, and the grants as they stand once it was asked; refused where it could not be asked. */
      COMPUTER_USE_ASK_PERMISSIONS: permissionsAsked,
    };

    return { methods, acts, lifetime } satisfies MachineCommandsComposer;
  });
}
