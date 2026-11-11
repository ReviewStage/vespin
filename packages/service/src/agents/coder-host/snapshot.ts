/**
 * snapshot.ts -- the work of a source agent whose sandbox is not stopped on a snapshot, pushed or not, copied to a new branch for an agent continued or forked from it.
 *
 * A source whose sandbox stands stopped on a snapshot hands that sandbox
 * instead, whose latest snapshot the new agent's is created from
 * (`takeover.ts`'s `sourceWorkOf`), so this copy serves a source still
 * running, or one opened before sandboxes were named for their session.
 *
 * Each agent runs in a sandbox of its own, so what the source never
 * committed and pushed would be lost to the agent started from it. As that
 * Start is made, the service reaches the source's sandbox by its
 * session's name (`../agent-sandbox-open.ts`), wakes it where it stopped, as
 * the Terminal tab's resume does, and records its checkout whole: what it
 * committed, what it changed, and every file it made that git does not
 * ignore, as one commit on top of its `HEAD`, or `HEAD` itself where
 * nothing changed. The commit is built on an index of its own in a
 * temporary directory, so the source's own index and working tree are never
 * touched, and the source may be idle or mid-turn: nothing here writes to it
 * but git's objects, and a push. The push goes through the repository's
 * write credential, set at the sandbox's firewall in the shape the agent's
 * own session and the Terminal tab set it, beside the swaps of the launch
 * running there (`../sandbox-firewall.ts`), so no token
 * enters the sandbox's files or a command's words; the credential stays
 * there until the sandbox stops or the next write replaces it. A sandbox this step woke stops
 * `SANDBOX_IDLE` after its last touch (`@repo/sandbox`), as every idle sandbox does. A copy that fails logs the tail of what
 * it printed on stderr, credential-shaped runs redacted.
 * Files named the way credentials are kept are never copied. No copy is
 * made where the task moved to another repository since the source
 * started, since the new agent's checkout would not hold the branch. The
 * whole step is bounded, so a Start waits on it no longer than that, and
 * whatever goes wrong is a miss the caller names, never a failure.
 */

