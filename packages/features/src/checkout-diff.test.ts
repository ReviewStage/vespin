/**
 * checkout-diff.test.ts -- git's diff of a turn's checkouts read into the files the Changes view draws: each kind of change named with its paths and counts, a binary and an oversized patch left out by name, and a diff cut short losing its last file.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { CHANGED_FILE_STATUS, CHANGES_BOUNDS, PATCH_OMITTED } from "./agent-wire.js";
import { CHECKOUT_DIFF_BOUNDS, checkoutDiffEnv, checkoutDiffFiles } from "./checkout-diff.js";

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
  "diff --git a/src/a.ts b/src/b.ts",
  "similarity index 100%",
  "rename from src/a.ts",
  "rename to src/b.ts",
  "diff --git a/logo.png b/logo.png",
  "index 1111111..2222222 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n");

test("each file of a diff is read with its paths, kind, counts, and hunks, a binary one left out by name", () => {
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
  const filler = `${whole}\n${fileOf("second.ts", CHECKOUT_DIFF_BOUNDS.MAX_BYTES / 8)}`;
  const cut = checkoutDiffFiles(filler.slice(0, CHECKOUT_DIFF_BOUNDS.MAX_BYTES));
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
