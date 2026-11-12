/**
 * memory-sandbox.ts -- `Sandbox` kept in memory, for a suite to provide on its tag: the second implementation of the package's interface, its state open to the suite's assertions, and the hooks a suite answers its commands and its failures through.
 *
 * It keeps what a provider would: sandboxes by name, each up in a run of its
 * own or stopped, holding a snapshot only where it is persistent, as one
 * created before sandboxes were made otherwise, or took one; the drives they opened with, the
 * commands each run started, the files written, the policies set, and the
 * snapshots taken. A call fenced to
 * a run the sandbox is no longer up in answers as gone, as the interface
 * says; nothing resumes but `resume` and `getOrCreate`. A suite scripts what
 * a command answers (`hooks.run`, `hooks.start`) and which call fails
 * (`hooks.fail`), and moves a command's exit itself (`exited`).
 */

import { Clock, Duration, Effect, Layer, Predicate, Redacted, Result } from "effect";
import { SANDBOX_IDLE, Sandbox, type SandboxService } from "../sandbox.js";
import {
  COMMAND_GONE,
  type CommandAsk,
  type CommandExit,
  type CommandRun,
  type DetachedCommandAsk,
  type ListedSandbox,
  type NetworkPolicy,
  type OpenedSandbox,
  SANDBOX_CALL,
  SANDBOX_STATUS,
  type SandboxCall,
  type SandboxCreate,
  type SandboxDrive,
  type SandboxError,
  type SandboxFile,
  SandboxGone,
  SandboxNameTaken,
  type SandboxRoute,
  type SandboxSource,
  type SandboxStatus,
  type SandboxTarget,
  SandboxUnavailable,
  type SandboxUser,
  SnapshotGone,
} from "../vocabulary.js";

/** One sandbox as the memory keeps it. */
export interface MemorySandboxRecord {
  readonly name: string;
  status: SandboxStatus;
  running: string;
  tags: Readonly<Record<string, string>>;
  snapshotId: string | undefined;
  /** Whether a stop keeps its disk for a resume: true only for one a suite stood as created persistent before. */
  readonly persistent: boolean;
  readonly createdAt: number;
  readonly from: SandboxSource;
  /** The drive it opened with and where it is mounted: a base drive it fills, or its own. */
  readonly drive: { readonly name: string; readonly at: string } | undefined;
  readonly vcpus: number | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly user: SandboxUser | undefined;
  expiresAt: number | undefined;
  routes: readonly SandboxRoute[];
}

/** A drive as the memory keeps it: its name, and the drive it was forked from, where it was forked. */
export interface MemoryDrive {
  readonly name: string;
  readonly forkedFrom: string | undefined;
}

/** A command a run started or ran, as the memory keeps it. */
export interface MemoryCommand {
  readonly id: string;
  readonly name: string;
  readonly running: string;
  readonly ask: CommandAsk | DetachedCommandAsk;
  readonly detached: boolean;
  /** What its stdin took, in order. */
  stdin: string;
  /** Its exit code, null while it runs. */
  exit: number | null;
  stderr: string;
}

/** A snapshot the memory took: the sandbox and run it was taken of, and how long it lasts after its last use. */
export interface MemorySnapshot {
  readonly id: string;
  readonly name: string;
  readonly running: string;
  readonly lapseMs: number;
}

/** What a suite answers a command or a failure through. */
export interface MemorySandboxHooks {
  /** What a command run to its end answers; a success with nothing printed where unsaid. */
  readonly run?: (
    command: MemoryCommand,
    sandbox: MemorySandboxRecord,
  ) => CommandRun | undefined | Effect.Effect<CommandRun>;
  /** Called on a detached command's start, before its id is answered. */
  readonly start?: (command: MemoryCommand, sandbox: MemorySandboxRecord) => void;
  /** The failure a call answers in place of its work, where it answers one; the name is the sandbox's. */
  readonly fail?: (
    call: SandboxCall,
    name: string,
  ) => SandboxError | undefined | Effect.Effect<never, SandboxError>;
}

