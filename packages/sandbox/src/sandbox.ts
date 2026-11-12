/**
 * sandbox.ts -- `Sandbox`, the one service every call of a sandbox goes through, whichever provider runs it, and what is built from its calls alone: a base drive filled in a sandbox of its own and deleted for good, a sandbox deleted only while it is the one read, and one resumed until it runs.
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
 * caller times any other way. Only agent or terminal activity touches a
 * sandbox (`SANDBOX_IDLE`); a terminal touches it only once it was used
 * since its last touch (`touchedWhileUsed`), never for standing open
 * alone. A stopped sandbox keeps its disk as a snapshot, so an idle one
 * bills nothing but that.
 *
 * A sandbox may open with a drive (`SandboxDrive`): a base drive it fills,
 * or a drive of its own forked from one. Every drive call is the package's,
 * made as a sandbox opens or is deleted, so a drive is never a caller's to
 * forget: a sandbox's delete deletes the drive it owns in the same call. A
 * base drive owns no sandbox, so it is deleted by its name alone, with the
 * fill's sandbox that holds it (`deletedFilledDrive`).
 */

import { Clock, Context, Duration, Effect, Option, Ref, Schedule, type Scope } from "effect";
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
  type SandboxUser,
  UP_STATUSES,
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
  /** Whether a drive of that name stands, without making one. */
  readonly driveStands: (name: string) => Effect.Effect<boolean, SandboxError>;
  /** The named sandbox, resumed from its snapshot first where it was stopped. */
  readonly resume: (name: string) => Effect.Effect<OpenedSandbox, SandboxError>;
  /**
   * Opens a persistent sandbox from the image or snapshot named, with the
   * drive it asks for, on the open internet; answers it with the run it is
   * up in. A name another sandbox holds is refused (`SandboxNameTaken`),
   * which is what makes a name a lock.
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
  /**
   * Deletes the named sandbox with the snapshots no other sandbox uses and
   * the drive it owns, where it forked one, stopping its run first where the
   * drive is still mounted in it; one already gone counts as deleted. A
   * drive left by a delete that failed is deleted by the next delete of the
   * name, whether the sandbox still stands or not.
   */
  readonly delete: (name: string) => Effect.Effect<void, SandboxError>;
  /**
   * Deletes the named drive and everything on it; one already gone counts as
   * deleted. One still mounted in a running sandbox is refused
   * (`SandboxUnavailable`), as the provider refuses it, so a caller lets go
   * of it first (`deletedFilledDrive`).
   */
  readonly deleteDrive: (name: string) => Effect.Effect<void, SandboxError>;
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
 * decides when an idle sandbox stops. Five minutes with no agent or
 * terminal activity, the one rule every sandbox follows, with no
 * exceptions: activity is an agent's turn running, a terminal typed in or
 * printing, or the agent open in a focused window of the app
 * (`use-warm-agent.ts`), and nothing else touches a sandbox. A run also
 * ends at the provider's longest, 24 hours from its start, however active
 * (`vercel/vercel-sdk.ts`'s `TOUCH`).
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

/** A touch the sandbox did not confirm, logged in its own words and let be. */
function loggedIfUnconfirmed<R>(
  touch: Effect.Effect<void, SandboxError, R>,
): Effect.Effect<void, never, R> {
  return Effect.catch(touch, (failure) =>
    Effect.logWarning(`a sandbox was not touched: ${failure.message}`),
  );
}

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
  loggedIfUnconfirmed(Effect.flatMap(Sandbox, (sandbox) => sandbox.touch(name)));

/**
 * A sandbox a connection holds touched only while the connection is used:
 * every `SANDBOX_TOUCH_EVERY`, from at once, where `lastUsedAt` (an epoch
 * millisecond the caller moves on every sign of use) is no older than the
 * last touch the sandbox confirmed, for the caller's scope. A touch it did
 * not confirm is logged and tried again at the next interval, since no
 * later use may come to ask it. A connection left open and unused so lets
 * its sandbox stop `SANDBOX_IDLE` after its last use, or at most one touch
 * interval later, as every sandbox does.
 */
export const touchedWhileUsed = (
  touch: Effect.Effect<void, SandboxError>,
  lastUsedAt: Effect.Effect<number>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const touchedAt = yield* Ref.make(Number.NEGATIVE_INFINITY);

    const touchIfUsed = Effect.gen(function* () {
      if ((yield* lastUsedAt) <= (yield* Ref.get(touchedAt))) return;
      const at = yield* Clock.currentTimeMillis;
      yield* touch;
      yield* Ref.set(touchedAt, at);
    });

    yield* Effect.forkScoped(
      Effect.repeat(loggedIfUnconfirmed(touchIfUsed), {
        schedule: Schedule.spaced(SANDBOX_TOUCH_EVERY),
      }),
    );
  });

