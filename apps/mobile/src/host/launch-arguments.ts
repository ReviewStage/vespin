/**
 * launch-arguments.ts -- the launch arguments a flow runs the app under: `-fixture <profile>`, which stands the app's host on the desktop's synthetic data, as the desktop's `--fixture` does, `-authServer stub`, which signs in against an account service the app answers itself, `-agent <id>`, which opens on that agent's page, `-pullRequest <number>` beside it, which opens on that pull request of the agent's, `-connect <code>`, which hands the app a machine's pairing as its link would, `-liveActivity true`, which starts a fixture run's Live Activity (`-liveActivity done` starts it as it stands once none works), `-machineAsk true`, which has a fixture run's machine ask for an agent's command, `-setupOwed true`, which stands a fixture run's account as one owed setup, `-inboxOff true`, which stands a fixture run's account with its Inbox turned off, `-updateNeeded true`, which stands a fixture run as the service's refusal of an old build leaves it, `-refuseWrites true`, which has a fixture run refuse the writes a flow presses, `-busyAccount true`, which has the stub answer as a busy account's service does after a gap (`busy-account-server.ts`), `-pillField true`, which opens on the pill field's scratch page, `-streamTurn <ms>`, which has a fixture run's release Manager stream a turn, a change every that many milliseconds, while its page follows it, and `-sentryTest <js|native>`, which sends a test crash report.
 *
 * iOS registers a launch argument of the form `-key value` in the app's
 * `NSUserDefaults` argument domain, which React Native's `Settings` reads,
 * so a Maestro flow's `launchApp` arguments and `xcrun simctl launch
 * <device> <bundle> -fixture inbox` both arrive here. A run without the
 * argument, or naming a word that is no profile, leaves the host live, and
 * one without `-authServer stub` signs in against the real service.
 */

import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { Predicate } from "effect";
import { Settings } from "react-native";

/** The launch arguments the app reads: the fixture's profile, as `-fixture <profile>`, and the account service a flow signs in against, as `-authServer stub`. */
const LAUNCH_ARGUMENT = {
  FIXTURE: "fixture",
  AUTH_SERVER: "authServer",
  AGENT: "agent",
  PULL_REQUEST: "pullRequest",
  CONNECT: "connect",
  LIVE_ACTIVITY: "liveActivity",
  MACHINE_ASK: "machineAsk",
  SETUP_OWED: "setupOwed",
  INBOX_OFF: "inboxOff",
  UPDATE_NEEDED: "updateNeeded",
  REFUSE_WRITES: "refuseWrites",
  BUSY_ACCOUNT: "busyAccount",
  PILL_FIELD: "pillField",
  STREAM_TURN: "streamTurn",
  SENTRY_TEST: "sentryTest",
} as const;

/** The test reports `-sentryTest` may ask for: a handled JavaScript error, or a native crash. */
export const LAUNCH_SENTRY_TEST = {
  JS: "js",
  NATIVE: "native",
} as const;

/** The fixture Live Activities `-liveActivity` may start: agents working (`true`), or none working any more (`done`). */
export const LAUNCH_LIVE_ACTIVITY = {
  WORKING: "working",
  DONE: "done",
} as const;

export type LaunchLiveActivity = (typeof LAUNCH_LIVE_ACTIVITY)[keyof typeof LAUNCH_LIVE_ACTIVITY];

export type LaunchSentryTest = (typeof LAUNCH_SENTRY_TEST)[keyof typeof LAUNCH_SENTRY_TEST];

/** The one account service a launch argument may name in place of the real one. */
const STUB_AUTH_SERVER = "stub";

/** The profile this launch's arguments name, read from the defaults iOS registered them in; none for a word that is no profile. */
export function launchFixtureProfile(): RunProfile | undefined {
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.FIXTURE);

  return Object.values(RUN_PROFILE).find((profile) => profile === named);
}

/** Whether this launch signs in against the stubbed account service (`stub-auth-server.ts`) rather than the real one. */
export function launchStubsAuthServer(): boolean {
  return Settings.get(LAUNCH_ARGUMENT.AUTH_SERVER) === STUB_AUTH_SERVER;
}

