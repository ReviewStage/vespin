import { INPUT_LINE, type InputLine } from "@repo/agent-runner/protocol";
import type {
  DeviceAgentBeat,
  DeviceAgentClaimedLine,
  DeviceAgentDevice,
  DeviceAgentUpdate,
  HostedDeviceAgentClient,
} from "@repo/features";
import { DEVICE_BEAT } from "@repo/features/agent-wire";
import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@repo/features/checkout-identity";
import { CHECKOUT_RESTORE_SCRIPT, checkoutRestoreEnv } from "@repo/features/checkout-restore";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_LAUNCH_STEP,
  DEVICE_LAUNCH_UNSTARTED,
  DEVICE_SETUP,
  type DeviceAgentLaunchSecrets,
  type DeviceAgentLayout,
  type DeviceAgentLine,
  type DeviceAgentRelease,
  type DeviceAgentRequest,
  type DeviceAgentRoots,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
  deviceAgentAttachmentsFolder,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLayoutIn,
  deviceAgentRestorePayloadSchema,
  deviceAgentStdinPayloadSchema,
  deviceAgentsFolder,
  deviceAgentTempFolder,
} from "@repo/features/device-agent-wire";
import { cappedExponential } from "@repo/wire/effect";
import {
  Clock,
  Config,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  FiberSet,
  Option,
  Path,
  Queue,
  Result,
  Schedule,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import type { Composer } from "./composer.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import type { HostKernel } from "./host-kernel.js";
import { agentOnBox } from "./local-agent-box.js";
import { LAUNCH_NOTE, notedFirstLines, sessionResumed } from "./local-agent-first-lines.js";
import {
  agentPlaces,
  answeredLocalAgentRequest,
  sharedFilesPrivate,
} from "./local-agent-requests.js";
import {
  forgetOwnedAgent,
  forgetRunnerGroup,
  keepOwnedAgent,
  keepRunnerGroup,
} from "./local-agent-state.js";
import { keepSetupStatus, SETUP_STEP, type SetupStep } from "./setup-status.js";

/**
 * compose-local-agents.ts -- runs on this device the coding agents the account starts on it, each straight on the box in a folder of its own: their runners started, fed, and stopped as the service's lines say, and their tools' reads and commands answered, for as long as its gate stands (`LocalAgentsDependencies.switchedOn`: open but while the service refuses the device, `daemon/host-standing.ts`).
 *
 * The service writes a local agent's work as rows under this device's id
 * (`@repo/features/device-agent-wire`, `contract/device-agents.ts`): lines
 * for its runner and requests from its tools, under the id the host enrolled
 * under (`LocalAgentsDependencies.deviceId`). Every time the gate opens, a
 * start among them, the device first has its agents' CLIs
 * (`LocalAgentClis.ready`: Claude Code, Codex, and GitHub's CLI, each
 * fetched and checked). A first fetch takes minutes, so while
 * it runs the device registers as preparing (`DEVICE_SETUP`) and beats, and
 * the menus list it as getting ready, which takes no agent; one that failed
 * registers why and beats, so it is listed as not set up rather than not at
 * all, and is tried again `SETUP_RETRY` later, for as long as the gate
 * stands. Once it has them it registers with
 * its home folder and the Claude Code and Codex its agents run on
 * (`LocalAgentPlatformSeam.tools`), which run on the logins signed in on the
 * device, never a sign-in saved in the account.
 * Then it beats every `BEAT_EVERY` from then on, while it lets go of what the
 * run before left and while it follows, each beat given `BEAT_DEADLINE` to
 * be answered, on a fiber of its own, so nothing the device does with an
 * answer holds up the next beat. It holds one read for its lines and one for its requests,
 * each answered by the service as soon as one waits, and claims each by its
 * id.
 *
 * Lines are claimed in the order the service lists them, its id order, and
 * handed to the agent they name, whose worker takes them one at a time, so
 * an agent's lines are delivered strictly in order while agents go on side
 * by side. Each claim carries a token minted for its line and kept until the
 * claim is answered, so a claim whose answer was lost is asked again as the
 * same claim, before the next read, and the line is delivered once; a launch
 * whose claim was asked again had its secrets taken by the answer lost, so
 * it is settled as a runner gone. A launch makes the agent's worktree of the
 * box's shared clone under its folder (`deviceAgentLayoutIn`) where it has
 * none, through the platform's script, sets in the clone's config who the
 * agent's commits are by where the line says, as a cloud checkout sets it
 * (`@repo/features/checkout-identity`), and starts the runner (`LocalAgentPlatformSeam.launch`), with the claim's
 * secrets in its environment and nowhere else, never a file, an argument, or
 * a log, and its first lines on its stdin; its line is settled with the
 * runner's exit code once it exits. As it goes, it reports on its line the
 * step it has reached (`DEVICE_LAUNCH_STEP`), which the agent's transcript
 * words until the harness's first event, and its failed turn names where a
 * launch settled unstarted stopped: preparing once it is taken, fetching
 * just before a repository is made, and starting just before the agent's
 * folders and Git are set up for the runner, each on a fiber of its own, so
 * the launch never waits on it. A
 * message or retune line is written to the running runner's stdin; a files
 * line writes its files under the agent's own folders; a stop line ends the
 * runner; a discard line ends it, saves the work in its worktree as a
 * snapshot in the shared clone, and removes the agent's folder with
 * everything in it, whatever it holds, and its attachments and shared files
 * with it, keeping all three where the snapshot could not be saved; a line of a kind it does not know is
 * settled untouched. A launch whose repository
 * could not be made is settled as not started, and the runner never
 * starts. A launch or files line keeps the agent as one whose folder this
 * machine made (`keepOwnedAgent`), and a discard that removes the folder
 * forgets it, so an uninstall removes this machine's agents and no other
 * install's beside it.
 *
 * Every host runs its agents straight on the box: the runner is a child of
 * the host's own process, the leader of a process group of its own, on the
 * host's own Node and the CLIs it keeps, as its user, in the agent's folder, on the
 * box user's own home and logins (`local-agent-box.ts`). Stopping it signals
 * its group alone, and kills the group once `KILL_GRACE` has passed, so
 * nothing of the host's or of any other agent's is stopped with it. The
 * group is kept in the machine's state while it runs (`keepRunnerGroup`),
 * so one that outlived a daemon killed outright is ended as the next
 * daemon starts (`daemon/host-runners-left.ts`). It
 * writes its temp files to the machine's own temp folder, its `TMPDIR`
 * handed on unchanged, which the OS clears itself, and what it saves for us
 * to read back to its folder beneath it (`deviceAgentTempFolder`). Its
 * folder, which holds its worktree alone, its attachments under the host's
 * state, and its shared files live as long as the agent: the next turn's
 * runner goes on from them, its repository, and its harness's session in the
 * box user's own home, until the agent's discard line removes them, and
 * nothing else does. An agent whose discard
 * line never reached the device, as one archived while the device was away
 * for longer than its line waits, keeps its folder until it is removed by
 * hand. A launch that finds none of the agent's work in its folder, as an
 * agent brought back after its discard does, and would continue a
 * harness's session, starts the agent afresh with none, from a repository
 * made anew, rebuilt from its snapshot where its discard saved one on this
 * box, and tells it so (`LAUNCH_NOTE.CLEARED`). An
 * agent working in a repository reaches GitHub as whoever is signed in on
 * the box, through the box user's own Git settings, gh sign-in, and SSH
 * agent, which is handed on; the device is handed no GitHub token for it,
 * and its repository is made in the host's own environment. Before its
 * repository is made, the launch checks that the box's sign-in reaches the
 * repository, prompting for nothing
 * (`LocalAgentPlatformSeam.repositoryReachedScript`), and a launch it does
 * not reach is settled as not started for that reason
 * (`DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN`), which its transcript words as
 * signing in with `gh auth login` or setting up SSH; a launch whose
 * worktree already stands is not checked again.
 *
 * A runner ends with the host, or with the gate, so none runs as the gate
 * opens. An agent this machine did not make is never touched. A launch the run
 * before left is still listed by the service, and the first answered beat
 * settles it as a runner gone, with no exit code: the agent's turn in
 * flight is settled lost, and its next message relaunches the runner on the
 * harness's session.
 *
 * The service's list of the device's open launches is what the device
 * runs: every beat answers it (`DeviceAgentBeat`), and the device converges
 * to it, apart from the beats and to the latest answer where it fell
 * behind. A runner whose launch the answer does not name, after a Stop, a
 * settle, or a lapse of the device's lease, is stopped as a stop line stops
 * it; and a launch it names that the device runs nothing for, and is not
 * starting, is settled as a runner gone. A runner's exit is settled once,
 * with its exit code; one the service did not take is settled as a runner
 * gone by the next beat, its exit code lost. Only what stood before the
 * beat was sent is judged against its answer, and a launch claimed,
 * starting, or whose exit is being settled is never settled by a beat,
 * since the answer may have been read before its claim or its settle.
 *
 * A host that updates itself (`LocalAgentsDependencies.update`,
 * `daemon/host-update.ts`) says on every beat where its update stands, and
 * is handed each answered beat's newer release. Once it holds one checked,
 * every beat asks each runner to end where it is warm (`INPUT_LINE.RETIRE`),
 * and the device switches to it as soon as it is idle: no runner runs, no
 * line it claimed waits to be delivered or is being delivered, no request
 * is being answered, and no claim's answer was lost. Its claims of lines
 * and requests stop first, under the lock every line's claim holds, and
 * idle is read again there, so a line claimed meanwhile keeps the device
 * on the release it runs and the switch waits for a later beat; once it
 * switches, the lines and requests it did not claim wait in the service
 * for the daemon started on the new release.
 *
 * Requests are each answered on a fiber of their own, inside the agent's
 * own folders alone (`local-agent-requests.ts`). The service refusing the
 * host's version shuts the gate: the reads end, and every runner is
 * stopped, as the quit stops them.
 *
 * The gate is a value that changes rather than one read again on a timer
 * (`LocalAgentsDependencies.switchedOn`): a gate shut waits for it to
 * open, asking the service nothing, and the follow and its beats end the
 * moment it shuts. A turn that died, or whose register the service did not
 * take, is tried again after `RETRY`, longer each time it fails in a row.
 */

/** How soon a turn that died, or whose register failed, is tried again: from `FIRST`, twice as long each time, never longer than `LONGEST`. */
const RETRY_AFTER = {
  FIRST: Duration.seconds(5),
  LONGEST: Duration.minutes(5),
} as const;

const RETRY = cappedExponential(RETRY_AFTER.FIRST, RETRY_AFTER.LONGEST);

/** How long a device whose setup failed waits before it tries again. */
const SETUP_RETRY = Duration.minutes(1);

/** How often a device following its agents beats, which the service's and the window's presence reads are derived from (`DEVICE_BEAT`). */
const BEAT_EVERY = Duration.millis(DEVICE_BEAT.EVERY_MS);

/** How long one beat waits for its answer before it is taken as unanswered, well inside `BEAT_EVERY`. */
const BEAT_DEADLINE = Duration.seconds(5);

/** How a held read the service did not answer is asked again. */
const REREAD = Duration.seconds(2);

/** How long a runner's process group has to end after SIGTERM before the group is sent SIGKILL. */
const KILL_GRACE = Duration.seconds(3);

/** How long making an agent's repository may take, a first clone of a large one or a wait on another launch's clone included, before its launch is given up. */
const WORKTREE_DEADLINE = Duration.minutes(25);

/** How long a restore of the worktree may run, as long as the service waits on its line (`MAC_MACHINE.RESTORE_WAIT`). */
const RESTORE_DEADLINE = Duration.minutes(2);

/** The exit code a launch is settled with where its worktree could not be made or its runner started. */
const NOT_STARTED = 1;

/** How long the check that the box's own GitHub sign-in reaches an agent's repository may take, its own steps bounded sooner, before the launch is given up as unreached. */
const SIGN_IN_CHECK_DEADLINE = Duration.minutes(2);

const VARIABLE = {
  HOME: "HOME",
  TMPDIR: "TMPDIR",
  SHELL: "SHELL",
  USER: "USER",
  LOGNAME: "LOGNAME",
  LANG: "LANG",
  PATH: "PATH",
  SSH_AUTH_SOCK: "SSH_AUTH_SOCK",
} as const;

/** The variables of the host's user a runner and a command are started with, read from the host's environment, the machine's own temp folder among them; nothing else of the host's is handed on. */
const HANDED_ON = [
  VARIABLE.HOME,
  VARIABLE.SHELL,
  VARIABLE.USER,
  VARIABLE.LOGNAME,
  VARIABLE.LANG,
  VARIABLE.TMPDIR,
];

/** Where a device's setup stands as it registers: nothing once it is ready, else preparing, or failed and why. */
type DeviceSetupRegister = Pick<DeviceAgentDevice, "setup" | "setupFailure">;

const decodeLaunch = Schema.decodeUnknownOption(deviceAgentLaunchPayloadSchema);
const decodeStdin = Schema.decodeUnknownOption(deviceAgentStdinPayloadSchema);

/** The stdin line that ends a runner where it is warm, and that one at work skips (`INPUT_LINE.RETIRE`). */
const RETIRE_LINE = `${JSON.stringify({ type: INPUT_LINE.RETIRE } satisfies InputLine)}\n`;
const decodeFiles = Schema.decodeUnknownOption(deviceAgentFilesPayloadSchema);
const decodeRestore = Schema.decodeUnknownOption(deviceAgentRestorePayloadSchema);

/** The service's side of local agents, as this concern asks it. */
type LocalAgentClient = Pick<
  HostedDeviceAgentClient,
  | "register"
  | "beat"
  | "lines"
  | "claimLine"
  | "lineStep"
  | "settleLine"
  | "requests"
  | "claimRequest"
  | "answerRequest"
>;

/**
 * A host's update of itself as the follower carries it (`daemon/host-update.ts`):
 * where it stands, which every beat says, each answered beat's release, and
 * the switch the follower runs once the device is idle.
 */
export interface LocalAgentsUpdate {
  /** Where the update stands, as the next beat says it; none while none is under way. */
  readonly beating: Effect.Effect<DeviceAgentUpdate | undefined>;
  /** An answered beat's release, none where it named none. */
  readonly heard: (release: DeviceAgentRelease | undefined) => Effect.Effect<void>;
  /** Whether a release is checked and waits for the device to be idle. */
  readonly waiting: Effect.Effect<boolean>;
  /** The switch to the release that waits, run while the device is idle and claims nothing, the beat given sent once it says it updates; whether it switched, after which the daemon ends. */
  readonly switched: (beat: Effect.Effect<unknown>) => Effect.Effect<boolean>;
}

export interface LocalAgentsDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "createId">;
  /** The device id the host enrolled under. */
  deviceId: string;
  /** Whether the device may ask the service, as it stands now and each time it changes: shut while the service refuses it. */
  switchedOn: Stream.Stream<boolean>;
  client: LocalAgentClient;
  /** The host's update of itself, where it runs from an account install's releases; none where it takes no notice of a newer release. */
  update?: LocalAgentsUpdate | undefined;
  /** Set to whether any runner runs, each time one starts or ends, as the host keeping its Mac awake reads it (`daemon/host-keep-awake.ts`); none where nothing reads it. */
  working?: SubscriptionRef.SubscriptionRef<boolean> | undefined;
}

