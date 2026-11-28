/**
 * process-asking.ts -- the asking side of a process of its own: the process as a seam, spawned into a scope that kills it, and its answer for an id read off what it sent.
 *
 * A mirror's match (`mirror-match-remote.ts`) and a block's coloring
 * (`task-code-remote.ts`) each run in a child process the desktop forks, and
 * each asks it one thing at a time under an id its answer carries back. What
 * is asked, when, and what a process that died or stalled costs are theirs;
 * this is the plumbing they share. Nothing here names Electron or Node: the
 * process is a seam (`SpawnAskedProcess`), so the desktop forks it with
 * Electron's `utilityProcess` and a test with Node's own.
 */

import type { WireBoundaryInput } from "@repo/wire";
import { type Cause, Effect, Option, Queue, Schema, Scope } from "effect";

/** A process as the asking side holds it: a message sent to it, and its end. */
export interface AskedProcess<Request> {
  readonly send: (message: Request) => void;
  readonly kill: () => void;
}

/** What the process's spawner hands what it hears: each message, and the process's exit. */
export interface AskedProcessListeners {
  readonly onMessage: (message: WireBoundaryInput) => void;
  readonly onExit: () => void;
}

/** Starts a process wired to `listeners`; a throw is a process that could not be started. */
export type SpawnAskedProcess<Request> = (
  listeners: AskedProcessListeners,
) => AskedProcess<Request>;

/** One process standing: what it was spawned as, what it answered, and the scope that ends it. */
export interface StandingProcess<Request> {
  readonly child: AskedProcess<Request>;
  readonly answers: Queue.Queue<WireBoundaryInput, Cause.Done>;
  readonly scope: Scope.Closeable;
  /** Whether the process has exited, so nothing further is sent to it. */
  readonly exited: () => boolean;
}

/** Spawns a process into a scope of its own under `parent`, so its scope's close, or the parent's, kills it. */
export function spawnInto<Request>(
  parent: Scope.Scope,
  spawn: SpawnAskedProcess<Request>,
): Effect.Effect<StandingProcess<Request>> {
  return Effect.gen(function* () {
    const scope = yield* Scope.fork(parent);
    const answers = yield* Queue.unbounded<WireBoundaryInput, Cause.Done>();
    let exited = false;

    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        spawn({
          onMessage: (message) => {
            Queue.offerUnsafe(answers, message);
          },
          onExit: () => {
            exited = true;
            Queue.endUnsafe(answers);
          },
        }),
      ),
      (spawned) => Effect.sync(() => spawned.kill()),
    ).pipe(Scope.provide(scope));

    return { child, answers, scope, exited: () => exited };
  });
}

/** The answer the process sent for `id`, decoded by `schema`; none where it ended first or answered what it should not. */
export function answerFor<Answer extends { readonly id: number }>(
  answers: Queue.Queue<WireBoundaryInput, Cause.Done>,
  id: number,
  schema: Schema.Decoder<Answer>,
): Effect.Effect<Answer | undefined> {
  return Effect.matchEffect(Queue.take(answers), {
    onFailure: () => Effect.succeed(undefined),
    onSuccess: (message) => {
      const answer = Schema.decodeUnknownOption(schema)(message);

      if (Option.isNone(answer)) return Effect.succeed(undefined);

      // Note that an answer for an earlier id is one a stalled ask gave too late, and is passed over.
      return answer.value.id === id ? Effect.succeed(answer.value) : answerFor(answers, id, schema);
    },
  });
}
