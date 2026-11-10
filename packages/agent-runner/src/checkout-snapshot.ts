/**
 * checkout-snapshot.ts -- the agent's checkout recorded as a commit before each of its turns, so a rewind to before that turn can put its files back.
 *
 * Before a message line is handed to the harness, the whole working tree
 * is written as one commit on `HEAD`: what the agent committed, what it
 * changed, and every file it made that git does not ignore, so what a
 * shell command wrote is caught as a tool's edit is. The commit is built on
 * a copy of the checkout's own index, kept beside it under `.git`, so the
 * index's stat cache carries over and only the files changed since are
 * hashed, and the checkout's own index, its working tree, its branch, and
 * `HEAD` are never touched. The commit stands under a ref named for when
 * it was taken and for the line (`CHECKOUT_SNAPSHOT.REF_PREFIX`), the one
 * id the runner holds, which the service ties to the turn the line opened
 * as it records the ACCEPTED event that carries the snapshot; a restore
 * finds the commit by what the turn's row says, so the ref only keeps it
 * from being collected. The ref is one of the worktree's own
 * (`refs/worktree/`), so a Mac's worktree keeps its own apart from the
 * clone it was cut from and they go when the worktree does; a sandbox's
 * clone keeps them as any ref. The ref never leaves the machine: it is
 * not pushed, and a commit is signed by no one, made under a name of the
 * runner's own rather than the agent's identity. Each snapshot prunes the
 * refs beyond the newest `KEEP`, newest by the stamp in their names, and
 * lets `git gc --auto` collect what they held. A snapshot that fails, or runs past its bound, is a miss the turn
 * goes on without, logged, so a rewind to before that turn offers no restore.
 */

import { Clock, Context, Duration, Effect, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CHECKOUT_SNAPSHOT, type CheckoutSnapshot } from "./protocol.js";

const SNAPSHOT_BOUNDS = {
  /** The most a turn waits on its snapshot before it goes on without one. */
  TIMEOUT: Duration.seconds(20),
  /** How long a snapshot past its bound is given to end before it is killed. */
  KILL_GRACE: Duration.seconds(2),
  /** How many characters of a failed snapshot's stderr are logged, from its end. */
  STDERR_TAIL: 400,
} as const;

/** Who the snapshot commits are by: no one's identity but a label of the runner's own, since a snapshot is never pushed. */
const SNAPSHOT_COMMITTER = {
  NAME: "Checkout snapshot",
  EMAIL: "checkout-snapshot@runner.invalid",
} as const;

export interface CheckoutSnapshotsShape {
  /** The checkout at `cwd` recorded under the line's id, as above; none where it could not be, which is logged. */
  readonly take: (cwd: string, lineId: string) => Effect.Effect<CheckoutSnapshot | undefined>;
}

export class CheckoutSnapshots extends Context.Service<CheckoutSnapshots, CheckoutSnapshotsShape>()(
  "@repo/agent-runner/CheckoutSnapshots",
) {}

/**
 * The snapshot, run in the checkout with the ref's name and how many refs
 * to keep as its two arguments: the index copied, the working tree added
 * to the copy, the tree written and committed on `HEAD`, the ref written,
 * the refs beyond the newest kept pruned, and the commit, `HEAD`, and the
 * branch printed on three lines, the last two empty where there is none.
 * The refs are pruned by their names, which sort by the stamp each opens
 * with, so two taken within a second still stand in the order they were
 * taken. `git gc --auto` returns at once and packs in the background where
 * there is something to pack.
 */
const SNAPSHOT_SCRIPT = [
  "set -eu",
  "umask 0002",
  "git_dir=$(git rev-parse --git-dir)",
  'index="$git_dir/vespin-snapshot-index"',
  'if [ -f "$git_dir/index" ]; then cp "$git_dir/index" "$index"; else rm -f "$index"; fi',
  'GIT_INDEX_FILE="$index"',
  "export GIT_INDEX_FILE",
  "head=$(git rev-parse --verify --quiet HEAD) || head=",
  "git add -A -- .",
  "tree=$(git write-tree)",
  'if [ -n "$head" ]; then commit=$(git commit-tree "$tree" -p "$head" -m "The checkout before a turn"); else commit=$(git commit-tree "$tree" -m "The checkout before a turn"); fi',
  'rm -f "$index"',
  "unset GIT_INDEX_FILE",
  'git update-ref "$1" "$commit"',
  "prefix=${1%/*}/",
  'git for-each-ref --sort=-refname --format="%(refname)" "$prefix" | tail -n +"$(($2 + 1))" | while read -r stale; do git update-ref -d "$stale"; done',
  "git gc --auto --quiet 2>/dev/null || true",
  "branch=$(git symbolic-ref --short --quiet HEAD) || branch=",
  'printf \'%s\\n%s\\n%s\\n\' "$commit" "$head" "$branch"',
].join("\n");

