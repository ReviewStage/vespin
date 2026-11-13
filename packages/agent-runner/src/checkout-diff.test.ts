/**
 * checkout-diff.test.ts -- the turn diff script run by git itself in a repository of the test's own: what upstream brought in left out, the turn's own commits kept, and its counts read into the turn's summary.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "vitest";
import {
  CHECKOUT_DIFF_FORMAT,
  CHECKOUT_DIFF_SCRIPT,
  type CheckoutDiffFormat,
  checkoutDiffEnv,
  turnFilesSummary,
} from "./checkout-diff.js";

const GIT_ENV = {
  ...(process.env.PATH === undefined ? undefined : { PATH: process.env.PATH }),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** Whoever commits upstream in these repositories: someone other than the checkout's own committer. */
const UPSTREAM_COMMITTER = {
  GIT_AUTHOR_NAME: "Teammate",
  GIT_AUTHOR_EMAIL: "teammate@example.invalid",
  GIT_COMMITTER_NAME: "Teammate",
  GIT_COMMITTER_EMAIL: "teammate@example.invalid",
};

const made: string[] = [];

afterEach(() => {
  for (const cwd of made.splice(0)) rmSync(cwd, { recursive: true });
});

/** A git command run in the repository as the checkout's own committer, or as `as` where given, its output trimmed. */
function git(cwd: string, ...args: string[]): string {
  return gitAs(cwd, {}, ...args);
}

/** A git command run in the repository with `as` over the checkout's own committer, its output trimmed. */
function gitAs(cwd: string, as: Readonly<Record<string, string>>, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...GIT_ENV, ...as } }).trim();
}

/** Lines `1` to `count` of a file, each its own number, with line `at` spelled `words` where given. */
function numbered(count: number, at?: { readonly line: number; readonly words: string }): string {
  return Array.from({ length: count }, (_, index) =>
    index + 1 === at?.line ? at.words : String(index + 1),
  ).join("\n");
}

/**
 * A turn during which the agent merged its upstream in: `origin/HEAD` moved
 * past the commit the turn started on, editing `upstream.txt` and the end of
 * `shared.txt`, and the agent merged it, then edited `agent.txt` and the
 * start of `shared.txt`. Answers the turn's diff of its snapshot to the
 * working tree, as the script reads it, by path and lines added.
 */
function turnAcrossAMerge(upstreamAdds?: string) {
  const cwd = mkdtempSync(join(tmpdir(), "checkout-diff-"));
  made.push(cwd);
  const write = (path: string, words: string) => writeFileSync(join(cwd, path), `${words}\n`);
  git(cwd, "init", "--quiet", "--initial-branch=main");

  for (const path of ["agent.txt", "upstream.txt"]) write(path, numbered(10));
  write("shared.txt", numbered(40));
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "first");
  git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  // Upstream moves on while the agent works on a branch of its own.
  git(cwd, "checkout", "--quiet", "-b", "upstream");
  write("upstream.txt", numbered(10, { line: 2, words: "from upstream" }));
  write("shared.txt", numbered(40, { line: 38, words: "from upstream" }));

  if (upstreamAdds !== undefined) {
    mkdirSync(dirname(join(cwd, upstreamAdds)), { recursive: true });
    write(upstreamAdds, "from upstream");
    git(cwd, "--literal-pathspecs", "add", "--", upstreamAdds);
  }

  gitAs(cwd, UPSTREAM_COMMITTER, "commit", "--quiet", "-am", "upstream");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(cwd, "checkout", "--quiet", "-b", "agent", "main");
  // The snapshot before the turn, committed on HEAD without moving it, as the runner takes one.
  const tree = git(cwd, "write-tree");
  const from = git(cwd, "commit-tree", tree, "-p", "HEAD", "-m", "The checkout before a turn");
  // The turn: upstream merged in, then the agent's own edits, left uncommitted.
  git(cwd, "merge", "--quiet", "--no-edit", "refs/remotes/origin/main");
  write("agent.txt", numbered(10, { line: 3, words: "the agent's three" }));
  write(
    "shared.txt",
    numbered(40, { line: 2, words: "the agent's two" }).replace("\n38\n", "\nfrom upstream\n"),
  );

  return turnDiff(cwd, from);
}

