/**
 * device-machine.ts -- the agent machine over the starter's Mac: the runner launched there by a line the Mac follows, its stdin written as more lines, and our doors read through requests the Mac answers.
 *
 * A local agent (`agent.machine` is `mac`) runs its runner on the
 * Mac it is pinned to (`agent.device_id`), which follows the rows the
 * service queues for it (`@repo/database/models/device-agent-store`, the wire
 * in `@repo/features/device-agent-wire`) and answers through its procedures
 * (`../device-agents-procedures.ts`). Nothing here reaches the Mac directly:
 * every call is a row, and the Mac's word is a row it settled or answered.
 *
 * `layout` and `open` answer at once, from the agent and the agents folder
 * its Mac registered, or its home folder where it named none, with no round
 * trip: the agent's folder there holds
 * its worktree, which the Mac makes as it takes the launch line, the files
 * a message carries, and the skills its member installed into the app
 * (`deviceAgentLayout`). A Mac whose release bundles a runner that keeps the
 * CLI's transcript at the service (`MAC_MACHINE.TRANSCRIPTS_SINCE`), by the
 * host version it last called with, has it kept there, as a sandbox's is,
 * Codex's threads at their default under the agent's home named for the
 * mirror; an older one keeps its sessions on its disk alone. Either resumes
 * a session the store does not hold whole from its disk (`diskSessions`).
 * `launchRunner` queues the launch line, its runner's
 * environment and first lines sealed together under the deployment's key
 * ring (`sealMacLaunchSecrets`) and opened again only by the Mac's claim,
 * which clears the row's copy. `writeLine`, `writeFiles`, and `kill` queue a
 * message, files, or stop line, files in as many lines as their size takes
 * (`DEVICE_AGENT_BOUNDS.MAX_FILES_LINE_BYTES`); a runner whose launch line
 * its Mac settled has ended, and a write to it answers `SandboxGone`,
 * so a message relaunches it. `runnerExit` reads the exit code the Mac settled the
 * launch line with.
 *
 * Note that every line of one agent is queued under its runner lease, which
 * every caller of `launchRunner`, `writeLine`, `writeFiles`, and `kill`
 * holds (`../coder-host/runner-sessions.ts`), because the lines' order is
 * their order of commit and only the lease keeps two from interleaving
 * (`device-agent-store.ts`'s header). The other calls queue no line: the Mac
 * has no firewall we set, so its `firewall` does nothing, and nothing
 * to stop, resume, or throw away, since a warm runner ends itself past its
 * window, settling its line, or is retired by the service under its lease:
 * by a message sent past it, or at its IDLE where its device waits to update
 * (`../coder-host/runner-sessions.ts`); the agent's folder goes from its
 * device only once the agent is archived (`../device-discard.ts`).
 * `wrote` reads whether a write was queued after the runner's launch line,
 * as a Stop's is, which the runner ends on.
 *
 * Whether a runner runs is read off the agent's newest launch line, which
 * stands for the record a sandbox's runner keeps in our store: it runs while that
 * line is unsettled and no stop line was queued after it, so a Stop is
 * honored the moment it is queued, whenever the Mac gets to it. A record
 * that no longer tells of a runner still running, as a retire's, queues a
 * stop line after it for the same reason, so a message sent next relaunches
 * rather than landing behind a line the runner ends on.
 *
 * `readFile` queues a request under an id it mints, waits for its answer
 * at most `MAC_MACHINE.ANSWER_WAIT`, and withdraws it however the wait ends; a Mac that has not beaten within
 * `MAC_PRESENCE.FRESH_MS` is away, and the call is unavailable at once, as a
 * stopped sandbox's is. `launchRunner`, `writeFiles`, and `writeLine` refuse
 * an away Mac at once too, as a Start on it is refused
 * (`LOCAL_AGENT_REFUSAL.MAC_AWAY`), and a host its account removed by name,
 * rather than queue a line no one may take for hours: a message, a Stop, or
 * a retire to it fails in words, and its open run is taken from it by the
 * agent's next reconcile once its Mac's lease lapses (`../coder-host/reconcile.ts`).
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { hasRepository, readAgent } from "@repo/database/models/agent-store";
import {
  type DeviceAgentPin,
  deviceAgentLineQueuedAfter,
  deviceAgentLineStanding,
  deviceAgentOfSession,
  deviceAgentPin,
  deviceAgentRequestAnswer,
  latestDeviceAgentLaunch,
  queueDeviceAgentLine,
  queueDeviceAgentRequest,
  withdrawDeviceAgentRequest,
  withdrawUnclaimedDeviceAgentLine,
} from "@repo/database/models/device-agent-store";
import { deviceLayout, devicesSeenSince } from "@repo/database/models/device-store";
import { hostRemoved } from "@repo/database/models/host-store";
import { parseKeyRing, sealMacLaunchSecrets } from "@repo/database/models/provider-key-seal";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { AGENT_MACHINE, MAC_PRESENCE } from "@repo/features/agent-wire";
import { CHECKOUT_DIFF_EXIT } from "@repo/features/checkout-diff";
import { CHECKOUT_RESTORE_EXIT } from "@repo/features/checkout-restore";
import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_CAPABILITY,
  DEVICE_GITHUB_ACCESS,
  type DeviceAgentAnswer,
  type DeviceAgentLaunchPayload,
  type DeviceAgentObject,
  type DeviceCapability,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLaunchSecretsSchema,
  deviceAgentLayoutIn,
  deviceAgentRestorePayloadSchema,
  deviceAgentsFolder,
} from "@repo/features/device-agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { hostVersionMeets } from "@repo/features/host-wire";
import {
  COMMAND_GONE,
  type CommandExit,
  type SandboxError,
  type SandboxFile,
  SandboxGone,
  SandboxUnavailable,
} from "@repo/sandbox";
import {
  Brand,
  Clock,
  type Context,
  Duration,
  Effect,
  Exit,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HostedEnvironment } from "../../environment.js";
import { heldUntil } from "../../http/held-read.js";
import { agentCommitIdentity, type CheckoutServices } from "../coder-host/checkout.js";
import {
  type AgentMachineService,
  CHECKOUT_DIFF_OUTCOME,
  type CheckoutDiffOutcome,
  type DeliveredCredentials,
  type FoundPlace,
  LaunchRefused,
  type MachineKept,
  type MachineLayout,
  type MachineName,
  type MachineOpen,
  type MachinePlace,
  type MachineRunning,
  type OpenedPlace,
  RESTORE_OUTCOME,
  RUNNER_RECORD,
  type RunnerCredential,
  type RunnerHandle,
  type RunnerLaunch,
} from "./agent-machine.js";

export const MAC_MACHINE = {
  /** How long a tool's request waits for its Mac's answer before the call is unavailable. */
  ANSWER_WAIT: Duration.seconds(30),
  /** How often a waiting request, or a runner's exit, is read again where the sync hub cannot wake it. */
  POLL: Duration.millis(250),
  /** How long a read of a runner's exit waits where its caller names no wait, as a sandbox's does. */
  EXIT_WAIT: Duration.seconds(2),
  /** How long a restore of the worktree waits for its Mac to settle the line, which a large worktree takes a while over. */
  RESTORE_WAIT: Duration.minutes(2),
  /**
   * The first host release whose bundled runner keeps the CLI's transcript
   * at the service where its config names `transcriptsUrl`, and reads a
   * session's chain through that store for a cut; a Mac on an older one
   * keeps its sessions on its disk alone, as before.
   */
  TRANSCRIPTS_SINCE: "0.11.0",
} as const;

