import assert from "node:assert/strict";
import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  DIFF_SIDE,
  type ReviewThread,
} from "@repo/features/agent-wire";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  chapterHunks,
  chapterPatches,
  LINE_REF_SIDE,
  type LineRef,
} from "@repo/features/pull-request-chapters";
import { test } from "vitest";
import {
  chapterMarks,
  chapterPaths,
  chapterThreadCount,
  chapterViewed,
  drawnLines,
  firstLineRef,
  lineRefLabel,
  steppedChapter,
} from "./chapters-model.js";

/**
 * chapters-model.test.ts -- a chapter is viewed once all its files are, and
 * marking it marks the rest or unmarks them all; a key change's press goes
 * to its first lines in the chapter's order, lit where the chapter's diff
 * draws them and its file's header where it does not. Synthetic chapters
 * only.
 */

/** A modified file of two hunks, two lines apart. */
const STORE: AgentChangedFile = {
  path: "src/store.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -10,1 +10,2 @@", " j", "+k"].join("\n"),
};

const LOCK: AgentChangedFile = {
  path: "pnpm-lock.yaml",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 1,
  deletions: 1,
  omitted: null,
  patch: ["@@ -3,1 +3,1 @@", "-x", "+y"].join("\n"),
};

/** A chapter of the story holding the hunks named. */
function chapter(title: string, hunkRefs: Chapter["hunkRefs"]): Chapter {
  return {
    kind: CHAPTER_KIND.STORY,
    title,
    summary: "",
    hunkRefs,
    keyChanges: [],
    risk: CHAPTER_RISK.LOW,
    riskReasons: [],
  };
}

const FIRST = chapter("Read the store", [{ path: STORE.path, oldStart: 1 }]);
const SECOND = chapter("Write the store", [{ path: STORE.path, oldStart: 10 }]);

const OTHER: Chapter = {
  ...chapter("Other changes", [{ path: LOCK.path, oldStart: 3 }]),
  kind: CHAPTER_KIND.OTHER,
  risk: null,
};

test("a chapter is viewed once every file it holds is, so a file two chapters share is viewed in both; one holding no file is never viewed", () => {
  const files = [STORE, LOCK];
  const viewed = new Set([STORE.path]);
  const isViewed = (path: string) => viewed.has(path);

  assert.equal(chapterViewed(chapterPaths(FIRST, files), isViewed), true);
  assert.equal(chapterViewed(chapterPaths(SECOND, files), isViewed), true, "the file is shared");
  assert.equal(chapterViewed(chapterPaths(OTHER, files), isViewed), false);
  assert.equal(chapterViewed(chapterPaths(chapter("Gone", []), files), isViewed), false);
});

test("marking a chapter turns the files not yet viewed, and marking a viewed one turns them all back", () => {
  const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const some = new Set(["src/b.ts"]);

  assert.deepEqual(
    chapterMarks(paths, (path) => some.has(path)),
    ["src/a.ts", "src/c.ts"],
  );
  assert.deepEqual(
    chapterMarks(paths, () => true),
    paths,
  );
});

test("a chapter counts the review threads on its own hunks, and one on the whole file in every chapter holding a hunk of it", () => {
  const hunks = chapterHunks([STORE, LOCK]);

  const on = (line: number | null): ReviewThread => ({
    path: STORE.path,
    line,
    startLine: null,
    originalLine: line,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    diffHunk: "",
    resolved: false,
    outdated: false,
    comments: [],
    more: 0,
  });

  const threads = [on(2), on(11), on(null)];

  assert.equal(chapterThreadCount(FIRST, threads, hunks), 2);
  assert.equal(chapterThreadCount(SECOND, threads, hunks), 2);
  assert.equal(chapterThreadCount(OTHER, threads, hunks), 0);
});

test("a key change's lines are named by path then line, a range by its ends", () => {
  const ref = { path: "src/store.ts", side: LINE_REF_SIDE.ADDITIONS, startLine: 12, endLine: 20 };

  assert.equal(lineRefLabel(ref), "src/store.ts · L12–20");
  assert.equal(lineRefLabel({ ...ref, endLine: 12 }), "src/store.ts · L12");
});

