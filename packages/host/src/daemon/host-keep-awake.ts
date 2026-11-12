import { KEEP_AWAKE, type KeepAwake } from "@repo/settings";
import { Duration, Effect, type Path, Schedule, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { keepAwakeChoices } from "../keep-awake-record.js";

/**
 * host-keep-awake.ts -- a Mac's host keeping the Mac from idle-sleeping, as the choice its state holds says (`keep-awake-record.ts`): never, while any of its agents' runners runs, or whenever the Mac is plugged in and otherwise while a runner runs.
 *
 * The hold is macOS's own idle-sleep assertion, taken by `caffeinate -i`,
 * as every agent app that keeps a Mac awake takes it: the screen still
 * sleeps and locks, and closing a laptop's lid still sleeps it, as Apple's
 * clamshell rule says. `-w` names the host's own process, so the assertion
 * goes with the host however it ends, and the hold is the process's life:
 * started where the Mac should stay awake, and stopped where it no longer
 * should. Note that a runner stays up between an agent's turns while it is
 * warm (`@repo/service`'s `RUNNER_WARM`), so "while agents work" spans those
 * waits, and a message sent from a phone in them still finds the Mac awake.
 * Whether the Mac is plugged in is read from `pmset` every `POWER_EVERY`,
 * and only while the choice asks it.
 */

/** macOS's own tool for holding a power assertion while it runs. */
const CAFFEINATE = "/usr/bin/caffeinate";

/** macOS's power settings tool, whose `-g ps` names the power source the Mac draws from. */
const PMSET = "/usr/bin/pmset";

/** What `pmset -g ps` says first where the Mac runs on its battery. */
const ON_BATTERY = "'Battery Power'";

/** How often the power source is read while the choice depends on it. */
const POWER_EVERY = Duration.minutes(1);

export interface HostKeepAwakeOptions {
  /** The host's state, where the app hands its choice. */
  readonly stateRoot: string;
  /** Whether any runner of the host runs, as it stands now and each time it changes. */
  readonly working: Stream.Stream<boolean>;
  /** The host's own process id, which the hold ends with. */
  readonly pid: number;
}

type KeepAwakeServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path;

/** Whether the Mac draws from a power adapter, read as plugged in where `pmset` cannot say, since a desktop Mac has no battery to name. */
const pluggedInNow = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make(PMSET, ["-g", "ps"], {
      stdin: "ignore",
      stderr: "ignore",
    });

    const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));

    return !printed.includes(ON_BATTERY);
  }),
).pipe(Effect.orElseSucceed(() => true));

/** Whether the Mac is plugged in, read at once and every `POWER_EVERY`, said only when it changed. */
const pluggedIn: Stream.Stream<boolean, never, ChildProcessSpawner.ChildProcessSpawner> =
  Stream.fromEffectSchedule(pluggedInNow, Schedule.spaced(POWER_EVERY)).pipe(Stream.changes);

/** Whether the Mac should be held awake now, by the choice given. */
const heldBy = (
  choice: KeepAwake,
  working: Stream.Stream<boolean>,
): Stream.Stream<boolean, never, ChildProcessSpawner.ChildProcessSpawner> => {
  switch (choice) {
    case KEEP_AWAKE.NEVER:
      return Stream.succeed(false);
    case KEEP_AWAKE.WORKING:
      return working;
    case KEEP_AWAKE.PLUGGED_IN:
      return Stream.zipLatestWith(working, pluggedIn, (running, plugged) => running || plugged);
    default: {
      const unhandled: never = choice;

      return Stream.die(new Error(`Unhandled keep-awake choice: ${String(unhandled)}`));
    }
  }
};

/** The idle-sleep assertion held for as long as the stream is read, by a `caffeinate` that ends with it, or with the host. */
const held = (pid: number) =>
  Stream.fromEffectDrain(
    Effect.scoped(
      Effect.andThen(
        ChildProcess.make(CAFFEINATE, ["-i", "-w", String(pid)], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
        Effect.never,
      ),
    ).pipe(Effect.ignore),
  );

/** The Mac kept awake as its host's choice says, for as long as the host runs. */
export const hostKeepAwake = (
  options: HostKeepAwakeOptions,
): Effect.Effect<void, never, KeepAwakeServices> =>
  keepAwakeChoices(options.stateRoot).pipe(
    Stream.switchMap((choice) => heldBy(choice, options.working)),
    Stream.changes,
    Stream.switchMap((hold) => (hold ? held(options.pid) : Stream.empty)),
    Stream.runDrain,
  );