/** Codex's own folder under a home, where it keeps its threads unless `CODEX_HOME` names another. */
const CODEX_DEFAULT_HOME = ".codex";

/**
 * The machine over the Mac, and whether a session is a local agent's, which
 * the router asks first (`agent-machines.ts`). Its open reaches none of the
 * services a sandbox's does, only the store it was made over; its launch
 * reads GitHub too, for who the agent's commits are by.
 */
export interface DeviceMachineService extends AgentMachineService {
  readonly owns: (session: string) => Effect.Effect<boolean, SandboxError>;
  readonly open: <A, E, R, B, EB, RB>(
    ask: MachineOpen<B, EB, RB>,
    use: (opened: OpenedPlace, beside: B) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | EB | LaunchRefused | { readonly _tag: string }, R | RB>;
  readonly launchRunner: <A, E, R, EL, RL, ES = never, RS = never>(
    place: MachinePlace,
    launch: RunnerLaunch<A, E, R, EL, RL, ES, RS>,
  ) => Effect.Effect<
    { readonly handle: RunnerHandle; readonly ready: A },
    E | EL | ES | SandboxError | { readonly _tag: string },
    R | RL | RS | CheckoutServices
  >;
}

const runningOfAgent = Brand.nominal<MachineRunning>();
const nameOfAgent = Brand.nominal<MachineName>();

const encodeFilesPayload = Schema.encodeSync(deviceAgentFilesPayloadSchema);
const encodeLaunchPayload = Schema.encodeSync(deviceAgentLaunchPayloadSchema);
const encodeRestorePayload = Schema.encodeSync(deviceAgentRestorePayloadSchema);
const encodeSecrets = Schema.encodeSync(Schema.fromJsonString(deviceAgentLaunchSecretsSchema));

/** Whether the Mac's host, by the version it last called with, runs a runner that keeps the CLI's transcript at the service (`MAC_MACHINE.TRANSCRIPTS_SINCE`). */
function keepsTranscripts(version: string | null): boolean {
  return version !== null && hostVersionMeets(version, MAC_MACHINE.TRANSCRIPTS_SINCE);
}

/** The agent's things on the Mac its layout was read off, under the agents folder that Mac registered, or its home folder where it named none. */
function macFolders(
  device: { readonly home: string; readonly agentsFolder: string | null },
  agentId: string,
) {
  // Note that a Mac's own word for its agents folder is taken over this build's root, so a release that moves the root on either side still lays a launch out where its Mac looks.
  return deviceAgentLayoutIn(device.agentsFolder ?? deviceAgentsFolder(device.home), agentId);
}

/**
 * Whether the account's Mac given keeps its runners' CLI transcripts at the
 * service, and where an agent's checkout stands on it, by the agent's id;
 * none where the account holds no such Mac standing, which no launch lays
 * out either. A continue or fork reads this to carry a session to or from a
 * Mac (`../coder-host/takeover.ts`).
 */
export const macCheckoutsOf = (userId: string, deviceId: string) =>
  Effect.map(
    deviceLayout(userId, deviceId),
    Option.map((device) => ({
      transcriptsKept: keepsTranscripts(device.version),
      checkoutPathOf: (agentId: string) => macFolders(device, agentId).checkoutPath,
    })),
  );

/** A local agent's place on its Mac, under our session given: the agent itself, since it has one place. */
function macPlace(session: string, agentId: string): MachinePlace {
  return {
    machine: AGENT_MACHINE.DEVICE,
    session,
    name: nameOfAgent(agentId),
    running: runningOfAgent(agentId),
  };
}

/** The line that writes the text given to a runner's stdin, as a message or a Stop is written and later looked for. */
function stdinLine(text: string) {
  return { kind: DEVICE_AGENT_LINE_KIND.MESSAGE, payload: { text } } as const;
}

/** A failure the store or the seal answered, as a machine's own: unavailable, with no words of the cause. */
function unavailable(): SandboxUnavailable {
  return new SandboxUnavailable({});
}

/** The account's topic, which every write to its agents' lines and requests notifies (`deviceAgentLineSync`, `deviceAgentRequestSync`): a Mac's claim, answer, or settle among them. */
function deviceTopics(userId: string): readonly SyncTopic[] {
  return [[TOPIC.ACCOUNT, userId]];
}

/**
 * The files given split into files lines, in their order, each holding at
 * most `DEVICE_AGENT_BOUNDS.MAX_FILES_LINE_BYTES` of paths and bytes; a file
 * is never split, so one larger goes in a line alone.
 */
function filesLines(files: readonly SandboxFile[]): readonly (readonly SandboxFile[])[] {
  const lines: SandboxFile[][] = [];
  let bytes = 0;
  for (const file of files) {
    const size = Buffer.byteLength(file.path) + file.contents.byteLength;
    const line = lines.at(-1);
    if (line === undefined || bytes + size > DEVICE_AGENT_BOUNDS.MAX_FILES_LINE_BYTES) {
      lines.push([file]);
      bytes = size;
    } else {
      line.push(file);
      bytes += size;
    }
  }
  return lines;
}

/**
 * A launch's credentials as a Mac's runner takes them, which no firewall of
 * ours stands in front of: each one's value in its variable, sealed with the
 * launch.
 */
function handedOnMac(credentials: readonly RunnerCredential[]): DeliveredCredentials {
  return {
    env: Object.fromEntries(credentials.map((each) => [each.variable, Redacted.value(each.value)])),
    swaps: new Map(),
  };
}

/**
 * The machine over the account's Macs, its store calls made on the services
 * given and its launches sealed under the deployment's key ring, where the
 * services carry one.
 */
function deviceMachineOver(
  context: Context.Context<DatabaseServices>,
  environment: Option.Option<typeof HostedEnvironment.Service>,
): DeviceMachineService {
  /** One store call on the services given, a failure of it unavailable. */
  const stored = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) =>
    effect.pipe(
      Effect.provideContext(context),
      Effect.mapError(() => unavailable()),
    );

