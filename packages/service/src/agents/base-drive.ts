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
 * Every hour the scheduled refresh (`base-drive-refresh.ts`) fills one for
 * each repository a workspace's installation grants that has none, so a
 * repository's first agent forks it rather than cloning, and once a day it
 * refills every base drive that stands, so each agent's own fetch stays
 * small, installing again only where that fetch moved a lockfile. A launch
 * fills it too, past its answer, where its fork found none, where a fill
 * left it unfinished past its grace, or where the agent's fast-forward from
 * it moved a lockfile (`lockfileMoved`), which its install would no longer
 * match; a refill mounts the drive as it stands, fetches the default branch
 * over its checkout, and installs again. An agent's delete deletes only the fork it
 * owns, which Vercel keeps apart from the base it was forked from; a base
 * drive is deleted with its workspace (`workspace-deletion.ts`), the fill's
 * sandbox under its name with it (`deletedBaseDrive`).
 */

import { createHash } from "node:crypto";
import { SANDBOX_SIZE } from "@repo/features/sandbox-size";
import {
  deletedFilledDrive,
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
  /** Where every drive an agent's sandbox opens with is mounted: the folder its checkout and the checkout's record stand in. */
  MOUNT: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
} as const;

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
 * written group-writable, as the clone is (`GROUP_WRITES`). Note that it is
 * the default user's, pnpm's store at the drive's root among it, which each
 * agent's launch hands to its `agent` user (`machine/sandbox-machine.ts`'s
 * readying), because an install chmods what it installed and only a file's
 * owner may.
 */
const INSTALL_SCRIPT = [
  "set -e",
  GROUP_WRITES,
  "if [ -f pnpm-lock.yaml ]; then pnpm install; elif [ -f package.json ]; then npm install; fi",
].join("\n");

/** Whether the lockfiles differ between the base's commit and the checkout's HEAD: exits `DIFFERS_EXIT` where they do. */
const LOCKFILE_DIFF_SCRIPT = `git diff --quiet "$${BASE_COMMIT_VARIABLE}" HEAD -- ${LOCKFILES.join(" ")}`;

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
 * fill left it unfinished, a launch's fast-forward moved a lockfile past
 * it, or the day's scheduled refresh came round.
 */
export const BASE_WANTED = {
  MISSING: "missing",
  UNFINISHED: "unfinished",
  LOCKFILE_MOVED: "lockfile_moved",
  SCHEDULED: "scheduled",
} as const;

type BaseWanted = (typeof BASE_WANTED)[keyof typeof BASE_WANTED];

/** Why a base found free to fork is filled: a launch's fork found none, its fast-forward moved a lockfile, or the scheduled refresh asks it. */
export type BaseRefill =
  | typeof BASE_WANTED.MISSING
  | typeof BASE_WANTED.LOCKFILE_MOVED
  | typeof BASE_WANTED.SCHEDULED;

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
export function baseDriveName(of: Pick<BaseDriveOf, "workspaceId" | "fullName">): string {
  return `${BASE_DRIVE.NAME_PREFIX}${digestOf([of.workspaceId, snapshotRecordOf(of.fullName)])}`;
}

/** The base drive of that name deleted for good, a fill still running under its name stopped and deleted first (`deletedFilledDrive`). */
export const deletedBaseDrive = (name: string) => deletedFilledDrive({ name, drive: name });

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
export const readBaseDrive = (of: Pick<BaseDriveOf, "workspaceId" | "fullName">) =>
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
 * Whether the checkout's lockfiles moved since the base's commit given, as
 * a fast-forward from a base drive's fork finds them: the base's install no
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
 * Whether the checkout's lockfiles stand as they stood at the commit given,
 * so an install made there still matches; a diff git could not make reads
 * as a move.
 */
const lockfilesUnmoved = (sandbox: RepositorySandbox, since: string) =>
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
    (ran) => ran.exitCode === 0,
  );

/**
 * The workspace's repository's base drive filled, where a launch wants it:
 * a fill's sandbox left under the name deleted where it is still the one
 * read, then the drive filled (`filledDrive`) from the image given: the
 * checkout it holds brought up to the default branch, or the default branch
 * cloned whole onto it where it holds none, through the token at the
 * firewall alone, then its dependencies installed, but for a scheduled
 * refill whose fetch left the lockfiles as they stood, whose install still
 * matches. A base free to fork is filled only where the caller names why
 * (`refill`): a launch's fork found none, its fast-forward moved a
 * lockfile, or the scheduled refresh asks it. Its span records where the
 * base stood and why it was filled. A name another fill took first is that
 * fill's, and this one does nothing. `open` is the sandbox as the clone
 * reaches it, over the caller's runner.
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
      vcpus: SANDBOX_SIZE.VCPUS,
    },
    (running) =>
      Effect.gen(function* () {
        const sandbox = open(running);
        const before =
          reason === BASE_WANTED.SCHEDULED
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
        // Note that a lockfile diff that failed reads as moved, since an install too many costs only time.
        const stillMatches =
          !cloned &&
          before !== undefined &&
          (yield* Effect.orElseSucceed(lockfilesUnmoved(sandbox, before), () => false));
        if (!stillMatches) yield* installDependencies(sandbox);
      }),
  );
  if (filled) yield* Effect.logInfo(`the base drive ${name} is filled`);
});
