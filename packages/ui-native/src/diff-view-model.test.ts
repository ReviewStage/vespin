import { expect, it } from "vitest";
import { DRAWN_ROW, diffColumns, NO_LINE } from "./diff-view-model.js";

/**
 * diff-view-model.test.ts -- a patch reaches the native diff view as columns: each hunk's header a row of its own, every row numbered on the sides it stands on, and a tab drawn as spaces.
 */

// Note that the regression this catches is a row numbered on the wrong side, or a header left out, which the view would draw as the file's wrong lines.
it("hands each hunk's header and its rows as columns, numbered on the sides each stands on", () => {
  const patch = ["@@ -3,3 +3,3 @@ function f()", " keep", "-\told", "+new", " end"].join("\n");

  expect(diffColumns(patch)).toEqual({
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