  /** The local agent a place names, by its id. */
  const pinOfPlace = (place: MachinePlace) =>
    Effect.flatMap(stored(deviceAgentPin(place.running)), (pin) =>
      Option.isSome(pin) ? Effect.succeed(pin.value) : Effect.fail(unavailable()),
    );

  /** The local agent running in the session, where one does. */
  const pinOfSession = (session: string) => stored(deviceAgentOfSession(session));

  /** Where the agent's things stand on its Mac, under the agents folder that Mac registered, or its home folder where it named none; refused where it is pinned to no Mac of its starter's. */
  const layoutOf = (userId: string, agentId: string, deviceId: string | null | undefined) =>
    Effect.gen(function* () {
      if (deviceId === null || deviceId === undefined) {
        return yield* new LaunchRefused({ reason: "no mac" });
      }
      const device = yield* stored(deviceLayout(userId, deviceId));
      if (Option.isNone(device)) {
        // Note that a removed host is refused by name, so the member is told it is gone rather than to try again.
        return yield* (yield* stored(hostRemoved(userId, deviceId)))
          ? new LaunchRefused({ reason: "host removed", deviceRemoved: true })
          : new LaunchRefused({ reason: "no mac" });
      }
      const folders = macFolders(device.value, agentId);
      const kept = keepsTranscripts(device.value.version);
      const layout: MachineLayout = {
        checkoutPath: folders.checkoutPath,
        installedSkills: folders.installedSkills,
        // Note that the Mac writes the skills where they are installed, since no root installs them after.
        skillsUpload: folders.installedSkills,
        attachments: folders.attachments,
        // Note that the Mac answers reads inside the agent's folder alone, so what we read back is saved in its temp folder, never `/tmp`.
        sharedFiles: folders.temp,
        claudeExecutable: device.value.claudeExecutable,
        codexExecutable: device.value.codexExecutable ?? undefined,
        // Note that a Mac's Codex keeps its threads at its default under the agent's own home, named
        // only where the runner mirrors them, since the runner finds them by `CODEX_HOME` alone.
        codexHome: kept ? [folders.home, CODEX_DEFAULT_HOME].join("/") : undefined,
        // Note that the Mac's follower writes its lines to the stdin of the runner its release bundled.
        linesRead: false,
        transcriptsKept: kept,
        diskSessions: true,
        permissionModes: device.value.capabilities.includes(DEVICE_CAPABILITY.PERMISSION_MODES),
      };
      return layout;
    });