import { createHash } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, hasRepository, readAgentByKey } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { redactCredentials } from "@repo/features/credential-redaction";
import {
  type ListedSandbox,
  resumedRunning,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxRunning,
  UP_STATUSES,
} from "@repo/sandbox";
import { Duration, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../github/github-app.js";
import { agentSandboxName, agentSandboxOf } from "../agent-sandbox-open.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { type RepositoryCredential, sandboxFirewall } from "../sandbox-firewall.js";
import { CODER } from "./bounds.js";
import { agentRepositoryToken } from "./checkout.js";

export const SNAPSHOT = {
  /** The most a Start waits on the copy, the source's sandbox woken and the push included. */
  TIMEOUT: Duration.seconds(30),
  /** How many characters of a failed copy's stderr are logged, from its end. */
  STDERR_TAIL: 600,
} as const;

/** Why the source's work was not copied: the Start already made its agent, the task moved repository since the source started, the source never opened a sandbox, it runs on a Mac, whose checkout a Start never reads, the copy failed, or it ran past its bound. */
export const SNAPSHOT_MISS = {
  STARTED: "started",
  MOVED: "moved",
  NO_SANDBOX: "no-sandbox",
  ON_DEVICE: "on-device",
  FAILED: "failed",
  TIMED_OUT: "timed-out",
} as const;

export type SnapshotMiss = (typeof SNAPSHOT_MISS)[keyof typeof SNAPSHOT_MISS];

/** What a copy came to: the branch pushed, at its commit, and whether that commit holds work `HEAD` did not; or why there is none. */
export type SnapshotOutcome =
  | {
      readonly copied: true;
      readonly branch: string;
      readonly commit: string;
      readonly uncommitted: boolean;
    }
  | { readonly copied: false; readonly miss: SnapshotMiss };

/** What a copy is asked: whose sandbox, the branch and the commit's message, and the credential the push goes through. */
export interface SnapshotAsk<R> {
  /** The account whose agent the source is, under which its sandbox's firewall launch is kept. */
  readonly userId: string;
  /** The session the source's sandbox is tagged with. */
  readonly sessionId: string;
  readonly branch: string;
  readonly message: string;
  /** The repository's write credential, minted once the sandbox stands up. */
  readonly credential: Effect.Effect<RepositoryCredential, unknown, R>;
}

/**
 * Files the copy never picks up from the working tree, by glob, because
 * they are named the way credentials are kept and a push would publish
 * them: one tracked already stays as `HEAD` holds it.
 */
const UNCOPIED_PATHS: readonly string[] = [
  "**/.env",
  "**/.env.local",
  "**/.env.*.local",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/id_rsa",
  "**/id_ed25519",
];

/**
 * The copy, run in the checkout with the branch and the message as its two
 * arguments: the work recorded on an index of its own in a directory made
 * for it, committed on `HEAD` where the tree differs, pushed to the branch,
 * and the commit and `HEAD` printed on one line. The push skips the
 * repository's own hooks, which are the agent's to run, and forces, because
 * the branch is named for this one Start and a retry of it pushes again.
 * What it adds leaves out the files named like credentials above.
 */
const SNAPSHOT_SCRIPT = [
  "set -eu",
  "index_dir=$(mktemp -d)",
  "trap 'rm -rf \"$index_dir\"' EXIT",
  'GIT_INDEX_FILE="$index_dir/index"',
  "export GIT_INDEX_FILE",
  "head=$(git rev-parse --verify HEAD)",
  'git read-tree "$head"',
  `git add -A -- . ${UNCOPIED_PATHS.map((path) => `':(exclude,glob)${path}'`).join(" ")}`,
  "tree=$(git write-tree)",
  'if [ "$tree" = "$(git rev-parse "$head^{tree}")" ]; then commit=$head; else commit=$(git commit-tree "$tree" -p "$head" -m "$2"); fi',
  'git push --quiet --no-verify --force origin "$commit:refs/heads/$1"',
  'printf \'%s %s\\n\' "$commit" "$head"',
].join("\n");

/** The commit and `HEAD` the copy printed on its last line; nothing where it printed no such line. */
function printedCommits(
  stdout: string,
): { readonly commit: string; readonly head: string } | undefined {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  const [commit, head] = last.split(" ");
  const sha = /^[0-9a-f]{40,64}$/u;
  return commit !== undefined && head !== undefined && sha.test(commit) && sha.test(head)
    ? { commit, head }
    : undefined;
}

/** The run a running sandbox is up in; none for one not running. */
function runningOf(sandbox: ListedSandbox): SandboxRunning | undefined {
  return sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.running !== undefined
    ? { name: sandbox.name, running: sandbox.running }
    : undefined;
}

/**
 * The end of a failed copy's stderr as a log line takes it: credential-shaped
 * runs redacted and its lines joined into one, then its last `STDERR_TAIL`
 * characters kept. Note that the redaction comes before the cut, so a cut
 * never leaves the tail of a credential standing.
 */
function stderrTail(stderr: string): string {
  const line = redactCredentials(stderr)
    .trim()
    .replace(/\s*\n\s*/gu, " / ");
  return line.slice(-SNAPSHOT.STDERR_TAIL);
}

/** The copy in the source's sandbox, woken where it stopped. */
const copyIn = <R>(ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    const sandboxes = yield* Sandbox;
    const sandbox = yield* agentSandboxOf(sandboxes, ask.sessionId);
    if (sandbox === undefined) {
      return { copied: false, miss: SNAPSHOT_MISS.NO_SANDBOX } as const;
    }
    // MIGRATION: a legacy sandbox (`agentSandboxOf`) is never woken in place; a stopped one with a
    // snapshot is handed by it instead (`takeover.ts`'s `sourceWorkOf`), and one in any other
    // state is a miss.
    if (!UP_STATUSES.has(sandbox.status) && sandbox.name !== agentSandboxName(ask.sessionId)) {
      return { copied: false, miss: SNAPSHOT_MISS.FAILED } as const;
    }
    const running = runningOf(sandbox) ?? (yield* resumedRunning(sandbox.name));
    const owner = { userId: ask.userId, name: sandbox.name, sandboxSessionId: running.running };
    const credential = yield* ask.credential;
    yield* sandboxFirewall(sandboxes).write(owner, { github: credential });
    const ran = yield* sandboxes.run(running, {
      command: "sh",
      args: ["-c", SNAPSHOT_SCRIPT, "sh", ask.branch, ask.message],
      cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
    });
    const printed = ran.exitCode === 0 ? printedCommits(ran.stdout) : undefined;
    if (printed === undefined) {
      yield* Effect.logWarning(
        `the source's work was not copied: the copy exited ${ran.exitCode}: ${stderrTail(ran.stderr)}`,
      );
      return { copied: false, miss: SNAPSHOT_MISS.FAILED } as const;
    }
    return {
      copied: true,
      branch: ask.branch,
      commit: printed.commit,
      uncommitted: printed.commit !== printed.head,
    } as const;
  });

