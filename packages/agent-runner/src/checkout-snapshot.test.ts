/**
 * checkout-snapshot.test.ts -- the checkout's snapshot before a turn, taken by git in a repository of the test's own.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { CheckoutSnapshots, checkoutSnapshotsLive } from "./checkout-snapshot.js";
import { CHECKOUT_SNAPSHOT } from "./protocol.js";

/** The snapshots through git itself, on the test's own path and home, as the runner provides them. */
const LIVE = checkoutSnapshotsLive({ PATH: process.env.PATH, HOME: process.env.HOME }).pipe(
  Layer.provide(
    NodeChildProcessSpawner.layer.pipe(
      Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    ),
  ),
);

const LINE = {
  FIRST: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e01",
  SECOND: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e02",
  THIRD: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e03",
} as const;

/** A git command run in the repository, its output trimmed. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...(process.env.PATH === undefined ? undefined : { PATH: process.env.PATH }),
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).trim();
}

/** A repository on `main` with one commit: a tracked file, and an ignore of `out/`. */
function repository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "checkout-snapshot-"));
  git(cwd, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(cwd, "kept.txt"), "as committed\n");
  writeFileSync(join(cwd, ".gitignore"), "out/\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "first");
  return cwd;
}

/** The paths and contents of the tree, as `ls-tree` and `show` read them. */
function treeOf(cwd: string, commit: string): Record<string, string> {
  const paths = git(cwd, "ls-tree", "-r", "--name-only", commit).split("\n");
  return Object.fromEntries(paths.map((path) => [path, git(cwd, "show", `${commit}:${path}`)]));
}

it.layer(LIVE)("the checkout's snapshot", (it) => {
  it.effect(
    "records the working tree, changed and untracked files included and ignored ones left out, under the line's ref without touching the checkout",
    () =>
      Effect.gen(function* () {
        const cwd = repository();
        yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(cwd, { recursive: true })));
        const head = git(cwd, "rev-parse", "HEAD");
        writeFileSync(join(cwd, "kept.txt"), "as edited\n");
        writeFileSync(join(cwd, "made.txt"), "by a shell command\n");
        mkdirSync(join(cwd, "out"));
        writeFileSync(join(cwd, "out", "built.txt"), "ignored\n");
        const before = git(cwd, "status", "--porcelain");

        const snapshots = yield* CheckoutSnapshots;
        const snapshot = yield* snapshots.take(cwd, LINE.FIRST);

        assert.ok(snapshot !== undefined);
        assert.deepEqual(
          { head: snapshot.head, branch: snapshot.branch },
          { head, branch: "main" },
        );
        assert.equal(
          git(cwd, "rev-parse", `${CHECKOUT_SNAPSHOT.REF_PREFIX}${LINE.FIRST}`),
          snapshot.commit,
        );
        assert.equal(git(cwd, "rev-parse", `${snapshot.commit}^`), head);
        assert.deepEqual(treeOf(cwd, snapshot.commit), {
          ".gitignore": "out/",
          "kept.txt": "as edited",
          "made.txt": "by a shell command",
        });
        // The checkout stands as it was: its branch, its HEAD, and what its index and tree say.
        assert.equal(git(cwd, "rev-parse", "HEAD"), head);
        assert.equal(git(cwd, "symbolic-ref", "--short", "HEAD"), "main");
        assert.equal(git(cwd, "status", "--porcelain"), before);
      }),
  );

  it.effect("keeps the newest snapshots alone, and records an empty repository too", () =>
    Effect.gen(function* () {
      const cwd = repository();
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(cwd, { recursive: true })));
      const snapshots = yield* CheckoutSnapshots;
      // One more snapshot than the checkout keeps, each under a line of its own, so the oldest goes.
      const lines = Array.from({ length: CHECKOUT_SNAPSHOT.KEEP + 1 }, () => randomUUID());
      for (const [index, line] of lines.entries()) {
        writeFileSync(join(cwd, "kept.txt"), `turn ${index}\n`);
        assert.ok((yield* snapshots.take(cwd, line)) !== undefined);
      }
      // Note that the refs are kept by their commits' dates, which a test cannot space out, so
      // what this checks is only that the cap holds: how many stand, never which.
      const kept = git(cwd, "for-each-ref", "--format=%(refname)", CHECKOUT_SNAPSHOT.REF_PREFIX)
        .split("\n")
        .filter((ref) => ref !== "");
      assert.equal(kept.length, CHECKOUT_SNAPSHOT.KEEP);

      const empty = mkdtempSync(join(tmpdir(), "checkout-snapshot-empty-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(empty, { recursive: true })));
      git(empty, "init", "--quiet", "--initial-branch=main");
      writeFileSync(join(empty, "first.txt"), "before any commit\n");
      const snapshot = yield* snapshots.take(empty, LINE.FIRST);
      assert.ok(snapshot !== undefined);
      assert.deepEqual(
        { head: snapshot.head, branch: snapshot.branch },
        { head: undefined, branch: "main" },
      );
      assert.deepEqual(treeOf(empty, snapshot.commit), { "first.txt": "before any commit" });
    }),
  );

  it.effect("answers nothing, and the turn goes on, where the directory is no checkout", () =>
    Effect.gen(function* () {
      const cwd = mkdtempSync(join(tmpdir(), "checkout-snapshot-none-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(cwd, { recursive: true })));
      const snapshots = yield* CheckoutSnapshots;
      assert.equal(yield* snapshots.take(cwd, LINE.FIRST), undefined);
    }),
  );
});
