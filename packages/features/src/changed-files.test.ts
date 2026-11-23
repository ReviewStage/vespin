import assert from "node:assert/strict";
import { test } from "vitest";
import { type AgentChangedFile, CHANGED_FILE_STATUS, PATCH_OMITTED } from "./agent-wire.js";
import {
  filterFiles,
  folderSections,
  gitHubFileDiffLink,
  startsCollapsed,
  treeOrder,
} from "./changed-files.js";

/**
 * changed-files.test.ts -- a pull request's files are listed in the tree's order, a filter keeps those whose path holds it, and what is rarely read starts folded.
 */

/** A changed file at `path`, modified by a one-line patch unless `overrides` say otherwise. */
function changed(path: string, overrides: Partial<AgentChangedFile> = {}): AgentChangedFile {
  return {
    path,
    previousPath: null,
    status: CHANGED_FILE_STATUS.MODIFIED,
    additions: 2,
    deletions: 1,
    omitted: null,
    patch: "@@ -1 +1 @@\n-a\n+b",
    ...overrides,
  };
}

test("the files are listed as the tree lists them: folders first at each level, dotted names first, then by name whatever its case", () => {
  const paths = [
    "src/b.ts",
    "README.md",
    "src/A.ts",
    ".github/ci.yml",
    "src/lib/x.ts",
    ".env",
    "docs/a.md",
  ];

  assert.deepEqual(
    treeOrder(paths.map((path) => changed(path))).map((file) => file.path),
    [".github/ci.yml", "docs/a.md", "src/lib/x.ts", "src/A.ts", "src/b.ts", ".env", "README.md"],
  );
});

test("a filter keeps the files whose path holds it whatever its case, as the tree's search does, not the path one moved from, and nothing but spaces keeps every file", () => {
  const files = [
    changed("src/seats.ts"),
    changed("src/plan.ts", {
      previousPath: "billing/plan.ts",
      status: CHANGED_FILE_STATUS.RENAMED,
    }),
    changed("README.md"),
  ];

  assert.deepEqual(
    filterFiles(files, " SEATS ").map((file) => file.path),
    ["src/seats.ts"],
  );
  assert.deepEqual(
    filterFiles(files, "PLAN").map((file) => file.path),
    ["src/plan.ts"],
  );
  assert.deepEqual(filterFiles(files, "billing"), []);
  assert.equal(filterFiles(files, "  ").length, 3);
});

test("a deleted file, a lockfile, and a file of more than a thousand changed lines start folded; a file with no hunks never does", () => {
  assert.equal(startsCollapsed(changed("src/seats.ts")), false);
  assert.equal(
    startsCollapsed(changed("src/old.ts", { status: CHANGED_FILE_STATUS.DELETED })),
    true,
  );
  assert.equal(startsCollapsed(changed("apps/web/package-lock.json")), true);
  assert.equal(startsCollapsed(changed("ios/Podfile.lock")), true);
  assert.equal(startsCollapsed(changed("src/big.ts", { additions: 900, deletions: 101 })), true);
  assert.equal(startsCollapsed(changed("src/big.ts", { additions: 900, deletions: 100 })), false);
  assert.equal(
    startsCollapsed(changed("pnpm-lock.yaml", { patch: null, omitted: PATCH_OMITTED.TOO_LARGE })),
    false,
  );
});

test("the files stand in a section per folder in the tree's order, each named past its folder, the root's under an empty folder", () => {
  const files = ["README.md", "src/lib/x.ts", "src/b.ts", "src/A.ts"].map((path) => changed(path));

  assert.deepEqual(
    folderSections(files).map((section) => [
      section.folder,
      section.files.map((each) => each.name),
    ]),
    [
      ["src/lib", ["x.ts"]],
      ["src", ["A.ts", "b.ts"]],
      ["", ["README.md"]],
    ],
  );
});

test("a file's diff on GitHub is the Files changed tab at the anchor of its path's SHA-256", async () => {
  // The SHA-256 of "README.md", worked out apart from the code with `printf README.md | sha256sum`.
  assert.equal(
    await gitHubFileDiffLink("https://github.com/acme/relay/pull/42/", "README.md"),
    "https://github.com/acme/relay/pull/42/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5",
  );
});