/** The script's counts from the snapshot `from` to the working tree, read into the turn's summary, by path and lines added. */
function turnDiff(cwd: string, from: string) {
  const format: CheckoutDiffFormat = CHECKOUT_DIFF_FORMAT.NUMSTAT;

  const output = execFileSync("sh", ["-c", CHECKOUT_DIFF_SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...GIT_ENV, ...checkoutDiffEnv({ from, to: null }, format) },
  });

  return (turnFilesSummary(output)?.files ?? []).map(
    (file) => [file.path, file.additions] as const,
  );
}

test("the script's variables carry the two commits, the second empty for the working tree, and the patch unless the counts are asked", () => {
  assert.deepEqual(checkoutDiffEnv({ from: "abc", to: "def" }), {
    APP_DIFF_FROM: "abc",
    APP_DIFF_TO: "def",
    APP_DIFF_FORMAT: "patch",
  });
  assert.deepEqual(checkoutDiffEnv({ from: "abc", to: null }, CHECKOUT_DIFF_FORMAT.NUMSTAT), {
    APP_DIFF_FROM: "abc",
    APP_DIFF_TO: "",
    APP_DIFF_FORMAT: "numstat",
  });
});

test("a turn's counts name each file where it stands, a rename where it moved to and a binary file counting no lines, and total every file past the bound", () => {
  const counts = [
    "3\t1\tsrc/kept.ts",
    "0\t0\t",
    "src/old.ts",
    "src/new.ts",
    "-\t-\tlogo.png",
    ...Array.from({ length: 60 }, (_, index) => `1\t0\tmany/${index}.txt`),
    "",
  ].join("\0");

  const summary = turnFilesSummary(counts);

  assert.deepEqual(summary?.files.slice(0, 3), [
    { path: "src/kept.ts", additions: 3, deletions: 1 },
    { path: "src/new.ts", additions: 0, deletions: 0 },
    { path: "logo.png", additions: 0, deletions: 0 },
  ]);
  assert.deepEqual(
    [summary?.files.length, summary?.total, summary?.additions, summary?.deletions],
    [50, 63, 63, 1],
  );
  assert.equal(turnFilesSummary(""), undefined);
});

test("a turn that merged its upstream in names only the agent's own files, leaving out every file the merge changed, one the agent changed too among them", () => {
  assert.deepEqual(turnAcrossAMerge(), [["agent.txt", 1]]);
});

test("a file upstream added whose name reads as a pathspec is left out by its name alone, the agent's own file kept", () => {
  // Note that `:/agent.txt` read as a pathspec names the root's `agent.txt`, the agent's.
  assert.deepEqual(turnAcrossAMerge(":/agent.txt"), [["agent.txt", 1]]);
});

test("a commit the turn made that reached upstream, as an agent's push to the default branch does, stays the turn's", () => {
  const cwd = mkdtempSync(join(tmpdir(), "checkout-diff-"));
  made.push(cwd);
  git(cwd, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(cwd, "agent.txt"), `${numbered(10)}\n`);
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "first");
  git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  const tree = git(cwd, "write-tree");
  const from = git(cwd, "commit-tree", tree, "-p", "HEAD", "-m", "The checkout before a turn");
  // The turn commits on main and pushes, so upstream moves to the turn's own commit.
  writeFileSync(
    join(cwd, "agent.txt"),
    `${numbered(10, { line: 3, words: "the agent's three" })}\n`,
  );
  git(cwd, "commit", "--quiet", "-am", "the turn's work");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");

  assert.deepEqual(turnDiff(cwd, from), [["agent.txt", 1]]);
});