/**
 * The source's work copied to the branch asked for, as above, within the
 * bound; a sandbox gone, a call that failed, or the bound passed is a miss,
 * logged, and never the caller's failure.
 */
export const snapshotSource = /* @__PURE__ */ Effect.fn("web/snapshotSource")(function* <R>(
  ask: SnapshotAsk<R>,
): Effect.fn.Return<SnapshotOutcome, never, R | DatabaseServices | Sandbox> {
  const outcome = yield* copyIn(ask).pipe(
    Effect.timeoutOption(SNAPSHOT.TIMEOUT),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the source's work was not copied: ${String(failure)}`),
        Option.some<SnapshotOutcome>({ copied: false, miss: SNAPSHOT_MISS.FAILED }),
      ),
    ),
  );
  if (Option.isSome(outcome)) return outcome.value;
  yield* Effect.logWarning("the source's work was not copied in time");
  return { copied: false, miss: SNAPSHOT_MISS.TIMED_OUT };
});

/** How the new agent takes the source's work up, which its branch and the snapshot's commit say. */
const TAKEN_UP = { CONTINUED: "continued", FORKED: "forked" } as const;

/**
 * The branch the copy is pushed to: the source's own, or one named for the
 * source where it recorded none, then how the new agent takes it up and a
 * short name for this one Start, read from its key so a retry names the
 * same branch.
 */
function snapshotBranch(source: Agent, forked: boolean, idempotencyKey: string): string {
  const base = source.branch ?? `${CODER.BRANCH_PREFIX}agent-${source.id.slice(0, 8)}`;
  const start = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 8);
  return `${base}-${forked ? TAKEN_UP.FORKED : TAKEN_UP.CONTINUED}-${start}`;
}

/** What a copy of a source's work reaches: the store, GitHub through the App, and the sandboxes. */
export type SourceCopyServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | Sandbox;

/**
 * The source agent's work copied for an agent the account starts from it,
 * as above, under the Start's key; nothing copied for a retry whose Start
 * already made its agent, which is handed nothing new, or for a source that
 * never opened a sandbox. The token the push goes through is the one a
 * coding agent's checkout is minted, through the installation of the
 * source's workspace as the account reaches it. `repository` is the one the
 * new agent clones: its task's as it stands now; none where the task names none.
 */
export const copySourceWork = /* @__PURE__ */ Effect.fn("web/copySourceWork")(function* (
  userId: string,
  source: Agent,
  repository: string | null,
  forked: boolean,
  idempotencyKey: string,
): Effect.fn.Return<SnapshotOutcome, never, SourceCopyServices> {
  const missed = (miss: SnapshotMiss): SnapshotOutcome => ({ copied: false, miss });
  return yield* Effect.gen(function* () {
    if (Option.isSome(yield* readAgentByKey(userId, idempotencyKey))) {
      return missed(SNAPSHOT_MISS.STARTED);
    }
    // Note that the new agent clones the task's repository as it stands now, so a branch pushed to the
    // one the source cloned before the task moved would be none of its checkout's.
    // A source with no repository has no branch any checkout would hold.
    if (!hasRepository(source) || repository?.toLowerCase() !== source.repository.toLowerCase()) {
      return missed(SNAPSHOT_MISS.MOVED);
    }
    const [session] = yield* standingSessionsOf(source.userId, [source.conversationId]);
    if (session === undefined) return missed(SNAPSHOT_MISS.NO_SANDBOX);
    const target = { userId, conversationId: source.conversationId };
    return yield* snapshotSource({
      userId: source.userId,
      sessionId: session.sessionId,
      branch: snapshotBranch(source, forked, idempotencyKey),
      message: `Snapshot of ${source.title ?? source.model} for ${forked ? TAKEN_UP.FORKED : TAKEN_UP.CONTINUED} agent`,
      credential: agentRepositoryToken(target, source),
    });
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the source's work was not copied: ${String(failure)}`),
        missed(SNAPSHOT_MISS.FAILED),
      ),
    ),
  );
});