/** The memory's state, open to a suite's assertions. */
export interface MemorySandboxState {
  readonly sandboxes: Map<string, MemorySandboxRecord>;
  readonly commands: MemoryCommand[];
  readonly files: { readonly name: string; readonly running: string; readonly file: SandboxFile }[];
  readonly policies: {
    readonly name: string;
    readonly running: string;
    readonly policy: NetworkPolicy;
  }[];
  readonly snapshots: MemorySnapshot[];
  /** Every drive standing, by name: a suite puts a base drive here to find it standing. */
  readonly drives: Map<string, MemoryDrive>;
  /** Every drive deleted, by name, in order. */
  readonly deletedDrives: string[];
  /** The snapshots gone, which a resume or a create from one answers as gone. */
  readonly goneSnapshots: Set<string>;
  /** Every run a stop ended, in order. */
  readonly stopped: { readonly name: string; readonly running: string }[];
  /** Every sandbox deleted, by name, in order. */
  readonly deleted: string[];
  /** Every run a resume opened, in order. */
  readonly resumed: { readonly name: string; readonly running: string }[];
  /** Every run a PTY was minted for, in order. */
  readonly interactive: { readonly name: string; readonly running: string }[];
  /** Every running run a touch reached, in order. */
  readonly touched: { readonly name: string; readonly running: string }[];
}

/** A memory `Sandbox`: its layer, its state, and how a suite moves a command's exit. */
export interface MemorySandbox {
  readonly layer: Layer.Layer<Sandbox>;
  readonly state: MemorySandboxState;
  readonly service: SandboxService;
  /** A sandbox put in place as a create would open it, persistent unless the suite says otherwise, for a suite that starts from one standing. */
  readonly stand: (
    sandbox: Partial<MemorySandboxRecord> & { readonly name: string },
  ) => MemorySandboxRecord;
  /** Ends the command with the code given. */
  readonly exited: (commandId: string, code: number) => void;
}

/** A run's id or a snapshot's, minted in order. */
function counter(prefix: string): () => string {
  let next = 0;

  return () => {
    next += 1;

    return `${prefix}${next}`;
  };
}

/** What a sandbox's own drive is named in memory: after the sandbox, as a provider names it. */
function ownDriveName(sandboxName: string): string {
  return `${sandboxName}-drive`;
}

/** The record as a lookup names it. */
function listedOf(record: MemorySandboxRecord): OpenedSandbox {
  return {
    name: record.name,
    status: record.status,
    running: record.running,
    tags: record.tags,
    snapshotId: record.snapshotId,
    createdAt: record.createdAt,
    timeout: Duration.toMillis(SANDBOX_IDLE),
    vcpus: record.vcpus,
    expiresAt: record.expiresAt,
    routes: record.routes,
  };
}

