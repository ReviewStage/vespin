/**
 * checkout-restore.test.ts -- the checkout put back to a snapshot by git itself, in a repository of the test's own.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import {
  CHECKOUT_RESTORE_EXIT,
  CHECKOUT_RESTORE_SCRIPT,
  checkoutRestoreEnv,
} from "./checkout-restore.js";

const GIT_ENV = {
  ...(process.env.PATH === undefined ? undefined : { PATH: process.env.PATH }),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

const made: string[] = [];

afterEach(() => {
  for (const cwd of made.splice(0)) rmSync(cwd, { recursive: true });
});

/** A git command run in the repository, its output trimmed. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
}

/** The restore run in the repository for the snapshot given; answers how it exited. */
function restore(cwd: string, snapshot: Parameters<typeof checkoutRestoreEnv>[0]): number {
  const ran = spawnSync("sh", ["-c", CHECKOUT_RESTORE_SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...GIT_ENV, ...checkoutRestoreEnv(snapshot) },
  });
  return ran.status ?? -1;
}

/** What `git status` says, one line a path, as it spells them. */
function status(cwd: string): string[] {
  return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", env: GIT_ENV })
    .split("\n")
    .filter((line) => line !== "")
    .sort();
}

/** The file's words, or none where it does not stand. */
function words(cwd: string, path: string): string | undefined {
  return existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), "utf8") : undefined;
}

/**
 * A repository as an agent's turn left it: `main` at a first commit, a
 * snapshot taken on top of it with an edit and a new file, as the runner
 * takes one, and then a later commit on `main`, uncommitted work, and
 * another branch checked out. Answers the snapshot as the turn's row keeps it.
 */
function repositoryAfterATurn() {
  const cwd = mkdtempSync(join(tmpdir(), "checkout-restore-"));
  made.push(cwd);
  git(cwd, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(cwd, "kept.txt"), "as committed\n");
  writeFileSync(join(cwd, "extra.txt"), "kept\n");
  writeFileSync(join(cwd, ".gitignore"), "out/\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "first");
  const head = git(cwd, "rev-parse", "HEAD");
  // The snapshot: the working tree as it stood before the turn, committed on HEAD without moving it.
  writeFileSync(join(cwd, "kept.txt"), "as edited before the turn\n");
  writeFileSync(join(cwd, "made.txt"), "by a shell command\n");
  git(cwd, "add", "-A");
  const tree = git(cwd, "write-tree");
  const commit = git(cwd, "commit-tree", tree, "-p", head, "-m", "The checkout before a turn");
  git(cwd, "reset", "-q");
  // The turn's work: a commit on main, work left uncommitted, an ignored build, and a switch of branch.
  writeFileSync(join(cwd, "kept.txt"), "as the turn committed\n");
  rmSync(join(cwd, "extra.txt"));
  writeFileSync(join(cwd, "later.txt"), "added by the turn\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "the turn's work");
  const later = git(cwd, "rev-parse", "HEAD");
  writeFileSync(join(cwd, "made.txt"), "rewritten after the commit\n");
  mkdirSync(join(cwd, "out"));
  writeFileSync(join(cwd, "out", "built.txt"), "ignored\n");
  git(cwd, "checkout", "--quiet", "-b", "experiment");
  return { cwd, head, later, snapshot: { commit, head, branch: "main" } };
}

test("puts the working tree and the checked-out branch back to the snapshot, leaving every commit where it is and ignored files alone", () => {
  const { cwd, later, snapshot } = repositoryAfterATurn();

  assert.equal(restore(cwd, snapshot), 0);

  assert.equal(git(cwd, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(cwd, "rev-parse", "main"), later, "the turn's commit stays on main");
  assert.equal(git(cwd, "rev-parse", "experiment"), later, "the other branch stands too");
  assert.deepEqual(
    {
      kept: words(cwd, "kept.txt"),
      extra: words(cwd, "extra.txt"),
      made: words(cwd, "made.txt"),
      later: words(cwd, "later.txt"),
      built: words(cwd, "out/built.txt"),
    },
    {
      kept: "as edited before the turn\n",
      extra: "kept\n",
      made: "by a shell command\n",
      later: undefined,
      built: "ignored\n",
    },
  );
  assert.equal(git(cwd, "diff", "--cached", "--name-only"), "", "nothing stands staged");
  // Note that `made.txt` says nothing: the turn committed it as the snapshot held it, and the restore put its rewrite back.
  assert.deepEqual(status(cwd), [" D later.txt", " M kept.txt", "?? extra.txt"]);
});

test("makes a branch the agent deleted again at its old commit, and restores nothing where the snapshot is gone", () => {
  const { cwd, head, later, snapshot } = repositoryAfterATurn();
  git(cwd, "branch", "-D", "main");

  assert.equal(restore(cwd, snapshot), 0);
  assert.equal(git(cwd, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(cwd, "rev-parse", "main"), head);
  assert.equal(git(cwd, "rev-parse", "experiment"), later);

  const before = status(cwd);
  assert.equal(
    restore(cwd, { ...snapshot, commit: "0123456789abcdef0123456789abcdef01234567" }),
    CHECKOUT_RESTORE_EXIT.MISSING,
  );
  assert.deepEqual(status(cwd), before, "nothing was touched");
});

test("puts the branch back on a worktree an archive's rebuild left detached at the snapshot's parent, its files restored", () => {
  const { cwd, later, snapshot } = repositoryAfterATurn();
  // The rebuild: the worktree made again at the commit the archive's snapshot was taken on, HEAD detached there, and the files as the archive kept them.
  git(cwd, "checkout", "--quiet", "--detach", later);
  writeFileSync(join(cwd, "kept.txt"), "as the archive kept it\n");

  assert.equal(restore(cwd, snapshot), 0);

  assert.equal(git(cwd, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(cwd, "rev-parse", "main"), later, "the turn's commit stays on main");
  assert.equal(words(cwd, "kept.txt"), "as edited before the turn\n");
  assert.equal(words(cwd, "later.txt"), undefined);
});

test("sweeps what a .gitignore the turn wrote was hiding, and leaves what the snapshot's own rules ignore", () => {
  const { cwd, snapshot } = repositoryAfterATurn();
  // The turn adds an ignore rule and fills the folder it hides; the build the snapshot's rules ignore stands from before.
  writeFileSync(join(cwd, ".gitignore"), "out/\ndist/\n");
  mkdirSync(join(cwd, "dist"));
  writeFileSync(join(cwd, "dist", "bundle.js"), "built by the turn\n");

  assert.equal(restore(cwd, snapshot), 0);

  assert.equal(words(cwd, "dist/bundle.js"), undefined, "what the turn's rule hid is gone");
  assert.equal(words(cwd, "out/built.txt"), "ignored\n", "what the snapshot's rule ignores stays");
  assert.equal(words(cwd, ".gitignore"), "out/\n");
});
