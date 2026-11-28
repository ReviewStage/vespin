/**
 * mirror-match-remote.ts -- a mirror's match run in a process of its own, one at a time, so reading and hashing a checkout never holds this process's event loop.
 *
 * A match stats every file of the mirror and reads and hashes each whose
 * size agrees with the manifest's (`mirror-disk.ts`), which on a checkout
 * of nine thousand files held the main process 96% busy for two seconds
 * each time a mirror connected. So the desktop matches in a child process
 * it spawns the first time a mirror connects (`mirror-match-worker.ts` is
 * what that process runs), and this module is the asking side: one match
 * in flight at a time, answered under its id, and a process that died or
 * stalled replaced by the next match's own, the match it held failed for
 * the mirror's next connection to try again. The process is a seam
 * (`process-asking.ts`), so the desktop forks it with Electron's
 * `utilityProcess` and a test with Node's own.
 */

import { Data, Duration, Effect, Exit, Option, Schema, Scope, Semaphore } from "effect";
import type { ManifestFile } from "./mirror-disk.js";
import {
  type AskedProcess,
  type AskedProcessListeners,
  answerFor,
  type SpawnAskedProcess,
  type StandingProcess,
  spawnInto,
} from "./process-asking.js";

/** How long one match may take in the process before it fails and the process is replaced: a cold checkout's whole read. */
const MATCH_DEADLINE = Duration.minutes(2);

/** A match sent to the process: the mirror's folder, its own files as git lists them, and the manifest, under an id its answer carries back. */
export const mirrorMatchRequestSchema = Schema.Struct({
  id: Schema.Number,
  root: Schema.String,
  listed: Schema.Array(Schema.String),
  files: Schema.Array(
    Schema.Struct({ path: Schema.String, size: Schema.Number, hash: Schema.String }),
  ),
});

/** What the process answers for a match: the id it was sent under, and the paths to ask for, absent where the match failed. */
export const mirrorMatchAnswerSchema = Schema.Struct({
  id: Schema.Number,
  asked: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** A match that did not answer: the process failed it, ended, or took past its deadline. */
export class MirrorMatchFailed extends Data.TaggedError("MirrorMatchFailed")<{
  readonly timedOut: boolean;
}> {}

/** A mirror matched against its manifest, answering the paths to ask the bridge for. */
export type MatchMirror = (
  root: string,
  listed: readonly string[],
  files: readonly ManifestFile[],
) => Effect.Effect<readonly string[], MirrorMatchFailed>;

/** A process that matches, as the asking side holds it: a message sent to it, and its end. */
export type MirrorMatchProcess = AskedProcess<typeof mirrorMatchRequestSchema.Encoded>;

/** What the process's spawner hands what it hears: each message, and the process's exit. */
export type MirrorMatchProcessListeners = AskedProcessListeners;

/** Starts a process that matches, wired to `listeners`; a throw is a process that could not be started. */
export type SpawnMirrorMatchProcess = SpawnAskedProcess<typeof mirrorMatchRequestSchema.Encoded>;

type Spawned = StandingProcess<typeof mirrorMatchRequestSchema.Encoded>;

/** The paths the process answered for `id`; none where it failed the match, ended first, or answered what it should not. */
const askedFor = (spawned: Spawned, id: number) =>
  Effect.map(answerFor(spawned.answers, id, mirrorMatchAnswerSchema), (answer) => answer?.asked);

/**
 * Matching through a process `spawn` starts the first time a mirror is
 * matched and that stands for the life of the scope this runs in, whose
 * close kills it. A process that ends, fails to start, or stalls past
 * `MATCH_DEADLINE` fails the match it held and is retired, and the next
 * match spawns its own.
 */
export function mirrorMatchInProcess(
  spawn: SpawnMirrorMatchProcess,
): Effect.Effect<MatchMirror, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const oneAtATime = yield* Semaphore.make(1);
    let standing: Spawned | undefined;
    let lastId = 0;

    const retire = (spawned: Spawned) =>
      Effect.suspend(() => {
        if (standing === spawned) standing = undefined;

        return Scope.close(spawned.scope, Exit.void);
      });

    const matchInProcess = (
      root: string,
      listed: readonly string[],
      files: readonly ManifestFile[],
    ) =>
      Effect.gen(function* () {
        // Note that a process that exited while idle is retired before the match, so its replacement matches.
        if (standing?.exited() === true) yield* retire(standing);
        const spawned = standing ?? (yield* spawnInto(scope, spawn));
        standing = spawned;
        lastId += 1;
        const id = lastId;

        // Note that the request is sent as it stands, unencoded, because its encoded shape is its own and encoding a checkout's manifest is work this process is spared.
        const sent = yield* Effect.exit(
          Effect.try(() => spawned.child.send({ id, root, listed, files })),
        );

        const asked = Exit.isSuccess(sent)
          ? yield* Effect.timeoutOption(askedFor(spawned, id), MATCH_DEADLINE)
          : Option.none();

        if (Option.isSome(asked) && asked.value !== undefined) return asked.value;

        // Note that a process that failed one match but stands is kept; one that ended or stalled is replaced.
        if (Option.isSome(asked) && !spawned.exited()) {
          return yield* Effect.fail(new MirrorMatchFailed({ timedOut: false }));
        }

        yield* retire(spawned);

        return yield* Effect.fail(new MirrorMatchFailed({ timedOut: Option.isNone(asked) }));
      });

    return (root, listed, files) =>
      oneAtATime.withPermit(
        Effect.catchDefect(matchInProcess(root, listed, files), () =>
          Effect.fail(new MirrorMatchFailed({ timedOut: false })),
        ),
      );
  });
}
