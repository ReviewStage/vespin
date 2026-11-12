import { LINK_PAGE } from "@repo/features/link-home";
import { scheduleOnce } from "@repo/runtime/effect";
import {
  UPDATE_FAILURE,
  UPDATE_STATUS,
  type UpdateFailure,
  type UpdateProgress,
  type UpdateSnapshot,
  type UpdateStatus,
} from "@repo/settings/update";
import { type Context, Duration, Effect, type Fiber, Schedule, Scope } from "effect";

/**
 * The addresses updating ever touches, fixed here rather than passed in,
 * so the renderer names an intent and never an address — and nothing a check
 * read can steer where a press goes. The feed is where electron-updater reads
 * `latest-mac.yml` and the archive it names, both published by this
 * repository's release pipeline; `releases/latest` is what keeps the address
 * from ever moving. The changelog page is the site's rendering of the same
 * repository's CHANGELOG.md, where the Updates section's Changelog row goes.
 */
export const UPDATE_ENDPOINT = {
  // The trailing slash keeps the last segment a directory under every URL
  // resolver; electron-updater normalizes a slashless base itself, but the
  // literal should not need that reading.
  UPDATE_FEED_URL: "https://github.com/ReviewStage/vespin/releases/latest/download/",
  LATEST_RELEASE_PAGE_URL: "https://github.com/ReviewStage/vespin/releases/latest",
  CHANGELOG_PAGE_URL: LINK_PAGE.CHANGELOG,
} as const;

const UPDATE_CHECK_DEFAULTS = {
  /**
   * Four hours between timed checks, a common interval for the same feed
   * shape: a release lands at most every few days, and
   * an unauthenticated GitHub read is rate-limited by address.
   */
  INTERVAL_MS: 4 * 60 * 60 * 1000,
  /**
   * The first check after an install waits long enough for the "updated"
   * confirmation to be seen before `checking` overwrites it.
   */
  JUST_UPDATED_FIRST_CHECK_DELAY_MS: 10_000,
  /**
   * How long a restart press holds the install guard: long enough for the
   * quit's teardown and Squirrel's swap, after which a run still standing
   * was never going to quit, and the row's restart is offered again.
   */
  INSTALL_GRACE_MS: 2 * 60 * 1000,
} as const;

/**
 * Failures that are the network's, not the release's: transient, expected,
 * and resolved by the next timed check, so they must not be drawn as errors.
 */
const SILENT_NETWORK_ERROR_PATTERNS = [
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_CONNECTION_RESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
] as const;

