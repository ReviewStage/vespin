/**
 * checkout-diff.test.ts -- git's diff of a turn's checkouts read into the files the Changes view draws: each kind of change named with its paths and counts, a binary and an oversized patch left out by name, and a diff cut short losing its last file.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { CHANGED_FILE_STATUS, CHANGES_BOUNDS, PATCH_OMITTED } from "./agent-wire.js";
import {
  CHECKOUT_DIFF_BOUNDS,
  CHECKOUT_DIFF_SCRIPT,
  checkoutDiffEnv,
  checkoutDiffFiles,
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

const DIFF = [
  "diff --git a/src/invite.ts b/src/invite.ts",
  "index 3b18e51..a1b2c3d 100644",
  "--- a/src/invite.ts",
  "+++ b/src/invite.ts",
  "@@ -1,3 +1,3 @@",
  " const kept = 1;",
  "-const ttl = 7;",
  "+const ttl = 14;",
  "@@ -9,2 +9,3 @@",
  "--- a line that opens with two dashes",
  "+++ a line that opens with two pluses",
  "+const resend = true;",
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..e69de29",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1 @@",
  "+export const fresh = 1;",
  "\\ No newline at end of file",
  "diff --git a/src/old.ts b/src/old.ts",
  "deleted file mode 100644",
  "index e69de29..0000000",
  "--- a/src/old.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "diff --git a/src/my file.ts b/src/my file.ts",
  "--- a/src/my file.ts\t",
  "+++ b/src/my file.ts\t",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/a.ts b/src/b.ts",
  "similarity index 100%",
  "rename from src/a.ts",
  "rename to src/b.ts",
  "diff --git a/logo.png b/logo.png",
  "index 1111111..2222222 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "diff --git a/.env.local b/.env.local",
  "--- a/.env.local",
  "+++ b/.env.local",
  "@@ -1 +1 @@",
  "-TOKEN=old",
  "+TOKEN=new",
  "",
].join("\n");

const made: string[] = [];

afterEach(() => {
  for (const cwd of made.splice(0)) rmSync(cwd, { recursive: true });
});

/** Whoever commits upstream in these repositories: someone other than the checkout's own committer. */
const UPSTREAM_COMMITTER = {
  GIT_AUTHOR_NAME: "Teammate",
  GIT_AUTHOR_EMAIL: "teammate@example.invalid",
  GIT_COMMITTER_NAME: "Teammate",
  GIT_COMMITTER_EMAIL: "teammate@example.invalid",
};

/**
 * Whether the git these tests run can replay one side's change onto another
 * (`merge-tree --merge-base`, git 2.40), which the script falls back from
 * where it cannot, as Apple's git 2.39 cannot.
 */
const REPLAYS = (() => {
  const help = spawnSync("git", ["merge-tree", "-h"], { encoding: "utf8", env: GIT_ENV });

  return `${help.stdout}${help.stderr}`.includes("merge-base");
})();

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
 * start of `shared.txt`. Where `clashing`, upstream also edited line 5 of
 * `clash.txt`, which the agent had already edited before the turn, so the
 * merge conflicted and the agent settled it on its own words. Answers the
 * turn's diff of its snapshot to the working tree, as the script reads it,
 * by path and lines added.
 */
function turnAcrossAMerge(clashing: boolean) {
  const cwd = mkdtempSync(join(tmpdir(), "checkout-diff-"));
  made.push(cwd);
  const write = (path: string, words: string) => writeFileSync(join(cwd, path), `${words}\n`);
  git(cwd, "init", "--quiet", "--initial-branch=main");

  for (const path of ["agent.txt", "upstream.txt", "clash.txt"]) write(path, numbered(10));
  write("shared.txt", numbered(40));
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "first");
  git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  // Upstream moves on while the agent works on a branch of its own.
  git(cwd, "checkout", "--quiet", "-b", "upstream");
  write("upstream.txt", numbered(10, { line: 2, words: "from upstream" }));
  write("shared.txt", numbered(40, { line: 38, words: "from upstream" }));

  if (clashing) write("clash.txt", numbered(10, { line: 5, words: "upstream's five" }));
  gitAs(cwd, UPSTREAM_COMMITTER, "commit", "--quiet", "-am", "upstream");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(cwd, "checkout", "--quiet", "-b", "agent", "main");
  write("clash.txt", numbered(10, { line: 5, words: "the agent's five" }));
  git(cwd, "commit", "--quiet", "-am", "the agent's earlier work");
  // The snapshot before the turn, committed on HEAD without moving it, as the runner takes one.
  const tree = git(cwd, "write-tree");
  const from = git(cwd, "commit-tree", tree, "-p", "HEAD", "-m", "The checkout before a turn");
  // The turn: upstream merged in, a clash settled on the agent's words, then the agent's own edits, left uncommitted.
  git(cwd, "merge", "--quiet", "--no-commit", "-X", "ours", "refs/remotes/origin/main");
  git(cwd, "commit", "--quiet", "--no-edit");
  write("agent.txt", numbered(10, { line: 3, words: "the agent's three" }));
  write(
    "shared.txt",
    numbered(40, { line: 2, words: "the agent's two" }).replace("\n38\n", "\nfrom upstream\n"),
  );

  return turnDiff(cwd, from);
}

/** The script's diff from the snapshot `from` to the working tree, by path and lines added. */
function turnDiff(cwd: string, from: string) {
  const output = execFileSync("sh", ["-c", CHECKOUT_DIFF_SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...GIT_ENV, ...checkoutDiffEnv({ from, to: null }) },
  });

  return checkoutDiffFiles(output).files.map((file) => [file.path, file.additions] as const);
}

