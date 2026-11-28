import { DIFF_SIDE, type DiffSide, type ReviewThread } from "@repo/features/agent-wire";
import { expect, it } from "vitest";
import { DRAWN_ROW, drawnDiff, NO_LINE } from "./diff-view-model.js";

/**
 * diff-view-model.test.ts -- a patch reaches the native diff view as columns: each hunk's header a row of its own, every row numbered on the sides it stands on, and a tab drawn as spaces.
 */

// Note that the regression this catches is a row numbered on the wrong side, or a header left out, which the view would draw as the file's wrong lines.
it("hands each hunk's header and its rows as columns, numbered on the sides each stands on", () => {
  const patch = ["@@ -3,3 +3,3 @@ function f()", " keep", "-\told", "+new", " end"].join("\n");

  expect(drawnDiff(patch, [])?.columns).toEqual({
    kinds: [
      DRAWN_ROW.HUNK,
      DRAWN_ROW.CONTEXT,
      DRAWN_ROW.REMOVED,
      DRAWN_ROW.ADDED,
      DRAWN_ROW.CONTEXT,
    ].join(""),
    oldLines: [NO_LINE, 3, 4, NO_LINE, 5],
    newLines: [NO_LINE, 3, NO_LINE, 4, 5],
    text: ["@@ -3,3 +3,3 @@ function f()", "keep", "    old", "new", "end"].join("\n"),
  });
});

/** A review thread by `login` on `line` of `side`, its words `body`, with nothing else GitHub says of it. */
function thread(side: DiffSide, line: number | null, body: string, outdated = false): ReviewThread {
  const by = { login: "grace", bot: false };

  return {
    path: "src/a.ts",
    line,
    startLine: null,
    originalLine: line ?? 9,
    originalStartLine: null,
    side,
    startSide: null,
    diffHunk: "",
    resolved: false,
    outdated,
    comments: [
      { by, html: null, body, at: 0, url: `https://github.com/acme/relay/pull/1#r${body.length}` },
    ],
    more: 0,
  };
}

// Note that the regression this catches is a thread standing under the wrong line, such as an old-side thread put under the new line of the same number.
it("stands each thread under the line it is on, on its side, and one on no line shown above the first hunk", () => {
  const patch = ["@@ -3,2 +3,2 @@", " keep", "-old", "+new"].join("\n");

  const drawn = drawnDiff(
    patch,
    [
      thread(DIFF_SIDE.LEFT, 4, "Why drop this?"),
      thread(DIFF_SIDE.RIGHT, 4, "Nice."),
      thread(DIFF_SIDE.RIGHT, null, "Gone now.", true),
    ],
    "src/a.ts",
  );

  expect(drawn?.columns.kinds).toBe(
    [
      DRAWN_ROW.THREAD,
      DRAWN_ROW.HUNK,
      DRAWN_ROW.CONTEXT,
      DRAWN_ROW.REMOVED,
      DRAWN_ROW.THREAD,
      DRAWN_ROW.ADDED,
      DRAWN_ROW.THREAD,
    ].join(""),
  );
  expect(
    [...(drawn?.threads.entries() ?? [])].map(([row, each]) => [row, each.comments[0]?.body]),
  ).toEqual([
    [0, "Gone now."],
    [4, "Why drop this?"],
    [6, "Nice."],
  ]);
});