/** A runner this Mac started: the launch line it settles, its stdin, and the process it is. */
interface Runner {
  readonly lineId: string;
  readonly stdin: Queue.Queue<string>;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  /** The fiber that settles the launch line once the runner exits. */
  readonly exited: Fiber.Fiber<void>;
}

/** A beat's answer, with the runners the device ran and the launches it knew of just before the beat was sent, which the answer is judged against. */
interface HeardBeat {
  readonly beat: DeviceAgentBeat;
  readonly ran: ReadonlyMap<string, Runner>;
  readonly knew: ReadonlySet<string>;
}

type LocalAgentServices =
  | Environment
  | Reporter
  | LocalAgentPlatform
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

export function composeLocalAgents(
  dependencies: LocalAgentsDependencies,
): Effect.Effect<Composer, never, LocalAgentServices> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const platform = yield* LocalAgentPlatform;

    const services = yield* Effect.context<
      | ChildProcessSpawner.ChildProcessSpawner
      | FileSystem.FileSystem
      | Path.Path
      | HttpClient.HttpClient
    >();

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environment = yield* Environment;

    const home = yield* Effect.orDie(
      Config.option(Config.String(VARIABLE.HOME)).parse(environment),
    );

    const shell = yield* Effect.orDie(
      Config.withDefault(Config.String(VARIABLE.SHELL), "/bin/zsh").parse(environment),
    );

    const handedOn: Record<string, string> = {};

    for (const name of [...HANDED_ON, VARIABLE.PATH]) {
      const value = yield* Effect.orDie(Config.option(Config.String(name)).parse(environment));

      if (Option.isSome(value)) handedOn[name] = value.value;
    }

    /** The host user's SSH agent, handed on to every agent, whose Git may reach GitHub over SSH with the keys it holds. */
    const sshAgent = Option.match(
      yield* Effect.orDie(Config.option(Config.String(VARIABLE.SSH_AUTH_SOCK)).parse(environment)),
      {
        onNone: (): Readonly<Record<string, string>> => ({}),
        onSome: (socket) => ({ [VARIABLE.SSH_AUTH_SOCK]: socket }),
      },
    );

    const { kernel, deviceId, switchedOn, client } = dependencies;

    /** The folders this device registers its agents' things under, for the home folder given: their own folders under it, their shared files under the machine's own temp folder, and their attachments under the host's state. */
    const rootsOf = (home: string): DeviceAgentRoots => ({
      agentsFolder: deviceAgentsFolder(home),
      tempFolder: deviceAgentTempFolder(platform.tempFolder),
      attachmentsFolder: deviceAgentAttachmentsFolder(kernel.stateRoot),
    });

    /** Where the agent's things stand on this device, for the home folder given (`rootsOf`). */
    const layoutIn = (home: string, agentId: string) => deviceAgentLayoutIn(rootsOf(home), agentId);

    /**
     * Whether the agent's shared files folder is this machine's own and
     * private (`sharedFilesPrivate`), made where it stands not, and then it
     * and its root made `0700`. Note that a root someone else made first, as
     * another user may on a temp folder every user shares (Linux's `/tmp`), is
     * refused rather than used, since whoever owns it could swap the agent's
     * folder beneath it for one of their own.
     */
    const sharedFilesSecured = (layout: DeviceAgentLayout) =>
      Effect.gen(function* () {
        yield* fileSystem.makeDirectory(layout.sharedFiles, { recursive: true, mode: 0o700 });

        if (!(yield* sharedFilesPrivate(layout))) return false;

        for (const place of [path.dirname(layout.sharedFiles), layout.sharedFiles]) {
          yield* fileSystem.chmod(place, 0o700);
        }

        return true;
      }).pipe(Effect.orElseSucceed(() => false));

    // -- the gate --------------------------------------------------------------

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideContext(call, services);

    /** Whether this device runs local agents, as `switchedOn` last said; shut until it first says. */
    const gate = yield* SubscriptionRef.make(false);

    /** Waits until the gate stands as `open` says, at once where it already does. */
    const gateStands = (open: boolean) =>
      SubscriptionRef.changes(gate).pipe(
        Stream.filter((now) => now === open),
        Stream.runHead,
        Effect.asVoid,
      );

    /** A beat, saying where the host's update stands while one is under way. */
    const beat = Effect.flatMap(
      dependencies.update?.beating ?? Effect.succeed(undefined),
      (updating) => asked(client.beat(deviceId, updating)),
    );

    /** One beat given `BEAT_DEADLINE` to be answered; its answer, none where it was not. */
    const timedBeat = <A>(beat: Effect.Effect<A | undefined>) =>
      Effect.map(Effect.timeoutOption(beat, BEAT_DEADLINE), Option.getOrUndefined);

    /**
     * The beats, each `beaten` (a beat alone, or a follow's beat with its
     * answer handed on), for as long as the gate stands; it returns once it
     * shuts. Note that they run every `BEAT_EVERY` on a fiber of their own,
     * because the window reads a device as away from how long ago it beat,
     * and nothing a beat's answer sets off may hold up the next.
     */
    const presence = (beaten: Effect.Effect<unknown> = timedBeat(beat)) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!(yield* SubscriptionRef.get(gate))) return;
          yield* Effect.forkScoped(Effect.repeat(beaten, Schedule.fixed(BEAT_EVERY)));
          yield* gateStands(false);
        }),
      );

    // -- what the agents run on --------------------------------------------------

    /**
     * Whether the device has its agents' CLIs (`LocalAgentClis.ready`),
     * asked each time the gate opens, and after a try that failed asked
     * again `SETUP_RETRY` later, one try at a time, for as long as the gate
     * stands; it answers false only once it shuts. As the first fetch
     * begins (`preparing`) the device registers as preparing and beats, so
     * the menus list it as getting ready rather than not at all; a try that
     * failed registers why and beats while it waits for the next, so it is
     * listed as not set up rather than away, and the tries after it register
     * as failed still, until one lands. `registered` registers the
     * device with where its setup stands.
     */
    /** Where this machine's setup stands, kept in its state for `vespin-host status` and the install script. */
    const keptStatus = (step: SetupStep, failure?: string) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        keepSetupStatus(kernel.stateRoot, {
          step,
          at,
          ...(failure === undefined ? undefined : { failure }),
        }),
      ).pipe(Effect.provideContext(services));

    const readyForOpening = (
      registered: (
        setup: DeviceSetupRegister,
      ) => Effect.Effect<boolean, never, HttpClient.HttpClient>,
    ) =>
      Effect.gen(function* () {
        // Note that a device whose last try failed says so through the next, so it reads failed rather than flickering back to setting up.
        let failure: string | undefined;

        for (;;) {
          const ready = yield* Effect.scoped(
            Effect.gen(function* () {
              const scope = yield* Effect.scope;

              const standing: DeviceSetupRegister =
                failure === undefined
                  ? { setup: DEVICE_SETUP.PREPARING }
                  : { setup: DEVICE_SETUP.FAILED, setupFailure: failure };

              const preparing = asked(registered(standing)).pipe(
                Effect.tap(() =>
                  failure === undefined ? keptStatus(SETUP_STEP.SETTING_UP) : Effect.void,
                ),
                Effect.andThen(Effect.forkIn(presence(), scope)),
                Effect.asVoid,
              );

              return yield* Effect.result(platform.clis.ready(preparing));
            }),
          );

          if (Result.isSuccess(ready)) return true;
          report(`the local agents' setup failed: ${ready.failure.detail}`);
          failure = ready.failure.detail;
          yield* keptStatus(SETUP_STEP.FAILED, failure);
          yield* asked(registered({ setup: DEVICE_SETUP.FAILED, setupFailure: failure }));

          // Note that the device stays listed with why while it waits, and the wait ends early as the gate shuts.
          const waited = yield* Effect.race(
            Effect.as(presence(), false),
            Effect.as(Effect.sleep(SETUP_RETRY), true),
          );

          if (!waited) return false;
        }
      });

    // -- the host user's own environment ---------------------------------------------

    /** The login shell's PATH, which a runner started by the host's service manager would otherwise go without. */
    const loginPath = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(shell, ["-l", "-c", 'printf %s "$PATH"'], {
          stdin: "ignore",
        });

        const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
        yield* handle.exitCode;

        return printed;
      }),
    ).pipe(
      Effect.timeoutOption(Duration.seconds(10)),
      Effect.map(Option.filter((printed) => printed.length > 0)),
      Effect.orElseSucceed(() => Option.none<string>()),
    );

    /**
     * What a runner and a command are started with of the device's own: the
     * host user's identity and shell, and their login shell's PATH, which
     * the agent's commands and the repository's script find git on, read once
     * each time the gate opens; never the rest of the host's environment,
     * which is the host's and none of the agent's.
     */
    const shellEnvironment = Effect.map(
      loginPath,
      (loginShellPath): Readonly<Record<string, string>> => ({
        ...handedOn,
        ...Option.match(loginShellPath, {
          onNone: () => ({}),
          onSome: (value) => ({ [VARIABLE.PATH]: value }),
        }),
      }),
    );

    // -- the follow --------------------------------------------------

    /**
     * The token each line's claim carries, by the line's id, minted at its
     * first claim and kept until a claim of it is answered, so the claim
     * asked again after its answer was lost is the same claim, which the
     * service answers again rather than refusing as taken. Note that it
     * outlives a follow, because a gate that shuts between a lost answer and
     * its re-ask would otherwise leave a launch the service granted that no
     * later follow asks for.
     */
    const claimTokens = new Map<string, string>();

    /** Everything one open gate runs, on the device it registered, from its home folder. */
    const follow = (folder: string, shellVariables: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        const workers = yield* FiberMap.make<string>();
        const mailboxes = new Map<string, Queue.Queue<DeviceAgentClaimedLine>>();
        const runners = new Map<string, Runner>();

        /** Whether any runner runs, told where the host reads it. */
        const workingTold = Effect.suspend(() =>
          dependencies.working === undefined
            ? Effect.void
            : SubscriptionRef.set(dependencies.working, runners.size > 0),
        );

        // Note that a follow that ends leaves no runner running, whatever its runners' own exits got to say.
        yield* Effect.addFinalizer(() =>
          dependencies.working === undefined
            ? Effect.void
            : SubscriptionRef.set(dependencies.working, false),
        );
        /** The launch lines no beat settles: those claimed and handed to their agents whose runners are not yet running or settled unstarted, and those whose runner ended until its settle is answered. */
        const starting = new Set<string>();
        /** Held by each claim and by a beat's settle of a launch the device runs nothing for, so neither runs while the other is unanswered. */
        const claiming = yield* Semaphore.make(1);
        /** The runners a beat stops, since the service no longer holds the device to their launches. */
        const stopping = yield* FiberSet.make();
        /** Whether no line or request is claimed, set under `claiming` once the device switches to a newer release, so they wait in the service for the daemon started on it. */
        let paused = false;
        /** How many lines were handed to their agents' workers and are not yet delivered, each counted from its hand-over until its worker is done with it. */
        let undelivered = 0;

        const answering = yield* FiberSet.make();

        const settle = (id: string, exitCode?: number) =>
          asked(client.settleLine(deviceId, id, exitCode));

        /**
         * The step a launch line's launch has reached, reported on a fiber of
         * the agent's scope, so the launch never waits on it; one refused or
         * unanswered, an older service's among them, says nothing. Note that
         * each is sent as the launch reaches it and may land out of order,
         * because the service only ever moves a line's step forward, so a
         * late report never takes it back.
         */
        const stepReported = (agentScope: Scope.Scope, id: string, step: DeviceLaunchStep) =>
          Effect.asVoid(Effect.forkIn(asked(client.lineStep(deviceId, id, step)), agentScope));

        /** A launch whose runner never started, settled as not started, with why where the device knows a reason the transcript words. */
        const notStarted = (id: string, unstarted?: DeviceLaunchUnstarted) =>
          asked(client.settleLine(deviceId, id, NOT_STARTED, unstarted));

        /**
         * The agent's worktree made where it has none, in the host's own
         * environment, which reaches GitHub on the box user's own sign-in,
         * and `fetching` run just before its script: a folder for an agent
         * with no repository.
         */
        const madeWorktree = (
          agentId: string,
          layout: DeviceAgentLayout,
          repository: string | null,
          branch: string | null,
          fetching: Effect.Effect<void>,
        ) =>
          Effect.gen(function* () {
            if (yield* fileSystem.exists(path.join(layout.checkoutPath, ".git"))) return true;

            if (repository === null) {
              yield* fileSystem.makeDirectory(layout.checkoutPath, { recursive: true });

              return true;
            }

            yield* fetching;

            const script = platform.worktreeScript({
              home: folder,
              repository,
              worktree: layout.checkoutPath,
              agentId,
              branch,
            });

            // Note that the script's own steps are cut off sooner where a transfer stalls; this bound is for the one that moves, or hangs, in a way they do not catch, and it holds the agent's delivery and the repository's clone for as long as it runs.
            const finished = yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make("/bin/bash", ["-c", script], {
                  cwd: folder,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                }),
                (handle) => handle.exitCode,
              ),
            ).pipe(Effect.timeoutOption(WORKTREE_DEADLINE));

            if (Option.isNone(finished)) {
              report(
                `a local agent's repository was not made within ${Duration.toMinutes(WORKTREE_DEADLINE)} minutes, so its launch was given up`,
              );

              return false;
            }

            return Number(finished.value) === 0;
          }).pipe(Effect.orElseSucceed(() => false));

        /**
         * Who the agent's commits are by, as the service settled it, set by
         * the step a cloud checkout sets it with (`CHECKOUT_IDENTITY_SCRIPT`);
         * whether it was. It is set in the shared clone's config, which every
         * worktree of it reads, and which holds the same for every agent of
         * the box: its owner's identity, read over the box user's own. Note
         * that it runs as the agent, in its worktree, never as the device's
         * own git, which a repository the agent rigged could steer; and on
         * every launch, since a clone made before the launch line carried an
         * identity holds none.
         */
        const identitySet = (layout: DeviceAgentLayout, identity: CheckoutIdentity) => {
          const run = agentOnBox(
            {
              command: "/bin/bash",
              args: ["-c", CHECKOUT_IDENTITY_SCRIPT],
              env: { ...shellVariables, ...checkoutIdentityEnv(identity) },
            },
            platform.clis.paths.gh,
          );

          return Effect.scoped(
            Effect.flatMap(
              ChildProcess.make(run.command, [...run.args], {
                cwd: layout.checkoutPath,
                env: run.env,
                extendEnv: false,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                forceKillAfter: KILL_GRACE,
              }),
              (handle) => handle.exitCode,
            ),
          ).pipe(
            Effect.map((code) => Number(code) === 0),
            Effect.orElseSucceed(() => false),
          );
        };

        /**
         * Whether the box's own GitHub sign-in reaches the agent's
         * repository: `repositoryReachedScript` run in the box user's home
         * with their SSH agent, prompting for nothing, within
         * `SIGN_IN_CHECK_DEADLINE`. Nothing it prints is kept.
         */
        const signInReaches = (repository: string) =>
          Effect.gen(function* () {
            const run = agentOnBox(
              {
                command: "/bin/bash",
                args: ["-c", platform.repositoryReachedScript(repository)],
                env: { ...shellVariables, ...sshAgent },
              },
              platform.clis.paths.gh,
            );

            const code = yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make(run.command, [...run.args], {
                  cwd: folder,
                  env: run.env,
                  extendEnv: false,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                }),
                (handle) => handle.exitCode,
              ),
            ).pipe(Effect.timeoutOption(SIGN_IN_CHECK_DEADLINE));

            return Option.isSome(code) && Number(code.value) === 0;
          }).pipe(Effect.orElseSucceed(() => false));

        /** Whether the agent's work stands in its folder: its repository, or its checkout folder for an agent with none. */
        const workExists = (layout: DeviceAgentLayout, withRepository: boolean) =>
          Effect.orElseSucceed(
            fileSystem.exists(
              withRepository ? path.join(layout.checkoutPath, ".git") : layout.checkoutPath,
            ),
            () => false,
          );

        /**
         * The runner started for a launch line, its first lines written, and
         * its exit settling the line; the line settled as not started where it
         * cannot be. A launch that finds none of the agent's work in its
         * folder (`workExists`), which was cleared since its last turn, and
         * would continue a harness's session, lets that session go and starts
         * the agent afresh from a repository made anew, telling it so ahead of
         * its first message (`LAUNCH_NOTE.CLEARED`).
         */
        const launched = (
          agentId: string,
          line: DeviceAgentLine,
          secrets: DeviceAgentLaunchSecrets | undefined,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const layout = layoutIn(folder, agentId);
            const payload = decodeLaunch(line.payload);

            // Note that a launch naming a worktree outside the agent's own folder is never made.
            if (
              Option.isNone(payload) ||
              secrets === undefined ||
              payload.value.checkoutPath !== layout.checkoutPath
            ) {
              return yield* notStarted(line.id);
            }

            const { repository, identity } = payload.value;
            const withRepository = repository !== null;
            // Note that the agent is kept as this machine's before its folder is made, so an uninstall finds whatever a launch cut off left.
            yield* keepOwnedAgent(kernel.stateRoot, agentId);
            const worked = yield* workExists(layout, withRepository);
            const cleared = sessionResumed(secrets.stdin) && !worked;

            if (cleared) {
              report("a local agent's folder was cleared since its last turn, so it starts afresh");
            }

            // Note that the box's own sign-in is checked only where the repository is to be made, so a sign-in that cannot reach it fails the launch in words of its own rather than as a fetch, and a later turn's launch on the worktree that stands waits on no network.
            if (withRepository && !worked && !(yield* signInReaches(repository))) {
              report(
                "a local agent's repository is not reached on this machine's own GitHub sign-in, so its launch was not started",
              );

              return yield* notStarted(line.id, DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN);
            }

            const made = yield* madeWorktree(
              agentId,
              layout,
              repository,
              payload.value.startBranch,
              stepReported(agentScope, line.id, DEVICE_LAUNCH_STEP.FETCHING),
            );

            if (!made) return yield* notStarted(line.id);
            // Note that starting is said before the agent's folders and Git are set up, so a launch that stops there is worded as starting rather than by the step before.
            yield* stepReported(agentScope, line.id, DEVICE_LAUNCH_STEP.STARTING);

            if (!(yield* sharedFilesSecured(layout))) {
              report(
                "a local agent's shared files folder is not this machine's own and private, so its launch was not started",
              );

              return yield* notStarted(line.id);
            }

            const runnerScope = yield* Scope.fork(agentScope);

            if (
              withRepository &&
              identity !== undefined &&
              !(yield* identitySet(layout, identity))
            ) {
              yield* Scope.close(runnerScope, Exit.void);
              report("a local agent's commit identity could not be set in its repository");

              return yield* notStarted(line.id);
            }

            const stdin = yield* Queue.unbounded<string>();
            const encoder = new TextEncoder();
            // Note that the runner's record is forgotten only once its group has been ended as its scope closes, so a daemon killed meanwhile leaves it for the next start (`daemon/host-runners-left.ts`).
            yield* Scope.addFinalizer(
              runnerScope,
              Effect.provideContext(forgetRunnerGroup(kernel.stateRoot, agentId), services),
            );

            const command = platform.launch({
              agentId,
              folder: layout.folder,
              checkout: layout.checkoutPath,
              node: platform.tools.node,
              bundle: platform.runnerBundle,
              env: {
                ...shellVariables,
                ...sshAgent,
                ...platform.runnerEnv,
                ...secrets.env,
              },
            });

            const started = yield* ChildProcess.make(command.command, [...command.args], {
              cwd: layout.checkoutPath,
              env: command.env,
              extendEnv: false,
              // Note that stdin stays open past the first lines, since every later line of the agent's is written to it.
              stdin: {
                stream: Stream.fromQueue(stdin).pipe(Stream.map((text) => encoder.encode(text))),
                endOnDone: false,
              },
              // Note that nothing the runner prints is kept, since a credential must never reach a log.
              stdout: "ignore",
              stderr: "ignore",
              forceKillAfter: KILL_GRACE,
            }).pipe(Scope.provide(runnerScope), Effect.option);

            if (Option.isNone(started)) {
              yield* Scope.close(runnerScope, Exit.void);

              return yield* notStarted(line.id);
            }

            const handle = started.value;
            yield* keepRunnerGroup(kernel.stateRoot, agentId, handle.pid);
            yield* Queue.offer(
              stdin,
              notedFirstLines(secrets.stdin, cleared ? [LAUNCH_NOTE.CLEARED] : [], cleared),
            );

            const exited = yield* Effect.gen(function* () {
              const code = yield* Effect.option(handle.exitCode);
              runners.delete(agentId);
              // Note that the launch is starting again until its settle is answered, so no beat settles it as a runner gone before its runner's scope closes and its exit code is sent.
              starting.add(line.id);
              // Note that whether any runner works is told once its runner's scope has closed and its launch is settled, so a Mac kept awake for it does not sleep while it is.
              yield* Scope.close(runnerScope, Exit.void).pipe(
                Effect.andThen(settle(line.id, Option.getOrUndefined(Option.map(code, Number)))),
                Effect.ensuring(
                  Effect.andThen(
                    Effect.sync(() => starting.delete(line.id)),
                    workingTold,
                  ),
                ),
              );
            }).pipe(Effect.forkIn(agentScope));

            runners.set(agentId, { lineId: line.id, stdin, handle, exited });
            yield* workingTold;
          });

        /**
         * The runner given stopped and its exit waited for, so its line is
         * settled first. Its process group alone is asked to end (SIGTERM)
         * and killed once `KILL_GRACE` has passed, so nothing of the host's or
         * of another agent's is stopped with it.
         */
        const ended = (runner: Runner) =>
          Effect.gen(function* () {
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
          });

        /** The agent's runner, where one runs, stopped and its exit waited for (`ended`). */
        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);

            if (runner === undefined) return;
            yield* ended(runner);
          });

        /**
         * The agent's own places removed with everything in them (`agentPlaces`), then the entry its
         * worktree held in the shared clone pruned (`git worktree prune`), so
         * the clone lists no worktree that stands no more. The clone is read
         * from the link the worktree's `.git` file holds, before the folder
         * goes; an agent with no repository has no link. Note that a prune
         * that fails is let be, since
         * the next removal's prune takes every entry of the clone whose
         * worktree is gone.
         */
        const folderRemoved = (layout: DeviceAgentLayout) =>
          Effect.gen(function* () {
            const link = yield* Effect.option(
              fileSystem.readFileString(path.join(layout.checkoutPath, ".git")),
            );

            for (const place of agentPlaces(layout)) {
              yield* fileSystem.remove(place, { recursive: true, force: true });
            }

            const linked = Option.flatMap(link, (text) =>
              Option.fromNullishOr(/^gitdir: (.+)$/mu.exec(text)?.[1]),
            );

            if (Option.isNone(linked)) return;
            // Note that a worktree's own Git folder stands under `worktrees/` in the shared clone's.
            const shared = path.resolve(layout.checkoutPath, linked.value, "..", "..");
            yield* Effect.ignore(
              Effect.scoped(
                Effect.flatMap(
                  ChildProcess.make("git", ["worktree", "prune"], {
                    cwd: shared,
                    env: shellVariables,
                    extendEnv: false,
                    stdin: "ignore",
                    stdout: "ignore",
                    stderr: "ignore",
                    forceKillAfter: KILL_GRACE,
                  }),
                  (handle) => handle.exitCode,
                ),
              ),
            );
          });

        /**
         * Whether the agent's work in its worktree was saved as a snapshot in
         * the shared clone, or needed none (`snapshotScript`), run in the
         * host's own environment within `WORKTREE_DEADLINE`.
         */
        const snapshotSaved = (agentId: string, layout: DeviceAgentLayout) =>
          Effect.scoped(
            Effect.flatMap(
              ChildProcess.make(
                "/bin/bash",
                ["-c", platform.snapshotScript({ worktree: layout.checkoutPath, agentId })],
                {
                  cwd: folder,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                },
              ),
              (handle) => handle.exitCode,
            ),
          ).pipe(
            Effect.timeoutOption(WORKTREE_DEADLINE),
            Effect.map((finished) => Option.isSome(finished) && Number(finished.value) === 0),
            Effect.orElseSucceed(() => false),
          );

        /**
         * The agent let go of: its runner stopped and its exit settled, its
         * work saved as a snapshot its next launch on this box rebuilds from
         * (`snapshotSaved`), and its folder removed with everything in it,
         * whatever it holds, its worktree and what its runner and commands
         * wrote there, its attachments and shared files with it, and its
         * worktree's entry pruned from the shared clone, which stays
         * (`folderRemoved`); then the agent is no longer this machine's. A
         * snapshot that could not be saved keeps them all, reported, rather
         * than lose the agent's unsaved work. A step that
         * fails is reported, and the agent stays this machine's, so an
         * uninstall still finds what is left of its folder.
         */
        const discarded = (agentId: string) =>
          Effect.gen(function* () {
            yield* stopped(agentId);
            const layout = layoutIn(folder, agentId);

            if (!(yield* snapshotSaved(agentId, layout))) {
              report(`a local agent's work could not be saved, so its folder was kept: ${agentId}`);

              return;
            }

            yield* folderRemoved(layout);
            yield* forgetOwnedAgent(kernel.stateRoot, agentId);
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => report(`a local agent's folder could not be removed: ${agentId}`)),
            ),
          );

        /** A files line's files written under the agent's own places (`agentPlaces`), each at its mode; one whose path names a place outside them is never written. */
        const wroteFiles = (agentId: string, payload: unknown) =>
          Effect.gen(function* () {
            const files = decodeFiles(payload);

            if (Option.isNone(files)) return;
            yield* keepOwnedAgent(kernel.stateRoot, agentId);
            const layout = layoutIn(folder, agentId);

            for (const file of files.value.files) {
              const target = path.normalize(file.path);

              if (!agentPlaces(layout).some((place) => target.startsWith(`${place}/`))) continue;
              yield* fileSystem.makeDirectory(path.dirname(target), {
                recursive: true,
                mode: 0o700,
              });
              yield* fileSystem.writeFile(target, file.contents, { mode: file.mode });
              yield* fileSystem.chmod(target, file.mode);
            }
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => report("a local agent's files could not be written")),
            ),
          );

        /**
         * The agent's worktree put back to the snapshot a restore line
         * names, by the one restore script both machines run
         * (`@repo/features/checkout-restore`), run as the agent in the
         * worktree with the snapshot in its variables, once the agent's
         * runner has ended, which the service asked first and is waited for
         * here too, so nothing writes to the worktree as it is put back. Answers the script's exit code, which the
         * service reads the outcome from (the snapshot missing among them),
         * and 1 where it could not run, ran past `RESTORE_DEADLINE`, or the line's payload could not be
         * read. Nothing it prints is kept.
         */
        const restored = (agentId: string, payload: unknown) =>
          Effect.gen(function* () {
            const snapshot = decodeRestore(payload);

            if (Option.isNone(snapshot)) return 1;
            yield* stopped(agentId);
            const layout = layoutIn(folder, agentId);

            const run = agentOnBox(
              {
                command: "/bin/bash",
                args: ["-c", CHECKOUT_RESTORE_SCRIPT],
                env: { ...shellVariables, ...checkoutRestoreEnv(snapshot.value) },
              },
              platform.clis.paths.gh,
            );

            return yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make(run.command, [...run.args], {
                  cwd: layout.checkoutPath,
                  env: run.env,
                  extendEnv: false,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                }),
                (handle) => handle.exitCode,
              ),
            ).pipe(
              Effect.timeoutOption(RESTORE_DEADLINE),
              Effect.map((code) => (Option.isSome(code) ? Number(code.value) : 1)),
              Effect.orElseSucceed(() => 1),
            );
          });

        /**
         * One line of the agent's, delivered: a runner started, written to,
         * or stopped, files written, the worktree put back, or the agent let
         * go of; every line but a launch and a restore settled at once. A kind this follower does not know, one a
         * newer service added, is settled without being acted on, so it never
         * holds back the agent's later lines.
         */
        const delivered = (
          agentId: string,
          claimed: DeviceAgentClaimedLine,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const { line } = claimed;

            switch (line.kind) {
              case DEVICE_AGENT_LINE_KIND.LAUNCH:
                // Note that a launch replaces the runner it finds, which is ended and its line settled first.
                // It is starting until its runner runs or it is settled unstarted, so no beat settles it meanwhile.
                return yield* Effect.gen(function* () {
                  // Note that it reads as preparing while the runner it replaces stops, unless it is settled at once.
                  if (claimed.secretsGone !== true) {
                    yield* stepReported(agentScope, line.id, DEVICE_LAUNCH_STEP.PREPARING);
                  }

                  yield* stopped(agentId);

                  // Note that a launch whose claim was asked again lost its secrets with the first answer, so it is settled as a runner gone, which ends its turn in words.
                  if (claimed.secretsGone === true) return yield* settle(line.id);

                  return yield* launched(agentId, line, claimed.secrets, agentScope);
                }).pipe(Effect.ensuring(Effect.sync(() => starting.delete(line.id))));
              case DEVICE_AGENT_LINE_KIND.MESSAGE:
              case DEVICE_AGENT_LINE_KIND.RETUNE: {
                const text = decodeStdin(line.payload);
                const runner = runners.get(agentId);

                if (Option.isSome(text) && runner !== undefined) {
                  yield* Queue.offer(runner.stdin, text.value.text);
                }

                break;
              }

              case DEVICE_AGENT_LINE_KIND.FILES:
                yield* wroteFiles(agentId, line.payload);
                break;
              case DEVICE_AGENT_LINE_KIND.STOP:
                yield* stopped(agentId);
                break;
              case DEVICE_AGENT_LINE_KIND.DISCARD:
                yield* discarded(agentId);
                break;
              // A restore is settled with its exit, which the service reads the outcome from.
              case DEVICE_AGENT_LINE_KIND.RESTORE:
                return yield* settle(line.id, yield* restored(agentId, line.payload));
            }

            yield* settle(line.id);
          });

        /** A claimed line handed to its agent's worker, a launch marked starting first, so no beat settles it before its runner runs. */
        const handedOver = (claimed: DeviceAgentClaimedLine) =>
          Effect.gen(function* () {
            if (claimed.line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH) starting.add(claimed.line.id);
            undelivered += 1;
            yield* Queue.offer(yield* mailboxOf(claimed.line.agentId), claimed);
          });

        /** The agent's mailbox, its worker started the first time a line of its arrives. */
        const mailboxOf = (agentId: string) =>
          Effect.gen(function* () {
            const kept = mailboxes.get(agentId);

            if (kept !== undefined) return kept;
            const mailbox = yield* Queue.unbounded<DeviceAgentClaimedLine>();
            mailboxes.set(agentId, mailbox);

            const worker = Effect.scoped(
              Effect.gen(function* () {
                const agentScope = yield* Effect.scope;

                for (;;) {
                  const claimed = yield* Queue.take(mailbox);
                  yield* delivered(agentId, claimed, agentScope).pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        undelivered -= 1;
                      }),
                    ),
                  );
                }
              }),
            );

            yield* FiberMap.run(workers, agentId, worker);

            return mailbox;
          });

        /**
         * One line claimed by its id under its token, asked once; refused, or
         * nothing where unanswered. Note that an unanswered claim keeps its
         * token, so `linesFollowed` asks it again before its next read rather
         * than this holding `claiming` through repeats of its own.
         */
        const claimedLine = (id: string) =>
          Effect.gen(function* () {
            const token = claimTokens.get(id) ?? kernel.createId();
            claimTokens.set(id, token);
            const answer = yield* asked(client.claimLine(deviceId, id, token));

            if (answer !== undefined) claimTokens.delete(id);

            return answer;
          });

        /**
         * One line claimed and, where granted, handed to its agent's mailbox;
         * whether the claim was answered. Note that the claim and its
         * hand-over are uninterruptible, because a line the service granted
         * is this Mac's alone to deliver, and its token is let go of in the
         * same step, so no line is handed over twice. Both hold `claiming`,
         * and a beat leaves a line whose token is kept, so it never settles a
         * launch whose claim is unanswered; none is asked once the device has
         * paused its claims to switch releases.
         */
        const lineTaken = (id: string) =>
          Effect.uninterruptible(
            claiming.withPermit(
              Effect.gen(function* () {
                if (paused) return false;
                const answer = yield* claimedLine(id);

                if (answer === undefined) return false;

                if ("line" in answer) yield* handedOver(answer);

                return true;
              }),
            ),
          );

        /**
         * The lines read and claimed in the service's order, each handed to
         * its agent's mailbox. A claim never answered ends the batch there,
         * so a later line of the same agent is never delivered before it, and
         * is asked again under its token after `REREAD`, before the next read,
         * since the service lists no line once claimed and the claim may have
         * landed.
         */
        const linesFollowed = Effect.forever(
          Effect.gen(function* () {
            if (paused) return yield* Effect.sleep(REREAD);

            for (const id of [...claimTokens.keys()]) {
              if (!(yield* lineTaken(id))) return yield* Effect.sleep(REREAD);
            }

            const lines = yield* asked(client.lines(deviceId));

            if (lines === undefined) return yield* Effect.sleep(REREAD);

            for (const line of lines) {
              if (!(yield* lineTaken(line.id))) return yield* Effect.sleep(REREAD);
            }
          }),
        );

        /** One request claimed, asked once, and answered on a fiber of its own. */
        const answered = (request: DeviceAgentRequest) =>
          Effect.gen(function* () {
            if (paused) return;
            const claimed = yield* asked(client.claimRequest(deviceId, request.id));

            if (claimed === undefined || !("agentId" in claimed)) return;
            const layout = layoutIn(folder, claimed.agentId);

            const answer = yield* answeredLocalAgentRequest(
              layout,
              { env: shellVariables, gh: platform.clis.paths.gh },
              claimed,
            ).pipe(Effect.provideContext(services));

            yield* asked(client.answerRequest(deviceId, claimed.id, answer));
          });

        /** The requests read, each answered on its own fiber, so a slow read holds up neither the reads nor the others. */
        const requestsFollowed = Effect.forever(
          Effect.gen(function* () {
            if (paused) return yield* Effect.sleep(REREAD);
            const requests = yield* asked(client.requests(deviceId));

            if (requests === undefined) return yield* Effect.sleep(REREAD);

            for (const request of requests) yield* FiberSet.run(answering, answered(request));
          }),
        );

        /** The launch lines of the runners running now. */
        const runningLaunches = () => new Set([...runners.values()].map((runner) => runner.lineId));

        /**
         * One beat, with what the device ran and knew of read just before it
         * was sent, because the answer is read after it: a launch claimed
         * later is never judged against an answer that could not have named
         * it. None where the beat was not answered.
         */
        const heardBeat = Effect.gen(function* () {
          const ran: ReadonlyMap<string, Runner> = new Map(runners);
          const knew: ReadonlySet<string> = new Set([...starting, ...runningLaunches()]);
          const answer = yield* beat;

          return answer === undefined
            ? undefined
            : ({ beat: answer, ran, knew } satisfies HeardBeat);
        });

        /**
         * The device converged to the launches a beat's answer (`heard`)
         * holds it to: every runner that ran as the beat was sent whose
         * launch the answer does not name stopped, as a stop line stops it;
         * and every launch the answer names that the device neither ran nor
         * started as the beat was sent, and still does not, settled as a
         * runner gone. A beat not answered converges nothing.
         */
        const reconciledBeat = (heard: HeardBeat | undefined) =>
          Effect.gen(function* () {
            if (heard === undefined) return;
            const open = new Set(heard.beat.openLaunches);

            for (const [agentId, runner] of heard.ran) {
              if (open.has(runner.lineId) || runners.get(agentId) !== runner) continue;
              report(
                "a local agent's runner was stopped, since the service no longer holds it here",
              );
              yield* FiberSet.run(stopping, ended(runner));
            }

            const unknown = [...open].filter((id) => !heard.knew.has(id));

            if (unknown.length === 0) return;
            // Note that these are settled holding `claiming`, so none is one whose claim is under way, and each is read again first.
            // Note too that a line whose claim's answer was lost keeps its token until it is asked again, so it is left for that claim to deliver.
            yield* claiming.withPermit(
              Effect.forEach(
                unknown,
                (id) =>
                  starting.has(id) || runningLaunches().has(id) || claimTokens.has(id)
                    ? Effect.void
                    : settle(id),
                { discard: true },
              ),
            );
          });

        /** Whether the device runs nothing and has nothing under way: no runner, no launch starting, no line it claimed waiting or being delivered, and no request being answered. */
        const idle = Effect.map(
          FiberSet.size(answering),
          (requests) =>
            runners.size === 0 && starting.size === 0 && undelivered === 0 && requests === 0,
        );

        /**
         * The switch to the release the host's update holds, once the device
         * is idle: its claims of lines and requests paused under `claiming`,
         * so no line's claim is under way, where it is idle still there and
         * no claim's answer was lost, since that claim may have been handed a
         * launch only this process could ask for again. A line claimed since
         * the first look keeps the claims going and the switch waits for a
         * later beat, as does a switch that did not go through; one that did
         * leaves them paused, since the daemon ends, and since a line it
         * claimed and a request it is answering are idle's to wait out, the
         * daemon's end cuts off neither.
         */
        const switchedWhileIdle = (update: LocalAgentsUpdate) =>
          Effect.gen(function* () {
            if (!(yield* idle)) return;

            const stopped = yield* claiming.withPermit(
              Effect.gen(function* () {
                if (claimTokens.size > 0 || !(yield* idle)) return false;
                paused = true;

                return true;
              }),
            );

            if (!stopped) return;

            if (!(yield* update.switched(beat))) paused = false;
          });

        /**
         * Every runner asked to end where it is warm, its turn over, so a
         * release that waits is not kept from the device by runners the
         * service would only retire past their window. A runner at work
         * skips the line, and is asked again at the next beat; one that ends
         * settles its launch as any exit does, and the service's next message
         * relaunches it on the new release. Asked under `claiming`, and only
         * where no line is claimed or waits to be delivered, so no message
         * this device took lands on a runner's stdin behind the line; one the
         * service writes as the runner ends is not fenced here, and the turn
         * it awaits is failed past its pickup deadline by the service's sweep.
         */
        const retiredWarm = claiming.withPermit(
          Effect.suspend(() =>
            claimTokens.size > 0 || undelivered > 0
              ? Effect.void
              : Effect.forEach(
                  [...runners.values()],
                  (runner) => Queue.offer(runner.stdin, RETIRE_LINE),
                  { discard: true },
                ),
          ),
        );

        /** A beat's answer converged to (`reconciledBeat`), its release handed to the host's update, and, while one waits, the warm runners retired and the switch made where the device is idle. */
        const followedBeat = (heard: HeardBeat | undefined) =>
          Effect.gen(function* () {
            yield* reconciledBeat(heard);
            const { update } = dependencies;

            if (update === undefined || heard === undefined) return;
            yield* update.heard(heard.beat.release);

            if (!(yield* update.waiting)) return;
            yield* retiredWarm;
            yield* switchedWhileIdle(update);
          });

        yield* Effect.forkScoped(linesFollowed);
        yield* Effect.forkScoped(requestsFollowed);
        // Note that each beat's outcome is handed to the reconcile through a queue keeping the latest alone, so a slow settle or claim never holds up the next beat, and a reconcile that falls behind converges to the newest answer.
        const latest = yield* Queue.sliding<HeardBeat | undefined>(1);
        const told = Effect.flatMap(timedBeat(heardBeat), (heard) => Queue.offer(latest, heard));
        const reconciling = Effect.forever(Effect.flatMap(Queue.take(latest), followedBeat));
        // Note that a reconcile that died ends the follow, so the turn reports it and starts again.
        yield* Effect.raceFirst(presence(told), Effect.provideContext(reconciling, services));
      });

    /** An open gate's turn, from its home folder: the device readied and registered, and its agents followed; false where its register was not taken. */
    const openTurn = (folder: string) =>
      Effect.gen(function* () {
        const { tools } = platform;

        const registered = (setup: DeviceSetupRegister) =>
          client.register(deviceId, {
            name: platform.deviceName,
            platform: platform.devicePlatform,
            arch: platform.deviceArch,
            ...platform.deviceMachine,
            home: folder,
            ...rootsOf(folder),
            claudeExecutable: tools.claude,
            codexExecutable: tools.codex,
            capabilities: platform.deviceCapabilities,
            ...setup,
          });

        // Note that the device registers as ready only once it has what its agents run on, so Start never takes one that cannot run an agent.
        if (!(yield* readyForOpening(registered))) return true;
        const shellVariables = yield* shellEnvironment;

        if (!(yield* asked(registered({})))) return false;
        // Note that the machine says it is ready only once the service took it as ready.
        yield* keptStatus(SETUP_STEP.READY);
        yield* Effect.scoped(follow(folder, shellVariables));

        return true;
      });

    /**
     * One turn of the loop: a wait for the gate to open; then the device
     * registered, and its agents followed until the gate shuts, when the follow's scope
     * closes and every runner it started is stopped with its group. It
     * answers whether it went as it should: false where the service did not
     * take its register. A device that names no home folder never opens.
     */
    const turn = Option.match(home, {
      onNone: () => Effect.never,
      onSome: (folder) => Effect.andThen(gateStands(true), openTurn(folder)),
    });

    const lifetime = Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(switchedOn, (on) => SubscriptionRef.set(gate, on)),
      );

      // A turn that died is reported and, as one whose register failed, tried again after `RETRY`; one that went as it should starts the backoff afresh.
      const guarded = Effect.catchDefect(Effect.provideContext(turn, services), () =>
        Effect.as(
          Effect.sync(() => report("the local agents' follow failed")),
          false,
        ),
      );

      yield* Effect.forkScoped(
        Effect.forever(Effect.repeat(guarded, { schedule: RETRY, until: (went) => went })),
      );
    });

    // Note that the follower answers nothing itself: the panel asks This Mac's vespin-host (`compose-this-mac-host.ts`).
    const methods: Composer["methods"] = {};

    return { methods, lifetime } satisfies Composer;
  });
}
