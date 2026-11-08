/**
 * sandbox.ts -- `Sandbox`, the one service every call of a sandbox goes through, whichever provider runs it, and what is built from its calls alone: a snapshot built in a sandbox of its own, a sandbox deleted only while it is the one read, and one resumed until it runs.
 *
 * A sandbox is persistent and named: it runs, stops with its disk kept as a
 * snapshot, and resumes from it, each time in a run of its own. A call on
 * what runs in it (a command, a file, its PTY, its firewall) names its
 * target (`SandboxTarget`): the sandbox's name, for whatever run it is up in
 * now, or one run of it, where the call must reach that run alone. No call
 * resumes a sandbox but `resume`, `getOrCreate`, and what is built on them
 * here. The production layer is the provider's (`vercel/`, which the app's
 * edge provides); a test's is `@repo/sandbox/testing`'s.
 *
 * A run stops `SANDBOX_IDLE` after its last touch: every open and create
 * runs for that long, and whatever holds a sandbox in use touches it
 * (`touch`, `touchSandbox`) about every `SANDBOX_TOUCH_EVERY`, which no
 * caller times any other way. A stopped sandbox keeps its disk as a
 * snapshot, so an idle one bills nothing but that.
 */

import { Context, Duration, Effect, Option, Schedule, type Scope } from "effect";
import type { WebSocket } from "ws";
import {
  type CommandAsk,
  type CommandExit,
  type CommandRun,
  type DetachedCommandAsk,
  type InteractiveShell,
  type ListedSandbox,
  type NetworkPolicy,
  type OpenedSandbox,
  SANDBOX_STATUS,
  type SandboxCreate,
  type SandboxError,
  type SandboxFile,
  type SandboxGetOrCreate,
  type SandboxRoute,
  type SandboxRunning,
  type SandboxTarget,
} from "./vocabulary.js";

