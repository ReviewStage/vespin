/**
 * base-snapshot.ts -- a workspace's repository cloned once with its dependencies installed and snapshotted, which each new agent's sandbox is created from instead of cloning.
 *
 * A sandbox from the agents' image clones the default branch and installs,
 * then is snapshotted, and every sandbox created from that snapshot starts
 * with both, skipping the install. A base snapshot is that, one per
 * workspace and repository, built by `@repo/sandbox`'s `buildSnapshot` and
 * recorded by the sandbox that took it: named for the workspace and the
 * repository (`baseSnapshotName`), left stopped on it, its `snapshotId` the
 * base snapshot. Its checkout stands as an agent's stands in its workspace
 * (`repository-shell.ts`'s `cloneRepository`), cloned through the token at
 * the firewall for the clone alone, so the snapshot holds no credential.
 *
 * The sandbox carries a key once its fill ended well (`BASE_TAG.KEY`): a
 * digest of the image it was made on, without its runner, and the default
 * branch it holds, so a new image, whose tools the snapshot would otherwise
 * freeze, or a moved default branch reads as a base to fill again, and none
 * is ever created from on an image or branch it was not made of. Note that
 * the runner is left out of the key, because it changes with nearly every
 * deploy and each launch writes the deploy's own over the one the snapshot
 * holds (`machine/sandbox-machine.ts`), so a runner's change alone leaves
 * every base standing. The key goes up before the snapshot is taken, so a
 * snapshot of a half-made checkout is never one a launch reads.
 *
 * Nothing refreshes it on a timer. A launch fills it past its answer where
 * it is missing or out of date, and fills it again where the snapshot it
 * named was gone, since it lapses `LAPSE` after its last use and each
 * sandbox created from it is a use, or where the agent's fast-forward from
 * it moved a lockfile (`lockfileMoved`), which a fresh install would no
 * longer match. The sandbox's name is the lock: of fills that find none at
 * once, one creates it and the rest find the name taken, and a fill
 * replaces a standing base only where it is still the one read
 * (`deletedIfStill`). A fill that failed deletes its own sandbox, so agents
 * clone as they would without one until the next fill.
 */

import { createHash } from "node:crypto";
import {
  buildSnapshot,
  deletedIfStill,
  type ListedSandbox,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxRunning,
  UP_STATUSES,
} from "@repo/sandbox";
import { Clock, Duration, Effect, type Redacted } from "effect";
import type { GitHubTokenAccess } from "../github/github-app.js";
import { CODER } from "./coder-host/bounds.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  cloneRepository,
  GROUP_WRITES,
  REPOSITORY_REFUSAL,
  RepositoryRefusal,
  type RepositorySandbox,
  runInSandbox,
  snapshotRecordOf,
} from "./repository-shell.js";

export const BASE_SNAPSHOT = {
  /** Every base snapshot's sandbox is named with this, its digest after it. */
  NAME_PREFIX: "agent-base-",
  /** How long a fill's sandbox may run before it is taken for one left behind: past any fill's clone and install. */
  FILL_GRACE: Duration.minutes(15),
  /** How long after its last use a base snapshot is kept; each sandbox created from it is a use. */
  LAPSE: Duration.days(30),
} as const;

/** The tag a base's sandbox carries once its fill ended well: the key of what it was made of (`baseKey`). */
const BASE_TAG = { KEY: "agentBaseKey" } as const;

/** How much of the end of a failed install's error output the log is told. */
const INSTALL_ERROR_TAIL_CHARS = 500;

/** The lockfiles whose change on the default branch makes the base's install stale. */
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json"] as const;

/** The variable the lockfile diff reads the base's commit from, so no commit is written into a command. */
const BASE_COMMIT_VARIABLE = "APP_BASE_COMMIT";

/** The lockfile diff's exit where the lockfiles differ, as `git diff --quiet` exits. */
const DIFFERS_EXIT = 1;

/**
 * The dependencies installed in the checkout: with pnpm where its lockfile
 * is pnpm's, with npm where it has a `package.json` and no such lockfile,
 * and nothing in a repository that has neither, which has none to install;
 * written group-writable, as the clone is (`GROUP_WRITES`).
 */
const INSTALL_SCRIPT = [
  "set -e",
  GROUP_WRITES,
  "if [ -f pnpm-lock.yaml ]; then pnpm install; elif [ -f package.json ]; then npm install; fi",
].join("\n");

/** Whether the lockfiles differ between the base's commit and the checkout's HEAD: exits `DIFFERS_EXIT` where they do. */
const LOCKFILE_DIFF_SCRIPT = `git diff --quiet "$${BASE_COMMIT_VARIABLE}" HEAD -- ${LOCKFILES.join(" ")}`;