/** The agent this launch opens on, as `-agent <id>` names it, as a flow reaches an agent's page; none where none is named. */
export function launchAgent(): string | undefined {
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.AGENT);

  return Predicate.isString(named) && named !== "" ? named : undefined;
}

/** The pull request of the launch's agent this launch opens on, as `-pullRequest <number>` names it; none where none is named. */
export function launchPullRequest(): number | undefined {
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.PULL_REQUEST);
  const number = Predicate.isNumber(named) ? named : Number(named);

  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** The pairing code a fixture run's launch hands the app, as `-connect <code>` names it, as a machine's link would (`maestro/settings-machine-connect.yaml`); none in a live run, and where none is named. */
export function launchHostConnect(): string | undefined {
  // Note that only a fixture run takes a code from its launch, since a live one takes a pairing only from its link.
  if (launchFixtureProfile() === undefined) return undefined;
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.CONNECT);

  return Predicate.isString(named) && named !== "" ? named : undefined;
}

/** Whether the launch argument `key` says true, as iOS registers `-key true`: a string, a boolean, or a number by how it was passed. */
function launchSaysTrue(key: string): boolean {
  const named: unknown = Settings.get(key);

  return named === true || named === "true" || named === 1;
}

/** The fixture run's own Live Activity this launch starts, as `-liveActivity true` (`maestro/live-activity.yaml`) or `-liveActivity done` asks; none without either. */
export function launchLiveActivity(): LaunchLiveActivity | undefined {
  if (Settings.get(LAUNCH_ARGUMENT.LIVE_ACTIVITY) === LAUNCH_LIVE_ACTIVITY.DONE)
    return LAUNCH_LIVE_ACTIVITY.DONE;

  return launchSaysTrue(LAUNCH_ARGUMENT.LIVE_ACTIVITY) ? LAUNCH_LIVE_ACTIVITY.WORKING : undefined;
}

/** Whether this launch's fixture run holds an ask of Ada's MacBook for an agent's command, as `-machineAsk true` asks (`maestro/machine-ask.yaml`). */
export function launchMachineAsk(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.MACHINE_ASK);
}

/** Whether this launch's fixture run stands its account as one that started setup and hasn't finished it, as `-setupOwed true` asks (`maestro/setup.yaml`). */
export function launchSetupOwed(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.SETUP_OWED);
}

/** Whether this launch's fixture run stands its account with its Inbox turned off, as `-inboxOff true` asks (`maestro/inbox-off.yaml`). */
export function launchInboxOff(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.INBOX_OFF);
}

/** Whether this launch's stub sign-in answers as the rig's busy account's service does after a gap, as `-busyAccount true` asks beside `-authServer stub` (`apps/mobile/scripts/busy-account.sh`). */
export function launchBusyAccount(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.BUSY_ACCOUNT);
}

/** Whether this launch stands a fixture run as the service's refusal of an old build leaves it, as `-updateNeeded true` asks (`maestro/update-needed.yaml`). */
export function launchUpdateNeeded(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.UPDATE_NEEDED);
}

/** Whether this launch opens on the pill field's scratch page, as `-pillField true` asks (`maestro/pill-field.yaml`). */
export function launchPillField(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.PILL_FIELD);
}

/** How often a fixture run's release Manager moves its turn while its page follows it, in milliseconds, as `-streamTurn <ms>` names it (`scripts/working-manager.sh`); none in a live run, and where none is named. */
export function launchStreamTurn(): number | undefined {
  if (launchFixtureProfile() === undefined) return undefined;
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.STREAM_TURN);
  const ms = Predicate.isNumber(named) ? named : Number(named);

  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/** Whether this launch's fixture run refuses the writes a flow presses, as `-refuseWrites true` asks, so a flow shoots the failure notice (`maestro/failure-notice.yaml`). */
export function launchRefusesWrites(): boolean {
  return launchSaysTrue(LAUNCH_ARGUMENT.REFUSE_WRITES);
}

/** The test report this launch asks Sentry for, as `-sentryTest <js|native>` names it (`crash-reports.ts`); none for a word that is no test. */
export function launchSentryTest(): LaunchSentryTest | undefined {
  const named: unknown = Settings.get(LAUNCH_ARGUMENT.SENTRY_TEST);

  return Object.values(LAUNCH_SENTRY_TEST).find((test) => test === named);
}