test("each file of a diff is read with its paths, a space in one among them, kind, counts, and hunks, a binary one and a secret one left out by name", () => {
  assert.deepEqual(checkoutDiffFiles(DIFF), {
    truncated: false,
    files: [
      {
        path: "src/invite.ts",
        previousPath: null,
        status: CHANGED_FILE_STATUS.MODIFIED,
        additions: 3,
        deletions: 2,
        patch: [
          "@@ -1,3 +1,3 @@",
          " const kept = 1;",
          "-const ttl = 7;",
          "+const ttl = 14;",
          "@@ -9,2 +9,3 @@",
          "--- a line that opens with two dashes",
          "+++ a line that opens with two pluses",
          "+const resend = true;",
        ].join("\n"),
        omitted: null,
      },
      {
        path: "src/new.ts",
        previousPath: null,
        status: CHANGED_FILE_STATUS.ADDED,
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1 @@\n+export const fresh = 1;\n\\ No newline at end of file",
        omitted: null,
      },
      {
        path: "src/old.ts",
        previousPath: null,
        status: CHANGED_FILE_STATUS.DELETED,
        additions: 0,
        deletions: 1,
        patch: "@@ -1 +0,0 @@\n-gone",
        omitted: null,
      },
      {
        path: "src/my file.ts",
        previousPath: null,
        status: CHANGED_FILE_STATUS.MODIFIED,
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
        omitted: null,
      },
      {
        path: "src/b.ts",
        previousPath: "src/a.ts",
        status: CHANGED_FILE_STATUS.RENAMED,
        additions: 0,
        deletions: 0,
        patch: "",
        omitted: null,
      },
      {
        path: "logo.png",
        previousPath: null,
        status: CHANGED_FILE_STATUS.MODIFIED,
        additions: 0,
        deletions: 0,
        patch: null,
        omitted: PATCH_OMITTED.BINARY,
      },
      {
        path: ".env.local",
        previousPath: null,
        status: CHANGED_FILE_STATUS.MODIFIED,
        additions: 1,
        deletions: 1,
        patch: null,
        omitted: PATCH_OMITTED.SECRET,
      },
    ],
  });
  assert.deepEqual(checkoutDiffFiles(""), { files: [], truncated: false });
});

test("a patch past the view's bound is left out as too large with its counts kept, and a diff cut at the script's bound loses its last file and says so", () => {
  const fileOf = (path: string, lines: number) =>
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines} @@`,
      ...Array.from({ length: lines }, (_, index) => `+line ${index}`),
    ].join("\n");

  const large = checkoutDiffFiles(fileOf("big.ts", CHANGES_BOUNDS.MAX_PATCH_CHARS / 4));
  assert.deepEqual(
    large.files.map(({ path, additions, patch, omitted }) => ({ path, additions, patch, omitted })),
    [
      {
        path: "big.ts",
        additions: CHANGES_BOUNDS.MAX_PATCH_CHARS / 4,
        patch: null,
        omitted: PATCH_OMITTED.TOO_LARGE,
      },
    ],
  );

  const whole = fileOf("first.ts", 1);

  // A diff of two-byte characters reaches the bound at about half the characters, which the reading counts in bytes.
  const wide = [
    "diff --git a/second.ts b/second.ts",
    "--- a/second.ts",
    "+++ b/second.ts",
    `@@ -0,0 +1,${CHECKOUT_DIFF_BOUNDS.MAX_BYTES / 64} @@`,
    ...Array.from({ length: CHECKOUT_DIFF_BOUNDS.MAX_BYTES / 64 }, () => `+${"é".repeat(60)}`),
  ].join("\n");

  const cut = checkoutDiffFiles(
    `${whole}\n${wide}`.slice(0, (CHECKOUT_DIFF_BOUNDS.MAX_BYTES * 17) / 32),
  );

  assert.deepEqual(
    [cut.truncated, cut.files.map((file) => file.path)],
    [true, ["first.ts"]],
    "the file the bound cut into is left out",
  );

  const many = checkoutDiffFiles(
    Array.from({ length: CHANGES_BOUNDS.MAX_FILES + 1 }, (_, index) =>
      fileOf(`file-${index}.ts`, 1),
    ).join("\n"),
  );

  assert.deepEqual([many.truncated, many.files.length], [true, CHANGES_BOUNDS.MAX_FILES]);
});

test("the script's variables carry the two commits, the second empty for the working tree", () => {
  assert.deepEqual(checkoutDiffEnv({ from: "abc", to: "def" }), {
    APP_DIFF_FROM: "abc",
    APP_DIFF_TO: "def",
  });
  assert.deepEqual(checkoutDiffEnv({ from: "abc", to: null }), {
    APP_DIFF_FROM: "abc",
    APP_DIFF_TO: "",
  });
});

test("a turn that merged its upstream in names only the agent's own changes, leaving out what the merge brought", () => {
  // Note that a git that cannot replay upstream takes every path upstream changed out, `shared.txt` among them.
  assert.deepEqual(
    turnAcrossAMerge(false),
    REPLAYS
      ? [
          ["agent.txt", 1],
          ["shared.txt", 1],
        ]
      : [["agent.txt", 1]],
  );
});

test("where upstream clashes with the checkout before the turn, the files upstream changed are left out and the agent's others kept", () => {
  assert.deepEqual(turnAcrossAMerge(true), [["agent.txt", 1]]);
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
