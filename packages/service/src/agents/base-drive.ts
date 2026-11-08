/**
 * base-drive.ts -- a workspace's repository cloned once with its dependencies installed on a drive, which each new agent's sandbox forks a drive of its own from instead of cloning.
 *
 * Every agent's sandbox boots from the agents' image, which carries the
 * tools and the runner; its checkout stands on a drive mounted at the
 * workspace folder that holds it (`REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE`).
 * A base drive is one per workspace and repository, holding the default
 * branch's checkout with its dependencies installed, and a new agent's
 * sandbox opens with its own fork of it (`@repo/sandbox`'s `SandboxDrive`),
 * so it starts with both, skipping the clone and most of the install. Its
 * checkout stands as an agent's stands in its workspace
 * (`repository-shell.ts`'s `cloneRepository`), cloned through the token at
 * the firewall for the clone alone, so the drive holds no credential.
 *
 * A base drive is filled by `@repo/sandbox`'s `filledDrive`, in a sandbox
 * named as the drive is (`baseDriveName`), which is the fill's lock: of
 * fills that find none at once, one creates it and the rest find the name
 * taken. A fill that ended well deletes its sandbox, so a base drive with no
 * sandbox under its name is whole, and one with a sandbox under it is being
 * filled, or was left unfinished by a fill that failed or was cut off, which
 * no agent forks. Nothing keys it to the image or the branch: the tools are
 * the image's at every boot, and each agent fetches the default branch and
 * installs on its own fork (`refreshAgentCheckout`). Note that the name is
 * apart from the base snapshots' (`agent-base-`) that came before, which are
 * left as they stand for any open still reading them.
 *
 * Nothing refills it on a timer. A launch fills it past its answer where its
 * fork found none, where a fill left it unfinished past its grace, or where
 * the agent's fast-forward from it (`baseRefillPast`) moved a lockfile, which
 * its install would no longer match, or found it lacking a commit that landed
 * on the default branch more than `STALE_AFTER` ago, so each agent's own
 * fetch stays small; a refill mounts the drive as it stands, fetches the
 * default branch over its checkout, and installs again, but for a stale one
 * whose fetch moved no lockfile. An agent's launch never forks a drive a
 * refill holds, which reads filling. Nothing deletes a base drive: an agent's
 * delete deletes only the fork it owns.
 */

import { createHash } from "node:crypto";
import {
  deletedIfStill,
  filledDrive,
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
  refreshRepository,
  runInSandbox,
  snapshotRecordOf,
} from "./repository-shell.js";

export const BASE_DRIVE = {
  /** Every base drive, and the sandbox that fills it, is named with this, its digest after it. */
  NAME_PREFIX: "agent-base-drive-",
  /** How long a fill's sandbox may run before it is taken for one left behind: past any fill's clone and install. */
  FILL_GRACE: Duration.minutes(15),
  /** How long a commit may stand on the default branch with the base lacking it before a launch has the base refilled: an hour, so an agent's own fetch is never of much. */
  STALE_AFTER: Duration.hours(1),
  /** Where every drive an agent's sandbox opens with is mounted: the folder its checkout and the checkout's record stand in. */
  MOUNT: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
} as const;

/** How much of the end of a failed install's error output the log is told. */
const INSTALL_ERROR_TAIL_CHARS = 500;

/** The lockfiles whose change on the default branch makes the base's install stale. */
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json"] as const;

/** The variable the read past the base reads the base's commit from, so no commit is written into a command. */
const BASE_COMMIT_VARIABLE = "APP_BASE_COMMIT";

/** The read past the base's exit where the lockfiles differ, as `git diff --quiet` exits. */
const DIFFERS_EXIT = 1;

/** How many milliseconds a second of a commit's time holds. */
const MILLIS_PER_SECOND = 1000;

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

/**
 * What the checkout's HEAD holds past the base's commit: on stdout, the
 * commit time, in seconds, of the first commit the default branch took past
 * the base, nothing where it took none; and exits `DIFFERS_EXIT` where the
 * lockfiles differ between the two. Note that it walks first parents alone,
 * because a merge's second parent may carry commits made long before it
 * landed.
 */
const PAST_BASE_SCRIPT = [
  `git log --first-parent --format=%ct "$${BASE_COMMIT_VARIABLE}..HEAD" | tail -n 1`,
  `git diff --quiet "$${BASE_COMMIT_VARIABLE}" HEAD -- ${LOCKFILES.join(" ")}`,
].join("\n");