/** How many digits the stamp a ref opens with is padded to, so the refs sort by it as text for as long as epoch milliseconds fit. */
const STAMP_DIGITS = 16;

/** The ref a snapshot taken at `now` for the line stands under: its stamp first, so the refs sort by when they were taken, then the line's id. */
export function snapshotRef(now: number, lineId: string): string {
  return `${CHECKOUT_SNAPSHOT.REF_PREFIX}${String(now).padStart(STAMP_DIGITS, "0")}-${lineId}`;
}

const SHA = /^[0-9a-f]{40,64}$/u;

/** The commit, `HEAD`, and branch the snapshot printed on its three lines; nothing where it printed no commit. */
function printedSnapshot(stdout: string): CheckoutSnapshot | undefined {
  const [commit, head, branch] = stdout.split("\n");
  if (commit === undefined || !SHA.test(commit)) return undefined;
  return {
    commit,
    ...(head !== undefined && SHA.test(head) ? { head } : undefined),
    ...(branch !== undefined && branch !== "" ? { branch } : undefined),
  };
}

/** The end of a failed snapshot's stderr as a log line takes it: its lines joined into one, then its last `STDERR_TAIL` characters. */
function stderrTail(stderr: string): string {
  return stderr
    .trim()
    .replace(/\s*\n\s*/gu, " / ")
    .slice(-SNAPSHOT_BOUNDS.STDERR_TAIL);
}

/**
 * The snapshot run as a child of the runner's own, as app-server is, on
 * the environment given: git's path and home alone reach it, so no secret of
 * the launch's does. The process is ended where it runs past the bound.
 */
const takeIn = Effect.fn("agent-runner/checkoutSnapshot")(function* (
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  lineId: string,
): Effect.fn.Return<CheckoutSnapshot | undefined, never, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const ran = yield* Effect.gen(function* () {
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        "sh",
        [
          "-c",
          SNAPSHOT_SCRIPT,
          "sh",
          snapshotRef(yield* Clock.currentTimeMillis, lineId),
          String(CHECKOUT_SNAPSHOT.KEEP),
        ],
        {
          cwd,
          env: {
            ...(env.PATH === undefined ? undefined : { PATH: env.PATH }),
            ...(env.HOME === undefined ? undefined : { HOME: env.HOME }),
            GIT_TERMINAL_PROMPT: "0",
            GIT_AUTHOR_NAME: SNAPSHOT_COMMITTER.NAME,
            GIT_AUTHOR_EMAIL: SNAPSHOT_COMMITTER.EMAIL,
            GIT_COMMITTER_NAME: SNAPSHOT_COMMITTER.NAME,
            GIT_COMMITTER_EMAIL: SNAPSHOT_COMMITTER.EMAIL,
          },
          extendEnv: false,
          stdin: "ignore",
          forceKillAfter: SNAPSHOT_BOUNDS.KILL_GRACE,
        },
      ),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        handle.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, exitCode: Number(exitCode) };
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(SNAPSHOT_BOUNDS.TIMEOUT),
    Effect.mapError((failure) => String(failure)),
    Effect.result,
  );
  if (Result.isFailure(ran)) {
    yield* Effect.logWarning(`agent-runner: the checkout was not snapshotted: ${ran.failure}`);
    return undefined;
  }
  if (Option.isNone(ran.success)) {
    yield* Effect.logWarning("agent-runner: the checkout was not snapshotted in time");
    return undefined;
  }
  const { stdout, stderr, exitCode } = ran.success.value;
  const snapshot = exitCode === 0 ? printedSnapshot(stdout) : undefined;
  if (snapshot === undefined) {
    yield* Effect.logWarning(
      `agent-runner: the checkout was not snapshotted: the snapshot exited ${exitCode}: ${stderrTail(stderr)}`,
    );
    return undefined;
  }
  return snapshot;
});

/** Snapshots through git itself, as a child of the runner's, on the environment given. */
export function checkoutSnapshotsLive(
  env: Readonly<Record<string, string | undefined>>,
): Layer.Layer<CheckoutSnapshots, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Layer.effect(
    CheckoutSnapshots,
    Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) => ({
      take: (cwd, lineId) =>
        takeIn(env, cwd, lineId).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
    })),
  );
}