/** A sandbox kept in memory, its hooks the suite's. */
export function memorySandbox(hooks: MemorySandboxHooks = {}): MemorySandbox {
  const state: MemorySandboxState = {
    sandboxes: new Map(),
    commands: [],
    files: [],
    policies: [],
    snapshots: [],
    drives: new Map(),
    deletedDrives: [],
    goneSnapshots: new Set(),
    stopped: [],
    deleted: [],
    resumed: [],
    interactive: [],
    touched: [],
  };

  const nextRun = counter("run_");
  const nextSnapshot = counter("snap_");
  const nextCommand = counter("cmd_");

  /** The call's failure where the suite scripts one, else its work. */
  const scripted = <A>(
    call: SandboxCall,
    name: string,
    work: Effect.Effect<A, SandboxError>,
  ): Effect.Effect<A, SandboxError> =>
    Effect.suspend(() => {
      const failure = hooks.fail?.(call, name);

      if (failure === undefined) return work;

      return Effect.isEffect(failure) ? failure : Effect.fail(failure);
    });

  /** The target's sandbox, up in the run it names where it names one; gone where it stands in another or none. */
  const reached = (call: SandboxCall, target: SandboxTarget) =>
    Effect.suspend(() => {
      const name = Predicate.isString(target) ? target : target.name;
      const record = state.sandboxes.get(name);

      if (record === undefined) return Effect.fail(new SandboxGone({ call }));

      if (!Predicate.isString(target) && target.running !== record.running) {
        return Effect.fail(new SandboxGone({ call }));
      }

      return Effect.succeed(record);
    });

  /** The target's sandbox, which must be up for the call. */
  const up = (call: SandboxCall, target: SandboxTarget) =>
    Effect.flatMap(reached(call, target), (record) =>
      record.status === SANDBOX_STATUS.RUNNING
        ? Effect.succeed(record)
        : Effect.fail(new SandboxGone({ call })),
    );

  /** The drive a create opens with, and whether it is the sandbox's own as it stood: a base drive made where none stands, or the sandbox's own, mounted again where it stands, else forked from an origin that must, or made empty where the ask names its own. */
  const driveFor = (name: string, asked: SandboxDrive) =>
    Effect.suspend(() => {
      if ("fill" in asked) {
        if (!state.drives.has(asked.fill)) {
          state.drives.set(asked.fill, { name: asked.fill, forkedFrom: undefined });
        }

        return Effect.succeed({ drive: { name: asked.fill, at: asked.at }, kept: false });
      }

      const own = ownDriveName(name);

      if (state.drives.has(own))
        return Effect.succeed({ drive: { name: own, at: asked.at }, kept: true });

      if ("own" in asked) {
        state.drives.set(own, { name: own, forkedFrom: undefined });

        return Effect.succeed({ drive: { name: own, at: asked.at }, kept: false });
      }

      const origin = "base" in asked.fork ? asked.fork.base : ownDriveName(asked.fork.ownedBy);

      if (!state.drives.has(origin))
        return Effect.fail(new SandboxGone({ call: SANDBOX_CALL.CREATE }));
      state.drives.set(own, { name: own, forkedFrom: origin });

      return Effect.succeed({ drive: { name: own, at: asked.at }, kept: false });
    });

  const opened = (ask: SandboxCreate & { readonly user?: SandboxUser }) =>
    Effect.gen(function* () {
      if ("snapshotId" in ask.from && state.goneSnapshots.has(ask.from.snapshotId)) {
        return yield* new SnapshotGone({ call: SANDBOX_CALL.CREATE });
      }

      const mounted = ask.drive === undefined ? undefined : yield* driveFor(ask.name, ask.drive);
      const drive = mounted?.drive;

      const record: MemorySandboxRecord = {
        name: ask.name,
        status: SANDBOX_STATUS.RUNNING,
        running: nextRun(),
        tags: { ...ask.tags },
        snapshotId: undefined,
        persistent: false,
        createdAt: yield* Clock.currentTimeMillis,
        from: ask.from,
        drive,
        vcpus: ask.vcpus,
        env: { ...ask.env },
        user: ask.user,
        expiresAt: undefined,
        routes: [],
      };

      state.sandboxes.set(ask.name, record);

      return { record, driveKept: mounted?.kept === true };
    });

  const resumed = (record: MemorySandboxRecord) =>
    Effect.suspend(() => {
      if (record.status === SANDBOX_STATUS.RUNNING) return Effect.succeed(record);

      // Note that a stopped sandbox that is not persistent kept no disk to resume, unless a snapshot was taken of it.
      const kept =
        record.snapshotId === undefined
          ? record.persistent
          : !state.goneSnapshots.has(record.snapshotId);

      if (!kept) return Effect.fail(new SnapshotGone({ call: SANDBOX_CALL.GET }));

      record.status = SANDBOX_STATUS.RUNNING;
      record.running = nextRun();
      state.resumed.push({ name: record.name, running: record.running });

      return Effect.succeed(record);
    });

  const command = (
    record: MemorySandboxRecord,
    ask: CommandAsk | DetachedCommandAsk,
    detached: boolean,
  ): MemoryCommand => {
    const made: MemoryCommand = {
      id: nextCommand(),
      name: record.name,
      running: record.running,
      ask,
      detached,
      stdin: "",
      exit: null,
      stderr: "",
    };

    state.commands.push(made);

    return made;
  };

  /** The command the target's run started; gone where the run is no longer the sandbox's or never started it. */
  const commandOn = (call: SandboxCall, target: SandboxTarget, commandId: string) =>
    Effect.flatMap(reached(call, target), (record) => {
      const found = state.commands.find(
        (each) => each.id === commandId && each.running === record.running,
      );

      return found === undefined || record.status !== SANDBOX_STATUS.RUNNING
        ? Effect.fail(new SandboxGone({ call }))
        : Effect.succeed(found);
    });

  const stop = (record: MemorySandboxRecord) => {
    record.status = SANDBOX_STATUS.STOPPED;
    state.stopped.push({ name: record.name, running: record.running });

    for (const each of state.commands) {
      if (each.running === record.running && each.exit === null) each.exit = 143;
    }
  };

  const nameOf = (target: SandboxTarget) => (Predicate.isString(target) ? target : target.name);

  const service: SandboxService = {
    listTagged: (tag, value) =>
      scripted(
        SANDBOX_CALL.LIST,
        "",
        Effect.sync(() =>
          [...state.sandboxes.values()]
            .flatMap((record): ListedSandbox[] =>
              record.tags[tag] === value ? [{ ...listedOf(record), routes: undefined }] : [],
            )
            .toSorted((first, second) => (second.createdAt ?? 0) - (first.createdAt ?? 0)),
        ),
      ),
    get: (name) =>
      scripted(
        SANDBOX_CALL.GET,
        name,
        Effect.sync(() => {
          const record = state.sandboxes.get(name);

          return record === undefined ? undefined : listedOf(record);
        }),
      ),
    driveStands: (name) =>
      scripted(
        SANDBOX_CALL.DRIVE,
        name,
        Effect.sync(() => state.drives.has(name)),
      ),
    ownDriveStands: (sandboxName) =>
      scripted(
        SANDBOX_CALL.DRIVE,
        sandboxName,
        Effect.sync(() => state.drives.has(ownDriveName(sandboxName))),
      ),
    resume: (name) =>
      scripted(
        SANDBOX_CALL.GET,
        name,
        Effect.suspend((): Effect.Effect<OpenedSandbox, SandboxError> => {
          const record = state.sandboxes.get(name);

          return record === undefined
            ? Effect.fail(new SandboxGone({ call: SANDBOX_CALL.GET }))
            : Effect.map(resumed(record), listedOf);
        }),
      ),
    create: (ask) =>
      scripted(
        SANDBOX_CALL.CREATE,
        ask.name,
        Effect.suspend(
          (): Effect.Effect<OpenedSandbox, SandboxError> =>
            state.sandboxes.has(ask.name)
              ? Effect.fail(new SandboxNameTaken({ call: SANDBOX_CALL.CREATE }))
              : Effect.map(opened(ask), ({ record }) => listedOf(record)),
        ),
      ),
    getOrCreate: (ask, onCreate) =>
      scripted(
        SANDBOX_CALL.GET_OR_CREATE,
        ask.name,
        Effect.gen(function* () {
          const standing = state.sandboxes.get(ask.name);

          // A stopped sandbox whose own drive stands is made anew on that drive rather than resumed, where the ask names its own.
          const replaced =
            standing !== undefined &&
            ask.drive !== undefined &&
            "own" in ask.drive &&
            standing.status === SANDBOX_STATUS.STOPPED &&
            state.drives.has(ownDriveName(ask.name));

          if (standing !== undefined && !replaced) {
            const woken = yield* Effect.result(resumed(standing));

            if (Result.isSuccess(woken)) return listedOf(woken.success);
          }

          // Note that a resume fails only with `SnapshotGone`, so a failed one is a sandbox to make anew.
          if (standing !== undefined) {
            state.sandboxes.delete(ask.name);
            state.deleted.push(ask.name);
          }

          const { record, driveKept } = yield* opened(ask);
          const created = { ...listedOf(record), driveKept };

          if (onCreate !== undefined) {
            yield* Effect.tryPromise({
              try: () => onCreate(created),
              catch: () => new SandboxUnavailable({ call: SANDBOX_CALL.GET_OR_CREATE }),
            });
          }

          return created;
        }),
      ),
    delete: (name) =>
      scripted(
        SANDBOX_CALL.DELETE,
        name,
        Effect.sync(() => {
          if (state.sandboxes.delete(name)) state.deleted.push(name);

          if (state.drives.delete(ownDriveName(name))) state.deletedDrives.push(ownDriveName(name));
        }),
      ),
    deleteDrive: (name) =>
      scripted(
        SANDBOX_CALL.DRIVE,
        name,
        Effect.suspend(() => {
          const mounted = [...state.sandboxes.values()].some(
            (record) => record.drive?.name === name && record.status === SANDBOX_STATUS.RUNNING,
          );

          if (mounted) return Effect.fail(new SandboxUnavailable({ call: SANDBOX_CALL.DRIVE }));

          if (state.drives.delete(name)) state.deletedDrives.push(name);

          return Effect.void;
        }),
      ),
    stop: (target) =>
      scripted(
        SANDBOX_CALL.STOP,
        nameOf(target),
        reached(SANDBOX_CALL.STOP, target).pipe(
          Effect.flatMap((record) =>
            Effect.sync(() =>
              record.status === SANDBOX_STATUS.RUNNING ? stop(record) : undefined,
            ),
          ),
          Effect.catchTag("SandboxGone", () => Effect.void),
        ),
      ),
    updateTags: (name, tags) =>
      scripted(
        SANDBOX_CALL.TAGS,
        name,
        Effect.map(reached(SANDBOX_CALL.TAGS, name), (record) => {
          record.tags = { ...tags };
        }),
      ),
    updatePorts: (name, ports) =>
      scripted(
        SANDBOX_CALL.PORTS,
        name,
        Effect.map(reached(SANDBOX_CALL.PORTS, name), (record) => {
          record.routes = ports.map((port) => ({ port, url: `https://${name}-${port}.memory` }));

          return record.routes;
        }),
      ),
    run: (target, ask) =>
      scripted(
        SANDBOX_CALL.CMD,
        nameOf(target),
        Effect.gen(function* () {
          const record = yield* up(SANDBOX_CALL.CMD, target);
          const ran = command(record, ask, false);
          const answer = hooks.run?.(ran, record);

          const finished =
            answer === undefined
              ? { exitCode: 0, stdout: "", stderr: "" }
              : Effect.isEffect(answer)
                ? yield* answer
                : answer;

          ran.exit = finished.exitCode;
          ran.stderr = finished.stderr;

          return finished;
        }),
      ),
    start: (target, ask) =>
      scripted(
        SANDBOX_CALL.CMD,
        nameOf(target),
        Effect.map(up(SANDBOX_CALL.CMD, target), (record) => {
          const started = command(record, ask, true);
          hooks.start?.(started, record);

          return started.id;
        }),
      ),
    writeStdin: (target, commandId, text) =>
      scripted(
        SANDBOX_CALL.STDIN,
        nameOf(target),
        Effect.flatMap(commandOn(SANDBOX_CALL.STDIN, target, commandId), (found) => {
          if (found.exit !== null)
            return Effect.fail(new SandboxGone({ call: SANDBOX_CALL.STDIN }));
          found.stdin += text;

          return Effect.void;
        }),
      ),
    commandExit: (target, commandId) =>
      scripted(
        SANDBOX_CALL.CMD,
        nameOf(target),
        commandOn(SANDBOX_CALL.CMD, target, commandId).pipe(
          Effect.map((found): CommandExit => found.exit),
          Effect.catchTag("SandboxGone", () => Effect.succeed<CommandExit>(COMMAND_GONE)),
        ),
      ),
    commandStderrTail: (target, commandId) =>
      scripted(
        SANDBOX_CALL.LOGS,
        nameOf(target),
        Effect.map(commandOn(SANDBOX_CALL.LOGS, target, commandId), (found) =>
          found.stderr === "" ? undefined : found.stderr,
        ),
      ),
    kill: (target, commandId) =>
      scripted(
        SANDBOX_CALL.KILL,
        nameOf(target),
        commandOn(SANDBOX_CALL.KILL, target, commandId).pipe(
          Effect.flatMap((found) =>
            Effect.sync(() => {
              found.exit = found.exit ?? 143;
            }),
          ),
          Effect.catchTag("SandboxGone", () => Effect.void),
        ),
      ),
    writeFiles: (target, files) =>
      scripted(
        SANDBOX_CALL.FS_WRITE,
        nameOf(target),
        Effect.map(up(SANDBOX_CALL.FS_WRITE, target), (record) => {
          for (const file of files) {
            state.files.push({ name: record.name, running: record.running, file });
          }
        }),
      ),
    openInteractive: (target) =>
      scripted(
        SANDBOX_CALL.INTERACTIVE,
        nameOf(target),
        Effect.map(up(SANDBOX_CALL.INTERACTIVE, target), (record) => {
          state.interactive.push({ name: record.name, running: record.running });

          return {
            url: `wss://${record.name}.memory/pty`,
            token: Redacted.make(`token-${record.running}`),
          };
        }),
      ),
    connectPty: () => Effect.fail(new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE })),
    updateNetworkPolicy: (target, policy) =>
      scripted(
        SANDBOX_CALL.NETWORK_POLICY,
        nameOf(target),
        Effect.map(up(SANDBOX_CALL.NETWORK_POLICY, target), (record) => {
          state.policies.push({ name: record.name, running: record.running, policy });
        }),
      ),
    snapshot: (target, expiresAfter) =>
      scripted(
        SANDBOX_CALL.SNAPSHOT,
        nameOf(target),
        Effect.gen(function* () {
          const record = yield* up(SANDBOX_CALL.SNAPSHOT, target);
          const id = nextSnapshot();
          const lapseMs = Duration.isFinite(expiresAfter) ? Duration.toMillis(expiresAfter) : 0;
          state.snapshots.push({ id, name: record.name, running: record.running, lapseMs });
          stop(record);
          record.snapshotId = id;

          return id;
        }),
      ),
    touch: (name) =>
      scripted(
        SANDBOX_CALL.TOUCH,
        name,
        Effect.gen(function* () {
          const record = state.sandboxes.get(name);

          if (record?.status !== SANDBOX_STATUS.RUNNING) return;
          record.expiresAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(SANDBOX_IDLE);
          state.touched.push({ name, running: record.running });
        }),
      ),
  };

  return {
    layer: Layer.succeed(Sandbox, service),
    state,
    service,
    stand: (sandbox) => {
      const record: MemorySandboxRecord = {
        status: SANDBOX_STATUS.RUNNING,
        running: nextRun(),
        tags: {},
        snapshotId: undefined,
        persistent: true,
        createdAt: 0,
        from: { image: "memory-image" },
        drive: undefined,
        vcpus: undefined,
        env: {},
        user: undefined,
        expiresAt: undefined,
        routes: [],
        ...sandbox,
      };

      state.sandboxes.set(record.name, record);

      return record;
    },
    exited: (commandId, code) => {
      const found = state.commands.find((each) => each.id === commandId);

      if (found !== undefined) found.exit = code;
    },
  };
}