test("a key change's press goes to its first lines in the chapter's file order, then by line, a removed line before an added one", () => {
  const at = (path: string, side: LineRef["side"], startLine: number, endLine = startLine) => ({
    path,
    side,
    startLine,
    endLine,
  });

  const storeAdded = at(STORE.path, LINE_REF_SIDE.ADDITIONS, 10);
  const storeRemoved = at(STORE.path, LINE_REF_SIDE.DELETIONS, 10);
  const lockRemoved = at(LOCK.path, LINE_REF_SIDE.DELETIONS, 3);
  const elsewhere = at("src/elsewhere.ts", LINE_REF_SIDE.ADDITIONS, 1);

  assert.deepEqual(
    firstLineRef([elsewhere, storeAdded, lockRemoved], [LOCK.path, STORE.path]),
    lockRemoved,
  );
  assert.deepEqual(firstLineRef([elsewhere, storeAdded, lockRemoved], [STORE.path]), storeAdded);
  assert.deepEqual(firstLineRef([storeAdded, storeRemoved], [STORE.path]), storeRemoved);
  assert.deepEqual(
    firstLineRef(
      [at(STORE.path, LINE_REF_SIDE.ADDITIONS, 2, 9), at(STORE.path, LINE_REF_SIDE.ADDITIONS, 2)],
      [STORE.path],
    ),
    at(STORE.path, LINE_REF_SIDE.ADDITIONS, 2),
  );
  assert.deepEqual(
    firstLineRef([at("src/z.ts", LINE_REF_SIDE.ADDITIONS, 9), elsewhere], []),
    at("src/z.ts", LINE_REF_SIDE.ADDITIONS, 9),
    "lines of files the chapter does not draw keep the order they were named in",
  );
  assert.equal(firstLineRef([], [STORE.path]), undefined);
});

test("a key change's lines are lit where a hunk the chapter draws holds the first, up to that hunk's end; elsewhere its file's header is gone to", () => {
  const ref = (side: LineRef["side"], startLine: number, endLine: number): LineRef => ({
    path: STORE.path,
    side,
    startLine,
    endLine,
  });

  assert.deepEqual(drawnLines(STORE, ref(LINE_REF_SIDE.ADDITIONS, 1, 2)), {
    side: LINE_REF_SIDE.ADDITIONS,
    startLine: 1,
    endLine: 2,
  });
  assert.deepEqual(drawnLines(STORE, ref(LINE_REF_SIDE.DELETIONS, 2, 2)), {
    side: LINE_REF_SIDE.DELETIONS,
    startLine: 2,
    endLine: 2,
  });
  assert.deepEqual(
    drawnLines(STORE, ref(LINE_REF_SIDE.ADDITIONS, 11, 14)),
    { side: LINE_REF_SIDE.ADDITIONS, startLine: 11, endLine: 11 },
    "a run past its hunk is lit to the hunk's last line",
  );
  assert.equal(
    drawnLines(STORE, ref(LINE_REF_SIDE.ADDITIONS, 5, 6)),
    undefined,
    "lines between two hunks are drawn by neither",
  );
  assert.equal(
    drawnLines(STORE, ref(LINE_REF_SIDE.DELETIONS, 11, 11)),
    undefined,
    "the second hunk counts one old line",
  );
  const [secondOnly] = chapterPatches(SECOND, [STORE]);
  assert.equal(
    drawnLines(secondOnly, ref(LINE_REF_SIDE.ADDITIONS, 1, 2)),
    undefined,
    "a hunk of the file another chapter holds is not drawn in this one",
  );
  assert.equal(
    drawnLines({ ...STORE, patch: null }, ref(LINE_REF_SIDE.ADDITIONS, 1, 2)),
    undefined,
  );
  assert.equal(drawnLines(undefined, ref(LINE_REF_SIDE.ADDITIONS, 1, 2)), undefined);
});

test("stepping through chapters holds at either end", () => {
  assert.equal(steppedChapter(0, -1, 3), 0);
  assert.equal(steppedChapter(1, 1, 3), 2);
  assert.equal(steppedChapter(2, 1, 3), 2);
});