/**
 * What a base drive is filled as: the fill's sandbox's name, which is its
 * lock, the drive's name and where it is mounted, the image the sandbox
 * opens from, and its size.
 */
export interface DriveFill {
  readonly name: string;
  readonly drive: string;
  readonly at: string;
  readonly image: string;
  readonly vcpus?: number;
  /** The user made in the fill's sandbox, so what the steps hand it is that user's on every fork. */
  readonly user?: SandboxUser;
}

/**
 * A base drive filled in a sandbox of its own: created from the image under
 * the name with the drive mounted to be filled (made empty where none
 * stands), the caller's steps run in it, touched every `SANDBOX_TOUCH_EVERY`
 * while they run, and then stopped and deleted, which leaves the drive, as
 * Vercel's own example fills one; whether it filled, false where another
 * fill holds the name, which this one leaves be. Note that the sandbox is
 * stopped before its delete, because the stop lets go of the drive at once,
 * where a delete of a running sandbox answers before it does, and a fork
 * read past a fill must find the drive whole. A fill whose steps failed
 * stops its sandbox and leaves it standing, so a reader of the name finds
 * the drive unfinished, whatever the steps left on it, until a later fill
 * replaces it; one whose caller went stops touching it, so it stops
 * `SANDBOX_IDLE` later and reads the same.
 */
export const filledDrive = <E, R>(
  ask: DriveFill,
  steps: (running: SandboxRunning) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;

    const created = yield* sandbox
      .create({
        name: ask.name,
        from: { image: ask.image },
        drive: { fill: ask.drive, at: ask.at },
        tags: {},
        ...(ask.vcpus === undefined ? undefined : { vcpus: ask.vcpus }),
        ...(ask.user === undefined ? undefined : { user: ask.user }),
        env: {},
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag("SandboxNameTaken", () => Effect.succeed(Option.none<OpenedSandbox>())),
      );

    if (Option.isNone(created)) return false;
    const running = { name: ask.name, running: created.value.running };
    yield* Effect.gen(function* () {
      yield* touchSandbox(ask.name).pipe(
        Effect.delay(SANDBOX_TOUCH_EVERY),
        Effect.forever,
        Effect.forkScoped,
      );
      yield* steps(running);
    }).pipe(
      Effect.scoped,
      Effect.tapError(() => Effect.ignore(sandbox.stop(running))),
    );
    yield* sandbox.stop(running);
    yield* sandbox.delete(ask.name);

    return true;
  }).pipe(Effect.withSpan("web/fillDrive"));

/**
 * A drive `filledDrive` filled deleted for good: the fill's sandbox under
 * its name stopped where it is up and deleted, then the drive. Note that the
 * sandbox is stopped first, as a fill ends, because a stop lets go of the
 * drive at once and the provider refuses to delete a drive a running
 * sandbox mounts; a fill still running is cut off, its steps failing on a
 * sandbox gone. A drive or a sandbox already gone counts as deleted.
 */
export const deletedFilledDrive = (fill: Pick<DriveFill, "name" | "drive">) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    const found = yield* sandbox.get(fill.name);

    if (found?.running !== undefined && UP_STATUSES.has(found.status)) {
      yield* sandbox.stop({ name: fill.name, running: found.running });
    }

    yield* sandbox.delete(fill.name);
    yield* sandbox.deleteDrive(fill.drive);
  }).pipe(Effect.withSpan("web/deleteFilledDrive"));

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