export interface SandboxService {
  /**
   * Every sandbox carrying the tag with the value given, the newest first.
   * Note that the order is made here rather than left to every reader's
   * first pick, because an expired sandbox whose delete was not confirmed
   * stands beside the replacement that took its place under the same tag,
   * and the replacement is the one its readers must find first.
   */
  readonly listTagged: (
    tag: string,
    value: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxError>;
  /** The sandbox of that name, as it stands, without resuming it; none where there is no such sandbox. */
  readonly get: (name: string) => Effect.Effect<ListedSandbox | undefined, SandboxError>;
  /** The named sandbox, resumed from its snapshot first where it was stopped. */
  readonly resume: (name: string) => Effect.Effect<OpenedSandbox, SandboxError>;
  /**
   * Opens a persistent sandbox from the image or snapshot named, on the open
   * internet; answers it with the run it is up in. A name another sandbox
   * holds is refused (`SandboxNameTaken`), which is what makes a name a lock.
   */
  readonly create: (ask: SandboxCreate) => Effect.Effect<OpenedSandbox, SandboxError>;
  /**
   * The sandbox under the name: the one standing, resumed where it was
   * stopped; else one created as `create` opens it; and where the one
   * standing can never resume, its snapshot gone, that one deleted and
   * another created under the same name. A sandbox it created has the user
   * the ask names, where it names one, made in it, and is then handed to the
   * caller's `onCreate` where it gives one, before the call answers; a
   * failure of either fails the call.
   */
  readonly getOrCreate: (
    ask: SandboxGetOrCreate,
    onCreate?: (created: OpenedSandbox) => Promise<void>,
  ) => Effect.Effect<OpenedSandbox, SandboxError>;
  /** Deletes the named sandbox with the snapshots no other sandbox uses; one already gone counts as deleted. */
  readonly delete: (name: string) => Effect.Effect<void, SandboxError>;
  /** Stops the target's run, keeping its disk as a snapshot for a resume; one already gone counts as stopped. */
  readonly stop: (target: SandboxTarget) => Effect.Effect<void, SandboxError>;
  /** Replaces the named sandbox's tags whole, without resuming it. */
  readonly updateTags: (
    name: string,
    tags: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, SandboxError>;
  /**
   * Serves exactly the ports given on public routes, closing every other,
   * without resuming the named sandbox or changing its tags; answers the
   * routes it serves after.
   */
  readonly updatePorts: (
    name: string,
    ports: readonly number[],
  ) => Effect.Effect<readonly SandboxRoute[], SandboxError>;
  /** Runs a command on the target and waits for its end. */
  readonly run: (target: SandboxTarget, ask: CommandAsk) => Effect.Effect<CommandRun, SandboxError>;
  /** Starts a detached command on the target with its stdin held open; answers the command's id. */
  readonly start: (
    target: SandboxTarget,
    ask: DetachedCommandAsk,
  ) => Effect.Effect<string, SandboxError>;
  /** Appends the text to a detached command's stdin, after whatever it already took. */
  readonly writeStdin: (
    target: SandboxTarget,
    commandId: string,
    text: string,
  ) => Effect.Effect<void, SandboxError>;
  /**
   * A command's exit code, null while it runs, or gone where the provider
   * no longer knows the command or its run. The read waits for the exit for
   * at most `within` (two seconds unless the caller names longer), so a
   * caller that waits on a command's end names how long rather than reading
   * it again.
   */
  readonly commandExit: (
    target: SandboxTarget,
    commandId: string,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxError>;
  /**
   * What a command that exited printed on stderr, the tail kept, every value
   * named in `secrets` and every token-shaped run redacted, for a log; none
   * where it printed nothing there, and unavailable where the provider
   * refused or did not answer in time.
   */
  readonly commandStderrTail: (
    target: SandboxTarget,
    commandId: string,
    secrets?: readonly string[],
  ) => Effect.Effect<string | undefined, SandboxError>;
  /** Ends a command with SIGTERM; one already gone counts as ended. */
  readonly kill: (target: SandboxTarget, commandId: string) => Effect.Effect<void, SandboxError>;
  /** Writes the files into the target, as the sandbox's default user. */
  readonly writeFiles: (
    target: SandboxTarget,
    files: readonly SandboxFile[],
  ) => Effect.Effect<void, SandboxError>;
  /** Mints a connection to the target's PTY; a sandbox not up is unavailable, and nothing is resumed. */
  readonly openInteractive: (
    target: SandboxTarget,
  ) => Effect.Effect<InteractiveShell, SandboxError>;
  /** The PTY's socket opened under its minted token, once it answers healthy, for the scope it is opened in; closing the scope closes it. */
  readonly connectPty: (
    shell: InteractiveShell,
  ) => Effect.Effect<WebSocket, SandboxError, Scope.Scope>;
  /** Sets the target's network policy whole, so its writer composes it from what stands. */
  readonly updateNetworkPolicy: (
    target: SandboxTarget,
    policy: NetworkPolicy,
  ) => Effect.Effect<void, SandboxError>;
  /**
   * Snapshots the target, which stops it, answering the snapshot's id. The
   * snapshot lapses `expiresAfter` its last use, or never where that is
   * infinite. A run that is no longer up is refused, so of two snapshots
   * asked at once only the first is taken.
   */
  readonly snapshot: (
    target: SandboxTarget,
    expiresAfter: Duration.Duration,
  ) => Effect.Effect<string, SandboxError>;
  /**
   * The named sandbox in use now: its running run lengthened so it ends
   * `SANDBOX_IDLE` from now, where that moves its end out by more than a
   * little and within the provider's longest run; nothing where it is not
   * running, and nothing resumed.
   */
  readonly touch: (name: string) => Effect.Effect<void, SandboxError>;
}

export class Sandbox extends Context.Service<Sandbox, SandboxService>()("@repo/sandbox/Sandbox") {}

/**
 * How long a sandbox runs past its last touch: what every open and create
 * runs for, and how far ahead of now each touch puts its end, so this alone
 * decides when an idle sandbox stops. Five minutes, because an idle sandbox
 * bills its memory until it stops, and a resume from its snapshot is quick.
 */
export const SANDBOX_IDLE = Duration.minutes(5);

/**
 * How often whatever holds a sandbox in use touches it: a minute, well
 * inside `SANDBOX_IDLE`, so a touch that failed is followed by another long
 * before the sandbox would stop, and none of them is tried again.
 */
export const SANDBOX_TOUCH_EVERY = Duration.minutes(1);

/** How a resumed sandbox is waited on until it runs (`resumedRunning`). */
const RESUME_WAIT = { POLL: Duration.seconds(1) } as const;

/** Whether two reads of a name are of one sandbox: the same creation and the same run. */
function sameSandbox(one: ListedSandbox, other: ListedSandbox): boolean {
  return one.createdAt === other.createdAt && one.running === other.running;
}

/**
 * The sandbox under the name deleted, where it is still the one given: read
 * again just before, so one created under the name since is left be.
 * Whether the name now stands free.
 */
export const deletedIfStill = (read: ListedSandbox) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    const now = yield* sandbox.get(read.name);
    if (now === undefined) return true;
    if (!sameSandbox(now, read)) return false;
    yield* sandbox.delete(read.name);
    return true;
  });

/**
 * The named sandbox touched (`touch`), as a caller that holds it in use asks
 * it: a touch the sandbox did not confirm is logged in its own words and let
 * be, since the next one comes well before the sandbox would stop.
 */
export const touchSandbox = (name: string): Effect.Effect<void, never, Sandbox> =>
  Effect.flatMap(Sandbox, (sandbox) => sandbox.touch(name)).pipe(
    Effect.catch((failure) => Effect.logWarning(`a sandbox was not touched: ${failure.message}`)),
  );

/** What a snapshot is built as: the sandbox's name, the image it starts from, its size, and how long the snapshot lasts after its last use. */
export interface SnapshotBuild {
  readonly name: string;
  readonly image: string;
  readonly vcpus?: number;
  readonly lapse: Duration.Duration;
}

/**
 * A snapshot built in a sandbox of its own: created from the image under the
 * name, the caller's steps run in it, touched every `SANDBOX_TOUCH_EVERY`
 * while they run, and snapshotted, which stops it; the snapshot's id, or none
 * where another build holds the name, which this one leaves be. The sandbox
 * stays stopped holding the snapshot, which is where a reader finds it, since
 * deleting it deletes the snapshot with it. A build that failed deletes its
 * sandbox, where it is still this build's; one whose caller went stops
 * touching it, so it stops `SANDBOX_IDLE` later.
 */
export const buildSnapshot = <E, R>(
  ask: SnapshotBuild,
  steps: (running: SandboxRunning) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    const created = yield* sandbox
      .create({
        name: ask.name,
        from: { image: ask.image },
        tags: {},
        ...(ask.vcpus === undefined ? undefined : { vcpus: ask.vcpus }),
        snapshotLapse: ask.lapse,
        env: {},
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag("SandboxNameTaken", () => Effect.succeed(Option.none<OpenedSandbox>())),
      );
    if (Option.isNone(created)) return Option.none<string>();
    const running = { name: ask.name, running: created.value.running };
    return yield* Effect.gen(function* () {
      yield* touchSandbox(ask.name).pipe(
        Effect.delay(SANDBOX_TOUCH_EVERY),
        Effect.forever,
        Effect.forkScoped,
      );
      yield* steps(running);
      return Option.some(yield* sandbox.snapshot(running, ask.lapse));
    }).pipe(
      Effect.scoped,
      // Only this build's own sandbox goes, so a build that failed after another replaced it leaves that one be.
      Effect.tapError(() => Effect.ignore(deletedIfStill(created.value))),
    );
  }).pipe(Effect.withSpan("web/buildSnapshot"));

/**
 * The named sandbox resumed and waited on until it runs: the run it is up
 * in. Note that a resume may answer before the sandbox's own record says it
 * runs, so the record is read again until it does; the caller bounds the
 * wait.
 */
export const resumedRunning = (name: string) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    const resumed = yield* sandbox.resume(name);
    const running = yield* sandbox.get(name).pipe(
      Effect.map((found) => (found?.status === SANDBOX_STATUS.RUNNING ? found.running : undefined)),
      Effect.repeat({
        schedule: Schedule.spaced(RESUME_WAIT.POLL),
        until: (found) => found !== undefined,
      }),
    );
    return { name: resumed.name, running: running ?? resumed.running } satisfies SandboxRunning;
  });