  /** One line queued for the agent; unavailable where the store holds no such agent on a Mac. */
  const queued = (
    pin: DeviceAgentPin,
    line: {
      readonly id?: string;
      readonly kind: (typeof DEVICE_AGENT_LINE_KIND)[keyof typeof DEVICE_AGENT_LINE_KIND];
      readonly payload: DeviceAgentObject;
      readonly sealedSecrets?: string;
    },
  ) =>
    Effect.flatMap(
      stored(queueDeviceAgentLine(pin.userId, { agentId: pin.agentId, ...line })),
      (row) => (Option.isSome(row) ? Effect.void : Effect.fail(unavailable())),
    );

  /** Whether the runner a handle names has ended: its launch line settled, or gone. */
  const runnerEnded = (pin: DeviceAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(deviceAgentLineStanding(pin.userId, handle.command)),
      (standing) => Option.isNone(standing) || standing.value.settled,
    );

  /** Whether the agent's Mac has beaten lately. */
  const present = (pin: DeviceAgentPin) =>
    Effect.gen(function* () {
      if (pin.deviceId === null) return false;
      const now = yield* Clock.currentTimeMillis;
      const since = new Date(now - MAC_PRESENCE.FRESH_MS);
      const seen = yield* stored(devicesSeenSince(pin.userId, since));
      return seen.some((device) => device.id === pin.deviceId);
    });