/** What a fill clones through: a read token for the one repository, and whose it is. */
interface BaseSnapshotCredential {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/** The image a base is made on: its reference, and a digest of it without the runner (`AgentImage`'s `base`). */
export interface BaseImage {
  readonly reference: string;
  readonly base: string;
}

/** What a base snapshot is of: the workspace, and the repository and branch it holds. */
export interface BaseSnapshotOf {
  readonly workspaceId: string;
  /** The repository as GitHub spells it. */
  readonly fullName: string;
  readonly defaultBranch: string;
}

/** Where a base stands for a launch: ready to create from, being filled, or wanted, with the sandbox in a fill's way. */
export const BASE_STATE = { READY: "ready", FILLING: "filling", WANTED: "wanted" } as const;

/**
 * Why a base is wanted, as its spans name it: none stands, the one standing
 * was keyed for another image or branch, a fill left it unfinished past its
 * grace, or a launch found its snapshot lapsed or moved a lockfile past it.
 */
export const BASE_WANTED = {
  MISSING: "missing",
  STALE_KEY: "stale_key",
  UNFINISHED: "unfinished",
  LAPSED: "lapsed",
  LOCKFILE_MOVED: "lockfile_moved",
} as const;

type BaseWanted = (typeof BASE_WANTED)[keyof typeof BASE_WANTED];

export type BaseSnapshotRead =
  | { readonly state: typeof BASE_STATE.READY; readonly snapshotId: string }
  | { readonly state: typeof BASE_STATE.FILLING }
  | {
      readonly state: typeof BASE_STATE.WANTED;
      readonly reason: BaseWanted;
      readonly stale?: ListedSandbox;
    };

/** A ready base a launch found unusable, to fill again in its place, and why. */
export interface BaseReplacing {
  readonly snapshotId: string;
  readonly reason: typeof BASE_WANTED.LAPSED | typeof BASE_WANTED.LOCKFILE_MOVED;
}

/** A digest of the fields given, each ended by a NUL so none runs into the next. */
function digestOf(fields: readonly string[]): string {
  const digest = createHash("sha256");
  for (const field of fields) digest.update(field).update("\0");
  return digest.digest("hex").slice(0, 32);
}

/** The base's sandbox's name: the prefix and a digest of the workspace and the repository. */
export function baseSnapshotName(of: BaseSnapshotOf): string {
  return `${BASE_SNAPSHOT.NAME_PREFIX}${digestOf([of.workspaceId, snapshotRecordOf(of.fullName)])}`;
}

/** The key a base made on the image given, without its runner, of the default branch the base names, carries. */
function baseKey(of: BaseSnapshotOf, imageBase: string): string {
  return digestOf([imageBase, of.defaultBranch]);
}

/** Whether a sandbox is a fill still within its grace: up, and created less than `FILL_GRACE` ago. */
function stillFilling(found: ListedSandbox, now: number): boolean {
  const up = UP_STATUSES.has(found.status) || found.status === SANDBOX_STATUS.STOPPING;
  return (
    up &&
    found.createdAt !== undefined &&
    now - found.createdAt < Duration.toMillis(BASE_SNAPSHOT.FILL_GRACE)
  );
}

/** The sandbox found under the base's name as a launch reads it, against the key it should carry. */
function readOf(found: ListedSandbox | undefined, key: string, now: number): BaseSnapshotRead {
  if (found === undefined) return { state: BASE_STATE.WANTED, reason: BASE_WANTED.MISSING };
  const keyed = found.tags?.[BASE_TAG.KEY] === key;
  if (keyed && found.status === SANDBOX_STATUS.STOPPED && found.snapshotId !== undefined) {
    return { state: BASE_STATE.READY, snapshotId: found.snapshotId };
  }
  if (stillFilling(found, now)) return { state: BASE_STATE.FILLING };
  const reason = keyed ? BASE_WANTED.UNFINISHED : BASE_WANTED.STALE_KEY;
  return { state: BASE_STATE.WANTED, reason, stale: found };
}

/** What a base's span says of it: where it stands, and why it is wanted where it is. */
function baseSpanAttributes(state: BaseSnapshotRead["state"], reason: BaseWanted | undefined) {
  return { "base.state": state, ...(reason === undefined ? undefined : { "base.reason": reason }) };
}

/** The base snapshot as it stands for a launch on the image given, by its digest without the runner, which its span records. */
export const readBaseSnapshot = (of: BaseSnapshotOf, imageBase: string) =>
  Effect.all([
    Effect.flatMap(Sandbox, (sandbox) => sandbox.get(baseSnapshotName(of))),
    Clock.currentTimeMillis,
  ]).pipe(
    Effect.map(([found, now]) => readOf(found, baseKey(of, imageBase), now)),
    Effect.tap((read) =>
      Effect.annotateCurrentSpan(
        baseSpanAttributes(read.state, read.state === BASE_STATE.WANTED ? read.reason : undefined),
      ),
    ),
    Effect.withSpan("web/readBaseSnapshot"),
  );

/** The dependencies installed in the checkout the sandbox holds, or the refusal in the installer's own words. */
const installDependencies = Effect.fn("web/installCheckoutDependencies")(function* (
  sandbox: RepositorySandbox,
) {
  const installed = yield* runInSandbox(
    sandbox,
    { command: INSTALL_SCRIPT, workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
  if (installed.exitCode !== 0) {
    return yield* new RepositoryRefusal({
      reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED,
      detail: installed.stderr.trim().slice(-INSTALL_ERROR_TAIL_CHARS),
    });
  }
});

/** The commit the checkout stands at; none where git could not say, as for a sandbox that holds no checkout. */
export const checkoutCommit = (sandbox: RepositorySandbox) =>
  Effect.map(
    runInSandbox(
      sandbox,
      {
        command: "git rev-parse HEAD",
        workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
      },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ),
    (ran) => (ran.exitCode === 0 ? ran.stdout.trim() : undefined),
  );

/**
 * Whether the checkout's lockfiles moved since the base's commit given, as
 * a fast-forward from a base snapshot finds them: the base's install no
 * longer matches the default branch, so the base is filled again. A diff git
 * could not make reads as no move.
 */
export const lockfileMoved = (sandbox: RepositorySandbox, since: string) =>
  Effect.map(
    runInSandbox(
      sandbox,
      {
        command: LOCKFILE_DIFF_SCRIPT,
        workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
        env: { [BASE_COMMIT_VARIABLE]: since },
      },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ),
    (ran) => ran.exitCode === DIFFERS_EXIT,
  );

/**
 * The workspace's repository's base snapshot filled, where a launch on the
 * image given wants one: whatever stale sandbox stands under the name
 * deleted where it is still the one read, then the snapshot built
 * (`buildSnapshot`) from the image under the name: the default branch
 * cloned whole into it through the token at the firewall for the clone
 * alone, its dependencies installed, and the key tagged before the snapshot
 * is taken. A base that reads ready is filled again only where its snapshot
 * is the one `replacing` names: gone under a launch, or with a lockfile its
 * agent's fast-forward moved. Its span records where the base stood and why
 * it was filled. A name another launch took first is that launch's fill,
 * and this one does nothing. `open` is the sandbox as the clone reaches it,
 * over the caller's runner.
 */
export const fillBaseSnapshot = Effect.fn("web/fillBaseSnapshot")(function* (
  of: BaseSnapshotOf,
  image: BaseImage,
  credential: BaseSnapshotCredential,
  open: (sandbox: SandboxRunning) => RepositorySandbox,
  replacing?: BaseReplacing,
) {
  const sandboxes = yield* Sandbox;
  const name = baseSnapshotName(of);
  const key = baseKey(of, image.base);
  const found = yield* sandboxes.get(name);
  const read = readOf(found, key, yield* Clock.currentTimeMillis);
  const replaced = read.state === BASE_STATE.READY && read.snapshotId === replacing?.snapshotId;
  yield* Effect.annotateCurrentSpan(
    baseSpanAttributes(
      read.state,
      replaced ? replacing.reason : read.state === BASE_STATE.WANTED ? read.reason : undefined,
    ),
  );
  const stale = replaced ? found : read.state === BASE_STATE.WANTED ? read.stale : undefined;
  if (read.state !== BASE_STATE.WANTED && stale === undefined) return;
  if (stale !== undefined && !(yield* deletedIfStill(stale))) return;
  const built = yield* buildSnapshot(
    { name, image: image.reference, vcpus: CODER.SANDBOX_VCPUS, lapse: BASE_SNAPSHOT.LAPSE },
    (running) =>
      Effect.gen(function* () {
        const sandbox = open(running);
        yield* cloneRepository(
          sandbox,
          {
            fullName: of.fullName,
            defaultBranch: of.defaultBranch,
            recordedAs: snapshotRecordOf(of.fullName),
          },
          credential.token,
          { access: credential.access },
        );
        yield* installDependencies(sandbox);
        // The key goes up before the snapshot, so the snapshot it leaves is known for a whole checkout.
        yield* sandboxes.updateTags(name, { [BASE_TAG.KEY]: key });
      }),
  );
  if (built._tag === "Some") yield* Effect.logInfo(`the base snapshot ${name} is filled`);
});