/** What a fill clones through: a read token for the one repository, and whose it is. */
interface BaseDriveCredential {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/** What a base drive is of: the workspace, and the repository and branch it holds. */
export interface BaseDriveOf {
  readonly workspaceId: string;
  /** The repository as GitHub spells it. */
  readonly fullName: string;
  readonly defaultBranch: string;
}

/** Where a base stands for a launch: free to fork, being filled, or wanted, with the sandbox in a fill's way. */
export const BASE_STATE = { READY: "ready", FILLING: "filling", WANTED: "wanted" } as const;

/**
 * Why a base is wanted, as its spans name it: a launch's fork found none, a
 * fill left it unfinished, or a launch's fast-forward moved a lockfile past
 * it or found it stale.
 */
export const BASE_WANTED = {
  MISSING: "missing",
  UNFINISHED: "unfinished",
  LOCKFILE_MOVED: "lockfile_moved",
  STALE: "stale",
} as const;

type BaseWanted = (typeof BASE_WANTED)[keyof typeof BASE_WANTED];

/** Why a launch's fast-forward from a base's fork asks the base filled again: it moved a lockfile, or the base was stale. */
export type BasePassed = typeof BASE_WANTED.LOCKFILE_MOVED | typeof BASE_WANTED.STALE;

/** Why a launch asks a base it found free to fork filled: its fork found none, or its fast-forward passed it. */
export type BaseRefill = typeof BASE_WANTED.MISSING | BasePassed;

export type BaseDriveRead =
  | { readonly state: typeof BASE_STATE.READY }
  | { readonly state: typeof BASE_STATE.FILLING }
  | {
      readonly state: typeof BASE_STATE.WANTED;
      readonly reason: typeof BASE_WANTED.UNFINISHED;
      readonly stale: ListedSandbox;
    };

/** A digest of the fields given, each ended by a NUL so none runs into the next. */
function digestOf(fields: readonly string[]): string {
  const digest = createHash("sha256");
  for (const field of fields) digest.update(field).update("\0");
  return digest.digest("hex").slice(0, 32);
}

/** The base drive's name, and its fill's sandbox's: the prefix and a digest of the workspace and the repository. */
export function baseDriveName(of: BaseDriveOf): string {
  return `${BASE_DRIVE.NAME_PREFIX}${digestOf([of.workspaceId, snapshotRecordOf(of.fullName)])}`;
}

/** Whether a sandbox is a fill still within its grace: up, and created less than `FILL_GRACE` ago. */
function stillFilling(found: ListedSandbox, now: number): boolean {
  const up = UP_STATUSES.has(found.status) || found.status === SANDBOX_STATUS.STOPPING;
  return (
    up &&
    found.createdAt !== undefined &&
    now - found.createdAt < Duration.toMillis(BASE_DRIVE.FILL_GRACE)
  );
}

/** The fill's sandbox found under the base's name as a launch reads it: none, so the drive is free to fork; one filling; or one a fill left. */
function readOf(found: ListedSandbox | undefined, now: number): BaseDriveRead {
  if (found === undefined) return { state: BASE_STATE.READY };
  if (stillFilling(found, now)) return { state: BASE_STATE.FILLING };
  return { state: BASE_STATE.WANTED, reason: BASE_WANTED.UNFINISHED, stale: found };
}

/** What a base's span says of it: where it stands, and why it is wanted where it is. */
function baseSpanAttributes(state: BaseDriveRead["state"], reason: BaseWanted | undefined) {
  return { "base.state": state, ...(reason === undefined ? undefined : { "base.reason": reason }) };
}

/** The base drive as it stands for a launch, which its span records. */
export const readBaseDrive = (of: BaseDriveOf) =>
  Effect.all([
    Effect.flatMap(Sandbox, (sandbox) => sandbox.get(baseDriveName(of))),
    Clock.currentTimeMillis,
  ]).pipe(
    Effect.map(([found, now]) => readOf(found, now)),
    Effect.tap((read) =>
      Effect.annotateCurrentSpan(
        baseSpanAttributes(read.state, read.state === BASE_STATE.WANTED ? read.reason : undefined),
      ),
    ),
    Effect.withSpan("web/readBaseDrive"),
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
 * Why the base the checkout was at the commit given of is to be filled
 * again, as the checkout's fast-forward to the default branch finds it: the
 * lockfiles moved, so the base's install no longer matches; or the first
 * commit the default branch took past the base landed more than
 * `STALE_AFTER` ago, so the base is stale; none where neither. A read git
 * could not make reads as neither.
 */
export const baseRefillPast = (sandbox: RepositorySandbox, since: string) =>
  Effect.gen(function* () {
    const ran = yield* runInSandbox(
      sandbox,
      {
        command: PAST_BASE_SCRIPT,
        workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
        env: { [BASE_COMMIT_VARIABLE]: since },
      },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    );
    if (ran.exitCode === DIFFERS_EXIT) return BASE_WANTED.LOCKFILE_MOVED;
    const landed = Number.parseInt(ran.stdout.trim(), 10) * MILLIS_PER_SECOND;
    const now = yield* Clock.currentTimeMillis;
    // Note that no commit past the base reads as a landing at NaN, which is never stale.
    return now - landed > Duration.toMillis(BASE_DRIVE.STALE_AFTER) ? BASE_WANTED.STALE : undefined;
  });

/**
 * The workspace's repository's base drive filled, where a launch wants it:
 * a fill's sandbox left under the name deleted where it is still the one
 * read, then the drive filled (`filledDrive`) from the image given: the
 * checkout it holds brought up to the default branch, or the default branch
 * cloned whole onto it where it holds none, through the token at the
 * firewall alone, then its dependencies installed, but for a stale base's
 * refill whose fast-forward moved no lockfile, whose install still matches.
 * A base free to fork is filled only where the launch names why (`refill`):
 * its fork found none, or its fast-forward moved a lockfile or found the
 * base stale. Its span records where the base stood and why it was filled.
 * A name another launch took first is that launch's fill, and this one does
 * nothing. `open` is the sandbox as the
 * clone reaches it, over the caller's runner.
 */
export const fillBaseDrive = Effect.fn("web/fillBaseDrive")(function* (
  of: BaseDriveOf,
  image: string,
  credential: BaseDriveCredential,
  open: (sandbox: SandboxRunning) => RepositorySandbox,
  refill?: BaseRefill,
) {
  const name = baseDriveName(of);
  const read = readOf(yield* (yield* Sandbox).get(name), yield* Clock.currentTimeMillis);
  const reason = read.state === BASE_STATE.WANTED ? read.reason : refill;
  yield* Effect.annotateCurrentSpan(baseSpanAttributes(read.state, reason));
  if (read.state === BASE_STATE.FILLING || reason === undefined) return;
  if (read.state === BASE_STATE.WANTED && !(yield* deletedIfStill(read.stale))) return;
  const repository = {
    fullName: of.fullName,
    defaultBranch: of.defaultBranch,
    recordedAs: snapshotRecordOf(of.fullName),
  };
  const filled = yield* filledDrive(
    {
      name,
      drive: name,
      at: BASE_DRIVE.MOUNT,
      image,
      vcpus: CODER.SANDBOX_VCPUS,
    },
    (running) =>
      Effect.gen(function* () {
        const sandbox = open(running);
        const before =
          reason === BASE_WANTED.STALE
            ? yield* Effect.orElseSucceed(checkoutCommit(sandbox), () => undefined)
            : undefined;
        // A drive that holds the checkout already is brought up to date, which refuses one that holds none.
        const cloned = yield* refreshRepository(
          sandbox,
          repository,
          credential.token,
          credential.access,
        ).pipe(
          Effect.as(false),
          Effect.catch(() =>
            cloneRepository(sandbox, repository, credential.token, {
              access: credential.access,
            }).pipe(Effect.as(true)),
          ),
        );
        // Note that a lockfile read that failed reads as moved, since an install too many costs only time.
        const stillMatches =
          !cloned &&
          before !== undefined &&
          (yield* Effect.orElseSucceed(
            baseRefillPast(sandbox, before),
            () => BASE_WANTED.LOCKFILE_MOVED,
          )) !== BASE_WANTED.LOCKFILE_MOVED;
        if (!stillMatches) yield* installDependencies(sandbox);
      }),
  );
  if (filled) yield* Effect.logInfo(`the base drive ${name} is filled`);
});