  /**
   * Refused as a Start on an away Mac is, where the agent's Mac has not
   * beaten lately; refused by name where it is a host its account removed,
   * which no presence read lists and no message brings back.
   */
  const refuseAway = (pin: DeviceAgentPin) =>
    Effect.gen(function* () {
      if (yield* present(pin)) return;
      if (pin.deviceId !== null && (yield* stored(hostRemoved(pin.userId, pin.deviceId)))) {
        return yield* new LaunchRefused({ reason: "host removed", deviceRemoved: true });
      }
      return yield* new LaunchRefused({ reason: "mac away", deviceAway: true });
    });

  /**
   * One request asked of the agent's Mac and its answer waited for, the row
   * withdrawn however the wait ends; unavailable where the Mac is away, or
   * did not answer in time.
   */
  const asked = (
    session: string,
    kind: (typeof DEVICE_AGENT_REQUEST_KIND)[keyof typeof DEVICE_AGENT_REQUEST_KIND],
    args: DeviceAgentObject,
  ) =>
    Effect.gen(function* () {
      const pin = yield* pinOfSession(session);
      if (Option.isNone(pin) || !(yield* present(pin.value))) return yield* unavailable();
      const { userId, agentId } = pin.value;
      const id = randomUUID();
      const answer = yield* Effect.gen(function* () {
        if (!(yield* stored(queueDeviceAgentRequest(userId, { id, agentId, kind, args })))) {
          return Option.none<DeviceAgentAnswer>();
        }
        const held = yield* heldUntil(
          stored(deviceAgentRequestAnswer(userId, id)),
          Option.isSome,
          deviceTopics(userId),
          MAC_MACHINE.POLL,
          MAC_MACHINE.ANSWER_WAIT,
        );
        return Option.flatMap(held, ({ read }) => read);
      }).pipe(Effect.ensuring(Effect.ignore(stored(withdrawDeviceAgentRequest(userId, id)))));
      if (Option.isNone(answer) || answer.value.kind !== kind) return yield* unavailable();
      return answer.value;
    });

  /** A line's exit as the Mac settled it: its code, gone where it settled with none or the line is gone, null while it stands unsettled. */
  const exitOfLine = (pin: DeviceAgentPin, lineId: string) =>
    Effect.map(stored(deviceAgentLineStanding(pin.userId, lineId)), (standing): CommandExit => {
      if (Option.isNone(standing)) return COMMAND_GONE;
      if (!standing.value.settled) return null;
      return standing.value.exitCode ?? COMMAND_GONE;
    });

  /** The runner's exit as its launch line was settled, as `exitOfLine` reads it. */
  const exitOf = (pin: DeviceAgentPin, handle: RunnerHandle) => exitOfLine(pin, handle.command);

  /** Whether the agent's Mac registered the capability (`DEVICE_CAPABILITY`); a Mac removed registered none. */
  const registered = (pin: DeviceAgentPin, capability: DeviceCapability) =>
    pin.deviceId === null
      ? Effect.succeed(false)
      : Effect.map(stored(deviceLayout(pin.userId, pin.deviceId)), (standing) =>
          Option.exists(standing, (device) => device.capabilities.includes(capability)),
        );

  /** Whether the agent's Mac registered that it takes a restore line (`DEVICE_CAPABILITY.RESTORE_CHECKOUT`). */
  const restoresCheckout = (pin: DeviceAgentPin) =>
    registered(pin, DEVICE_CAPABILITY.RESTORE_CHECKOUT);

  /** Whether the agent's Mac registered that it launches an agent on its own GitHub sign-in (`DEVICE_CAPABILITY.GITHUB_SIGN_IN`). */
  const signsInOwnGithub = (pin: DeviceAgentPin) =>
    pin.deviceId === null
      ? Effect.succeed(false)
      : Effect.map(stored(deviceLayout(pin.userId, pin.deviceId)), (standing) =>
          Option.exists(standing, (device) =>
            device.capabilities.includes(DEVICE_CAPABILITY.GITHUB_SIGN_IN),
          ),
        );

  /** The deployment's key ring, which a launch's secrets are sealed under; refused where it has none. */
  const keyRing = Effect.gen(function* () {
    const keys = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
    const ring = keys === undefined ? undefined : parseKeyRing(keys);
    if (ring === undefined || Result.isFailure(ring)) {
      return yield* new LaunchRefused({ reason: "no key ring" });
    }
    return ring.success;
  });

