/**
 * long-paste.test.ts -- the long paste a field that hears only its words finds in one change: the run pasted, and the words around it kept whole.
 */

import { describe, expect, it } from "vitest";
import { longPasteIn } from "./long-paste.js";

/** Forty lines, which reach the line bound and no character bound. */
const LINES = Array.from({ length: 40 }, (_, at) => `line ${String(at + 1)}`).join("\n");

/** Four thousand characters on one line, which reach the character bound. */
const RUN = "x".repeat(4_000);

describe("longPasteIn", () => {
  it.each([
    {
      case: "a paste between typed words is found, and the words around it kept",
      was: "fix this:  thanks",
      now: `fix this: ${LINES} thanks`,
      found: { words: LINES, kept: "fix this:  thanks" },
    },
    {
      case: "a paste over a selection takes the selection with it",
      was: "keep DROP keep",
      now: `keep ${RUN} keep`,
      found: { words: RUN, kept: "keep  keep" },
    },
    {
      case: "a paste over an emoji that opens on another never splits either in two",
      was: "😀",
      now: `😁${RUN}`,
      found: { words: `😁${RUN}`, kept: "" },
    },
  ])("$case", ({ was, now, found }) => {
    expect(longPasteIn(was, now)).toEqual(found);
  });

  it("finds nothing in typing or a short paste", () => {
    expect(longPasteIn(RUN, `${RUN}y`)).toBeUndefined();
    expect(longPasteIn("hello", "hello, a few words pasted")).toBeUndefined();
  });
});