function isNetworkErrorMessage(message: string): boolean {
  return SILENT_NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * What Squirrel.Mac says when the app runs from a read-only volume (its disk
 * image, or a copy macOS translocated): an install that can only succeed
 * once the app is moved, which the row names rather than reports.
 */
const READ_ONLY_VOLUME_ERROR_PATTERN = "read-only volume";

/** The failure an error's words name a remedy for, or none. */
function updateFailureOf(message: string): UpdateFailure | undefined {
  return message.includes(READ_ONLY_VOLUME_ERROR_PATTERN)
    ? UPDATE_FAILURE.READ_ONLY_VOLUME
    : undefined;
}

/**
 * Where the updater stands inside the service: the wire's `UpdateSnapshot`
 * with what only the service reads folded into the states it belongs to,
 * rather than kept as flags beside them. A run under way (`checking`,
 * `downloading`) knows whether the developer asked for it, so a network
 * failure anywhere in it is said rather than silent; a build in hand knows
 * whether its install was already asked for, so repeat presses never fan out
 * into parallel installs racing Squirrel's binary swap.
 */
type UpdateState =
  | Exclude<
      UpdateSnapshot,
      {
        status:
          | typeof UPDATE_STATUS.CHECKING
          | typeof UPDATE_STATUS.DOWNLOADING
          | typeof UPDATE_STATUS.READY;
      }
    >
  | (Extract<UpdateSnapshot, { status: typeof UPDATE_STATUS.CHECKING }> & { asked: boolean })
  | (Extract<UpdateSnapshot, { status: typeof UPDATE_STATUS.DOWNLOADING }> & { asked: boolean })
  | (Extract<UpdateSnapshot, { status: typeof UPDATE_STATUS.READY }> & { installing: boolean });

/** Everything that may move the updater: the row's presses, the launch, and the engine's events. */
const UPDATE_EVENT = {
  /** A check begins, pressed or timed. */
  CHECK: "check",
  /** A pressed check lands on a run already under way, which it joins. */
  JOIN: "join",
  /** The engine says it is checking. */
  CHECKING: "checking",
  AVAILABLE: "available",
  NOT_AVAILABLE: "not-available",
  PROGRESS: "progress",
  DOWNLOADED: "downloaded",
  FAILED: "failed",
  INSTALL: "install",
  /** The install's grace passed with the run still standing. */
  INSTALL_LAPSED: "install-lapsed",
  /** The first launch after an install confirms it. */
  UPDATED: "updated",
} as const;

type UpdateEventKind = (typeof UPDATE_EVENT)[keyof typeof UPDATE_EVENT];

type UpdateEvent =
  | { kind: typeof UPDATE_EVENT.CHECK; asked: boolean }
  | { kind: typeof UPDATE_EVENT.JOIN }
  | { kind: typeof UPDATE_EVENT.CHECKING }
  | { kind: typeof UPDATE_EVENT.AVAILABLE; version: string }
  | { kind: typeof UPDATE_EVENT.NOT_AVAILABLE }
  | { kind: typeof UPDATE_EVENT.PROGRESS; progress: UpdateProgress }
  | { kind: typeof UPDATE_EVENT.DOWNLOADED; version: string }
  | { kind: typeof UPDATE_EVENT.FAILED; message: string }
  | { kind: typeof UPDATE_EVENT.INSTALL }
  | { kind: typeof UPDATE_EVENT.INSTALL_LAPSED }
  | { kind: typeof UPDATE_EVENT.UPDATED; previousVersion: string };

/**
 * The moves each state takes; every other event is refused where it lands.
 * A download in flight or in hand refuses a check — here we are stricter than
 * the common updater setup: a timed tick that re-checked mid-flight would
 * stomp the progress or the restart offer with `checking`, and a feed failure
 * after a completed download would trade a build in hand for an error row and
 * a cleared cache. A run under way refuses a second check too, which a pressed
 * one joins instead, so a timed tick never makes a pressed run silent. The
 * engine's news of a build moves any state but a build in hand or one just
 * installed, which take no news of another.
 */
const UPDATE_MOVES = {
  [UPDATE_STATUS.IDLE]: [
    UPDATE_EVENT.CHECK,
    UPDATE_EVENT.CHECKING,
    UPDATE_EVENT.AVAILABLE,
    UPDATE_EVENT.DOWNLOADED,
    UPDATE_EVENT.UPDATED,
  ],
  [UPDATE_STATUS.CHECKING]: [
    UPDATE_EVENT.JOIN,
    UPDATE_EVENT.CHECKING,
    UPDATE_EVENT.AVAILABLE,
    UPDATE_EVENT.NOT_AVAILABLE,
    UPDATE_EVENT.DOWNLOADED,
    UPDATE_EVENT.FAILED,
  ],
  [UPDATE_STATUS.DOWNLOADING]: [
    UPDATE_EVENT.JOIN,
    UPDATE_EVENT.AVAILABLE,
    UPDATE_EVENT.PROGRESS,
    UPDATE_EVENT.DOWNLOADED,
    UPDATE_EVENT.FAILED,
  ],
  [UPDATE_STATUS.READY]: [UPDATE_EVENT.INSTALL, UPDATE_EVENT.INSTALL_LAPSED, UPDATE_EVENT.FAILED],
  [UPDATE_STATUS.UPDATED]: [UPDATE_EVENT.CHECK, UPDATE_EVENT.CHECKING],
  [UPDATE_STATUS.ERROR]: [
    UPDATE_EVENT.CHECK,
    UPDATE_EVENT.CHECKING,
    UPDATE_EVENT.AVAILABLE,
    UPDATE_EVENT.DOWNLOADED,
  ],
} as const satisfies Record<UpdateStatus, readonly UpdateEventKind[]>;

/** Moves that change only what the service reads, so nothing is broadcast. */
const QUIET_EVENTS: ReadonlySet<UpdateEventKind> = new Set([
  UPDATE_EVENT.JOIN,
  UPDATE_EVENT.INSTALL,
  UPDATE_EVENT.INSTALL_LAPSED,
]);

/** What every state carries, read off the state it moves from. */
function standingOf(state: UpdateState) {
  return { currentVersion: state.currentVersion, installSupported: state.installSupported };
}

/** Whether the run `state` stands in was asked for; only a run under way can have been. */
function askedOf(state: UpdateState): boolean {
  return (
    (state.status === UPDATE_STATUS.CHECKING || state.status === UPDATE_STATUS.DOWNLOADING) &&
    state.asked
  );
}

/**
 * Where `event` moves `state`, or `undefined` where the table refuses it.
 * A failure is the network's when its words say so, which is silence unless
 * the run was asked for; anything else is `error`, keeping the release the
 * run named, if any.
 */
function transition(state: UpdateState, event: UpdateEvent): UpdateState | undefined {
  const moves: readonly UpdateEventKind[] = UPDATE_MOVES[state.status];

  if (!moves.includes(event.kind)) return undefined;
  const standing = standingOf(state);

  switch (event.kind) {
    case UPDATE_EVENT.CHECK:
      return { status: UPDATE_STATUS.CHECKING, ...standing, asked: event.asked };
    case UPDATE_EVENT.JOIN:
      return (state.status === UPDATE_STATUS.CHECKING ||
        state.status === UPDATE_STATUS.DOWNLOADING) &&
        !state.asked
        ? { ...state, asked: true }
        : undefined;
    case UPDATE_EVENT.CHECKING:
      return { status: UPDATE_STATUS.CHECKING, ...standing, asked: askedOf(state) };
    case UPDATE_EVENT.AVAILABLE:
      return {
        status: UPDATE_STATUS.DOWNLOADING,
        ...standing,
        asked: askedOf(state),
        latestVersion: event.version,
      };
    case UPDATE_EVENT.NOT_AVAILABLE:
      return { status: UPDATE_STATUS.IDLE, ...standing, upToDate: true };
    case UPDATE_EVENT.PROGRESS:
      return state.status === UPDATE_STATUS.DOWNLOADING
        ? { ...state, progress: event.progress }
        : undefined;
    case UPDATE_EVENT.DOWNLOADED:
      return {
        status: UPDATE_STATUS.READY,
        ...standing,
        latestVersion: event.version,
        installing: false,
      };
    case UPDATE_EVENT.FAILED: {
      if (isNetworkErrorMessage(event.message)) {
        const idle = { status: UPDATE_STATUS.IDLE, ...standing, upToDate: false };

        return askedOf(state) ? { ...idle, unreachable: true } : idle;
      }

      const latestVersion = "latestVersion" in state ? state.latestVersion : undefined;
      const failure = updateFailureOf(event.message);

      return {
        status: UPDATE_STATUS.ERROR,
        ...standing,
        ...(latestVersion === undefined ? undefined : { latestVersion }),
        ...(failure === undefined ? undefined : { failure }),
      };
    }

    case UPDATE_EVENT.INSTALL:
      return state.status === UPDATE_STATUS.READY && !state.installing
        ? { ...state, installing: true }
        : undefined;
    case UPDATE_EVENT.INSTALL_LAPSED:
      return state.status === UPDATE_STATUS.READY && state.installing
        ? { ...state, installing: false }
        : undefined;
    case UPDATE_EVENT.UPDATED:
      return { status: UPDATE_STATUS.UPDATED, ...standing, previousVersion: event.previousVersion };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled update event: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The state as the wire carries it, without what only the service reads. */
function snapshotOf(state: UpdateState): UpdateSnapshot {
  switch (state.status) {
    case UPDATE_STATUS.CHECKING:
    case UPDATE_STATUS.DOWNLOADING: {
      const { asked: _asked, ...snapshot } = state;

      return snapshot;
    }

    case UPDATE_STATUS.READY: {
      const { installing: _installing, ...snapshot } = state;

      return snapshot;
    }

    default:
      return state;
  }
}

/**
 * Where the service stands in its own life: `start()` takes it from
 * `unstarted` once, and `stop()` ends it for good, so a start after a stop
 * forks nothing.
 */
const SERVICE_LIFE = {
  UNSTARTED: "unstarted",
  STARTED: "started",
  STOPPED: "stopped",
} as const;

type ServiceLife = (typeof SERVICE_LIFE)[keyof typeof SERVICE_LIFE];

/** The updater lifecycle, as electron-updater announces it. */
export interface UpdaterEngineEvents {
  onChecking: () => void;
  /** A newer build exists; with auto-download its fetch has already begun. */
  onAvailable: (version: string) => void;
  onNotAvailable: () => void;
  onProgress: (progress: UpdateProgress) => void;
  onDownloaded: (version: string) => void;
  onError: (message: string) => void;
}

/**
 * The one thing that can replace the running build: a wrapper over
 * electron-updater, injected so the service's state can be exercised without
 * it. Absent wherever installing in place is impossible — an unpackaged run,
 * a run that sends no network — which the service reports as
 * `installSupported: false` so the row offers the browser instead.
 */
export interface UpdaterEngine {
  wire(events: UpdaterEngineEvents): void;
  /** Resolves when the check has answered; a found download runs on behind it. */
  checkForUpdates(): Promise<void>;
  quitAndInstall(): void;
  /**
   * Drops electron-updater's cached download. Its cache only self-invalidates
   * when the remote sha512 differs, so a corrupt cached download would be
   * retried forever if an error left it standing.
   */
  clearCachedUpdate(): Promise<void>;
}

/**
 * Where the updater stands before it has learned anything: what the row
 * draws at launch, and what the app state document begins with, from the one
 * definition rather than two that have to agree.
 */
export function idleUpdateSnapshot(
  currentVersion: string,
  installSupported: boolean,
): Extract<UpdateSnapshot, { status: typeof UPDATE_STATUS.IDLE }> {
  return { status: UPDATE_STATUS.IDLE, currentVersion, installSupported, upToDate: false };
}

/** Where the last-run version is kept between launches, for the `updated` confirmation. */
interface LastRunVersionStore {
  read(): string | undefined;
  write(version: string): void;
}

interface UpdateServiceOptions {
  /** The running build's version, as the packaged app reports it. */
  currentVersion: string;
  /** Every state the service moves through, for the broadcast to carry. */
  onChange: (update: UpdateSnapshot) => void;
  engine?: UpdaterEngine | undefined;
  lastRunVersion?: LastRunVersionStore;
  intervalMs?: number;
  justUpdatedFirstCheckDelayMs?: number;
  installGraceMs?: number;
  report: (line: string) => void;
}

/**
 * The app's face on electron-updater, shaped after a common production updater
 * setup. A check reads the release manifest from the feed fixed by the
 * build; a newer build downloads at once and installs at the quit the user
 * asks for — the row's restart press, or whenever they next quit. Failures
 * are answers for the row, never throws: a network failure is silence (the
 * next timed check retries), anything else is `error`, drawn as the way back
 * to the releases page. An install may only be asked for once — repeat
 * presses racing Squirrel's binary swap is a known failure in
 * production — and a failed install falls out of `ready`, so the guard
 * releases with it, as it does once the install's grace passes with the run
 * still standing. Every move goes through `transition`, which refuses what
 * `UPDATE_MOVES` does not list.
 */
export class UpdateService {
  /**
   * The service as the effect that builds it, since nothing here may run
   * under services of its own: the launch's own scope is what the timed
   * check and the first check fork into, and the
   * launch's own services are what a synchronous caller's
   * `start`/`check`/`install` steps or forks its effects under, read once out
   * of the fiber building this rather than defaulted, so a bridge can never
   * run under the empty context plain `Effect.runSync` stands for in place of
   * the one the launch actually holds.
   */
  static make(options: UpdateServiceOptions): Effect.Effect<UpdateService, never, Scope.Scope> {
    return Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const services = yield* Effect.context<never>();

      return new UpdateService(options, scope, services);
    });
  }

  readonly #currentVersion: string;
  readonly #onChange: (update: UpdateSnapshot) => void;
  readonly #engine: UpdaterEngine | undefined;
  readonly #lastRunVersion: LastRunVersionStore | undefined;
  readonly #intervalMs: number;
  readonly #justUpdatedFirstCheckDelayMs: number;
  readonly #installGraceMs: number;
  readonly #report: (line: string) => void;
  readonly #services: Context.Context<never>;
  /** Every fiber the service forks — the timed check and the first check — lands here. */
  readonly #scope: Scope.Scope;
  #state: UpdateState;
  #snapshot: UpdateSnapshot;
  #life: ServiceLife = SERVICE_LIFE.UNSTARTED;
  /**
   * The timed check and the first check `start()` forks, tracked so `stop()`
   * can interrupt them directly when the scope they forked into is not this
   * class's own to close.
   */
  #repeatingCheck: Fiber.Fiber<unknown> | undefined;
  #firstCheck: Fiber.Fiber<unknown> | undefined;
  /**
   * The grace of the install last asked for, replaced by the next one, so an
   * earlier attempt's grace never frees a later attempt's guard.
   */
  #installLapse: Fiber.Fiber<unknown> | undefined;

  private constructor(
    options: UpdateServiceOptions,
    scope: Scope.Scope,
    services: Context.Context<never>,
  ) {
    this.#currentVersion = options.currentVersion;
    this.#onChange = options.onChange;
    this.#engine = options.engine;
    this.#lastRunVersion = options.lastRunVersion;
    this.#services = services;
    this.#scope = scope;
    this.#intervalMs = options.intervalMs ?? UPDATE_CHECK_DEFAULTS.INTERVAL_MS;
    this.#justUpdatedFirstCheckDelayMs =
      options.justUpdatedFirstCheckDelayMs ??
      UPDATE_CHECK_DEFAULTS.JUST_UPDATED_FIRST_CHECK_DELAY_MS;
    this.#installGraceMs = options.installGraceMs ?? UPDATE_CHECK_DEFAULTS.INSTALL_GRACE_MS;
    this.#report = options.report;
    this.#state = idleUpdateSnapshot(this.#currentVersion, this.#engine !== undefined);
    this.#snapshot = this.#state;
    this.#engine?.wire({
      onChecking: () => this.#send({ kind: UPDATE_EVENT.CHECKING }),
      onAvailable: (version) => this.#send({ kind: UPDATE_EVENT.AVAILABLE, version }),
      onNotAvailable: () => this.#send({ kind: UPDATE_EVENT.NOT_AVAILABLE }),
      onProgress: (progress) => this.#send({ kind: UPDATE_EVENT.PROGRESS, progress }),
      onDownloaded: (version) => this.#send({ kind: UPDATE_EVENT.DOWNLOADED, version }),
      onError: (message) => this.#fail(message),
    });
  }

  snapshot(): UpdateSnapshot {
    return this.#snapshot;
  }

  /**
   * Asks the manifest for the latest build once, resolving with the state the
   * answer moved to — `downloading` when a newer build was found, because the
   * fetch begins inside the check. Without an engine there is nothing to ask
   * and the standing snapshot is the whole answer. `asked` marks a check the
   * developer pressed for, whose network failure is said rather than silent.
   */
  async check({ asked = false }: { asked?: boolean } = {}): Promise<UpdateSnapshot> {
    const engine = this.#engine;

    if (!engine) return this.#snapshot;

    // Note that a pressed check landing on a run under way joins it rather
    // than asking the feed again, so that run's network failure is said.
    if (asked && this.#send({ kind: UPDATE_EVENT.JOIN })) return this.#snapshot;

    if (!this.#send({ kind: UPDATE_EVENT.CHECK, asked })) return this.#snapshot;

    try {
      await engine.checkForUpdates();
    } catch (error) {
      this.#fail(error instanceof Error ? error.message : String(error));
    }

    return this.#snapshot;
  }

  /**
   * Restarts into the downloaded build. Only `ready` has one, and only one
   * ask ever reaches the engine: repeat presses while Squirrel stages the
   * swap fan out into parallel installs racing to replace the binary, which
   * can leave the app on the old version.
   */
  install(): void {
    const engine = this.#engine;

    if (!engine || !this.#send({ kind: UPDATE_EVENT.INSTALL })) return;
    engine.quitAndInstall();

    // A quit that never comes (Squirrel doing nothing, or the teardown holding
    // it) must not hold the guard for the rest of the run.
    const lapse = Effect.sync(() => {
      if (!this.#send({ kind: UPDATE_EVENT.INSTALL_LAPSED })) return;
      this.#report("Update install did not restart the app; the restart is offered again");
    });

    this.#installLapse?.interruptUnsafe();
    this.#installLapse = Effect.runSyncWith(this.#services)(
      Effect.provideService(scheduleOnce(this.#installGraceMs, lapse), Scope.Scope, this.#scope),
    );
  }

  /**
   * Starts the timed check. The first check runs at once — except on the
   * first launch after an install, where it waits long enough for the
   * `updated` confirmation to be seen before `checking` overwrites it. Both
   * are fibers forked into the service's own scope, which `stop()` closes.
   */
  start(): void {
    if (this.#life !== SERVICE_LIFE.UNSTARTED || !this.#engine) return;
    this.#life = SERVICE_LIFE.STARTED;
    const previous = this.#lastRunVersion?.read();
    const justUpdated = previous !== undefined && previous !== this.#currentVersion;

    if (previous !== this.#currentVersion) this.#lastRunVersion?.write(this.#currentVersion);

    if (justUpdated && this.#send({ kind: UPDATE_EVENT.UPDATED, previousVersion: previous })) {
      this.#report(`Updated: ${previous} -> ${this.#currentVersion}`);
    }

    const runSync = Effect.runSyncWith(this.#services);
    const work = Effect.sync(() => void this.check());
    // The interval never fires at the fork itself: the whole repeat is
    // pushed back by one interval, so the cadence lands at `intervalMs`,
    // `2 * intervalMs`, ... exactly as the timer it replaces did, leaving the
    // very first check to the one below.
    this.#repeatingCheck = runSync(
      Effect.provideService(
        Effect.forkScoped(
          Effect.delay(
            Effect.repeat(work, Schedule.spaced(Duration.millis(this.#intervalMs))),
            Duration.millis(this.#intervalMs),
          ),
        ),
        Scope.Scope,
        this.#scope,
      ),
    );
    this.#firstCheck = runSync(
      Effect.provideService(
        scheduleOnce(justUpdated ? this.#justUpdatedFirstCheckDelayMs : 0, work),
        Scope.Scope,
        this.#scope,
      ),
    );
  }

  /**
   * Gives back every fiber `start()` forked: the timed check and the first
   * check, each interrupted directly rather
   * than by closing the scope they forked into, since that scope is the
   * launch's own and not this class's to close.
   */
  stop(): void {
    if (this.#life === SERVICE_LIFE.STOPPED) return;
    this.#life = SERVICE_LIFE.STOPPED;
    this.#repeatingCheck?.interruptUnsafe();
    this.#firstCheck?.interruptUnsafe();
  }

  /**
   * Says why a run failed and moves it where the table says, once: the
   * engine's error event and the check's own rejection often carry the same
   * failure, and the second lands on a state that refuses it.
   */
  #fail(message: string): void {
    const failed = this.#send({ kind: UPDATE_EVENT.FAILED, message });

    if (!failed) return;

    if (this.#state.status !== UPDATE_STATUS.ERROR) {
      this.#report(`Update check could not reach the feed: ${message}`);

      return;
    }

    this.#report(`Update failed: ${message}`);
    void this.#engine?.clearCachedUpdate().catch(() => undefined);
  }

  /** Moves the state where `event` takes it, answering whether the table allowed the move. */
  #send(event: UpdateEvent): boolean {
    const next = transition(this.#state, event);

    if (next === undefined) return false;
    this.#state = next;

    if (QUIET_EVENTS.has(event.kind)) return true;
    this.#snapshot = snapshotOf(next);

    try {
      this.#onChange(this.#snapshot);
    } catch {
      // A listener's failure is its own — a window torn down mid-broadcast
      // must not fail the transition that has already moved.
    }

    return true;
  }
}