  return {
    owns: (session) => Effect.map(pinOfSession(session), Option.isSome),

    layout: (agent) => layoutOf(agent.userId, agent.id, agent.deviceId),

    deliverCredentials: (_agent, credentials) => handedOnMac(credentials),

    // The worktree is the device's to make of its shared clone as it takes the launch line, on the
    // agent's own GitHub token, or the device's own GitHub sign-in for an agent on its starter's
    // token, so the open asks the device nothing and leaves nothing to finish.
    open: (ask, use) =>
      Effect.gen(function* () {
        const [layout, beside] = yield* Effect.all(
          [layoutOf(ask.agent.userId, ask.agent.id, ask.agent.deviceId), ask.beside],
          { concurrency: "unbounded" },
        );
        return yield* use(
          {
            place: macPlace(ask.session, ask.agent.id),
            name: nameOfAgent(ask.agent.id),
            checkoutPath: layout.checkoutPath,
            finishCheckout: Effect.void,
          },
          beside,
        );
      }),

    // The session's pin names its account, so the account given is not needed to find it.
    findPlace: (_userId, session) =>
      Effect.gen(function* () {
        const pin = yield* pinOfSession(session);
        if (Option.isNone(pin)) return Option.none<FoundPlace>();
        const { userId, agentId } = pin.value;
        const launch = yield* stored(latestDeviceAgentLaunch(userId, agentId));
        const place = macPlace(session, agentId);
        const payload = Option.flatMap(launch, (line) =>
          Option.getSuccess(
            Schema.decodeUnknownResult(deviceAgentLaunchPayloadSchema)(line.payload),
          ),
        );
        const mark = Option.map(payload, (read) => ({
          firstSequence: read.firstSequence,
          ...(read.fingerprint === undefined ? {} : { fingerprint: read.fingerprint }),
        }));
        const live =
          Option.isSome(launch) &&
          Option.isSome(mark) &&
          !launch.value.settled &&
          !launch.value.stopped
            ? { handle: { ...place, command: launch.value.id }, mark: mark.value }
            : undefined;
        const found: FoundPlace = {
          machine: AGENT_MACHINE.DEVICE,
          session,
          agentId,
          name: nameOfAgent(agentId),
          running: place,
          runner: live,
          launch: Option.getOrUndefined(mark),
          // SAFETY: the pin is this machine's own to read back; no caller reads it.
          kept: pin.value as unknown as MachineKept,
        };
        return Option.some(found);
      }),

    // The record is the agent's launch and stop lines themselves, which `findPlace` reads: a
    // runner the record no longer tells of is stopped, and one it tells of was recorded by its launch.
    recordRunner: (place, record) =>
      Effect.gen(function* () {
        if (record.kind === RUNNER_RECORD.RUNNING) return;
        const pin = yield* pinOfPlace(macPlace(place.session, place.agentId));
        const launch = yield* stored(latestDeviceAgentLaunch(pin.userId, pin.agentId));
        if (Option.isNone(launch) || launch.value.settled || launch.value.stopped) return;
        yield* queued(pin, { kind: DEVICE_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    firewall: {
      write: () => Effect.void,
      keepLaunch: () => Effect.void,
    },

    // A local agent's place never stops, so it runs where it stands, and a runner that ended is launched again.
    resume: (found) =>
      found.running === undefined
        ? Effect.fail(unavailable())
        : Effect.succeed({ place: found.running, created: false }),

    stop: () => Effect.void,

    // The device removes the agent's folder on its own discard line (`device-discard.ts`), so
    // nothing is thrown away here; a retired bearer shuts its runner out.
    discard: () => Effect.void,

    // Note that files go to an away Mac no more than the message naming them does, so a message
    // refused while it is away leaves nothing behind for it to write when it is back. They go in
    // as many lines as their size takes, because the Mac's claim of one answers 4.5 MB at most;
    // each is queued in turn, so a line queued after them, as a launch, is delivered after them all.
    writeFiles: (place, files: readonly SandboxFile[]) =>
      Effect.flatMap(pinOfPlace(place), (pin) =>
        Effect.andThen(
          refuseAway(pin),
          Effect.forEach(
            filesLines(files),
            (line) =>
              queued(pin, {
                kind: DEVICE_AGENT_LINE_KIND.FILES,
                payload: encodeFilesPayload({
                  files: line.map((file) => ({
                    path: file.path,
                    mode: file.mode,
                    contents: file.contents,
                  })),
                }),
              }),
            { discard: true },
          ),
        ),
      ),

    // Note that only an agent in the cloud works in repositories beside its own, so a device clones none.
    checkOutMissing: () => Effect.void,
    // The secrets and the first lines are sealed together, bound to the agent, before the line is
    // queued; a launch whose line was not queued undoes what its caller recorded of it. Who the
    // agent's commits are by is read beside the caller's steps, as a sandbox's checkout finish reads it
    // (`agentCommitIdentity`), and kept as it ended, so a read that failed fails the launch where
    // its caller's record is undone; the Mac sets it in the agent's repository on every launch,
    // so an agent whose repository was made before the field gets it too.
    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(place);
        // Note that the refusal comes before the caller's steps run, so it has nothing to undo.
        yield* refuseAway(pin);
        const read = Effect.gen(function* () {
          const agent = yield* stored(readAgent(pin.userId, pin.agentId));
          if (Option.isNone(agent) || !hasRepository(agent.value))
            return { agent, identity: Exit.succeed(undefined) };
          const target = { userId: pin.userId, conversationId: agent.value.conversationId };
          return { agent, identity: yield* Effect.exit(agentCommitIdentity(target, agent.value)) };
        });
        // Note that a Mac's runner takes its config with its launch, so it starts on none of the caller's steps sooner.
        const [, ready, { agent, identity }, ring] = yield* Effect.all(
          [launch.started ?? Effect.void, launch.ready, read, keyRing],
          { concurrency: "unbounded" },
        );
        if (Option.isNone(agent)) return yield* new LaunchRefused({ reason: "no agent" });
        const onOwnSignIn =
          hasRepository(agent.value) && agent.value.githubAccess === GITHUB_ACCESS.TOKEN;
        // Note that an agent on its starter's own token whose host is a build from before it, as one whose host went back to an older release since its Start, is refused here too, since that host would ask for a token the service never hands a device.
        if (onOwnSignIn && !(yield* signsInOwnGithub(pin))) {
          yield* Effect.ignore(launch.abandon(ready));
          return yield* new LaunchRefused({ reason: "host predates its own github sign-in" });
        }
        const id = randomUUID();
        const handle: RunnerHandle = { ...place, command: id };
        yield* Effect.gen(function* () {
          const commitsBy = yield* identity;
          const layout = yield* layoutOf(pin.userId, pin.agentId, pin.deviceId);
          const { lines, mark } = yield* launch.firstLines(ready, handle);
          const sealedSecrets = sealMacLaunchSecrets(
            ring,
            { userId: pin.userId, agentId: pin.agentId },
            Redacted.make(encodeSecrets({ env: launch.env, stdin: lines })),
          );
          const payload: DeviceAgentLaunchPayload = {
            checkoutPath: layout.checkoutPath,
            repository: agent.value.repository,
            startBranch: agent.value.startBranch,
            firstSequence: mark.firstSequence,
            ...(mark.fingerprint === undefined ? {} : { fingerprint: mark.fingerprint }),
            ...(commitsBy === undefined ? {} : { identity: commitsBy }),
            ...(onOwnSignIn ? { githubAccess: DEVICE_GITHUB_ACCESS.TOKEN } : {}),
          };
          yield* queued(pin, {
            id,
            kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
            payload: encodeLaunchPayload(payload),
            sealedSecrets,
          });
        }).pipe(Effect.tapError(() => Effect.ignore(launch.abandon(ready))));
        return { handle, ready };
      }),

    writeLine: (handle, text) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        if (yield* runnerEnded(pin, handle)) {
          return yield* new SandboxGone({});
        }
        yield* refuseAway(pin);
        yield* queued(pin, stdinLine(text));
      }),

    // The runner's handle names its launch line, after which every write to it is queued in order.
    wrote: (handle, text) =>
      Effect.flatMap(pinOfPlace(handle), (pin) =>
        stored(deviceAgentLineQueuedAfter(pin.userId, handle.command, stdinLine(text))),
      ),

    runnerExit: (handle, within = MAC_MACHINE.EXIT_WAIT) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        const settled = yield* heldUntil(
          exitOf(pin, handle),
          (exit) => exit !== null,
          deviceTopics(pin.userId),
          MAC_MACHINE.POLL,
          within,
        );
        return Option.match(settled, { onNone: () => null, onSome: ({ read }) => read });
      }),

    kill: (handle) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        if (yield* runnerEnded(pin, handle)) return;
        yield* queued(pin, { kind: DEVICE_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    readFile: (session, path, bound) =>
      Effect.map(
        asked(session, DEVICE_AGENT_REQUEST_KIND.READ_FILE, {
          path,
          maxBytes: Math.min(bound, DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES) + 1,
        }),
        (answer) =>
          answer.kind === DEVICE_AGENT_REQUEST_KIND.READ_FILE && answer.bytes !== null
            ? answer.bytes
            : undefined,
      ),

    // A restore line put the worktree back, which its Mac settles with the restore's exit; a Mac whose host
    // takes no such line restores nothing, and one away is refused as every line to it is.
    restoreCheckout: (session, snapshot) =>
      Effect.gen(function* () {
        const pin = yield* pinOfSession(session);
        if (Option.isNone(pin)) return RESTORE_OUTCOME.MISSING;
        // A Mac away or removed is refused by name before its host's release is read, which a removed host has none of.
        yield* refuseAway(pin.value);
        if (!(yield* restoresCheckout(pin.value))) return RESTORE_OUTCOME.UNSUPPORTED;
        const id = randomUUID();
        yield* queued(pin.value, {
          id,
          kind: DEVICE_AGENT_LINE_KIND.RESTORE,
          payload: encodeRestorePayload(snapshot),
        });
        // Note that a line the Mac has not taken by the time the wait ends is withdrawn, because a Mac
        // back later would otherwise put the files back under whatever the agent has done since.
        const settled = yield* heldUntil(
          exitOfLine(pin.value, id),
          (exit) => exit !== null,
          deviceTopics(pin.value.userId),
          MAC_MACHINE.POLL,
          MAC_MACHINE.RESTORE_WAIT,
        ).pipe(
          Effect.ensuring(
            Effect.ignore(stored(withdrawUnclaimedDeviceAgentLine(pin.value.userId, id))),
          ),
        );
        const exit = Option.match(settled, { onNone: () => null, onSome: ({ read }) => read });
        if (exit === 0) return RESTORE_OUTCOME.RESTORED;
        if (exit === CHECKOUT_RESTORE_EXIT.MISSING) return RESTORE_OUTCOME.MISSING;
        // A follower from before the line settles it with no exit, having acted on nothing.
        if (exit === COMMAND_GONE) return RESTORE_OUTCOME.UNSUPPORTED;
        return RESTORE_OUTCOME.FAILED;
      }),

    // A diff request the Mac's host answers with the script's exit and what it printed; a Mac whose host
    // takes no such request diffs nothing, and one away is refused as every request to it is.
    diffCheckout: (session, range) =>
      Effect.gen(function* () {
        const pin = yield* pinOfSession(session);
        const missing: CheckoutDiffOutcome = { outcome: CHECKOUT_DIFF_OUTCOME.MISSING };
        if (Option.isNone(pin)) return missing;
        yield* refuseAway(pin.value);
        if (!(yield* registered(pin.value, DEVICE_CAPABILITY.DIFF_CHECKOUT))) {
          const unsupported: CheckoutDiffOutcome = { outcome: CHECKOUT_DIFF_OUTCOME.UNSUPPORTED };
          return unsupported;
        }
        const answer = yield* asked(session, DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT, {
          from: range.from,
          to: range.to,
        });
        if (answer.kind !== DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT) return missing;
        if (answer.exit === 0) {
          const diffed: CheckoutDiffOutcome = {
            outcome: CHECKOUT_DIFF_OUTCOME.DIFFED,
            diff: answer.diff,
          };
          return diffed;
        }
        if (answer.exit === CHECKOUT_DIFF_EXIT.MISSING) return missing;
        const failed: CheckoutDiffOutcome = { outcome: CHECKOUT_DIFF_OUTCOME.FAILED };
        return failed;
      }),

    // Note that a Mac is asked for no MP4, because nothing says it has an H.264 encoder, so its recordings keep their WebM alone.
    phoneVideo: () => Effect.succeed(undefined),
  };
}

/** The machine over the account's Macs, on the calling fiber's store and, where it has one, the deployment's key ring. */
export const deviceMachine: Effect.Effect<DeviceMachineService, never, DatabaseServices> =
  Effect.gen(function* () {
    const context = yield* Effect.context<DatabaseServices>();
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    return deviceMachineOver(context, environment);
  });
