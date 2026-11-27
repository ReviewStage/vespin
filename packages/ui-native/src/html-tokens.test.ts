import { describe, expect, it } from "vitest";
import { HTML_TOKEN, htmlTokens } from "./html-tokens.js";

describe("htmlTokens", () => {
  // A tag that never closes, or one tag after another with no `>` between, sent a pattern back over the words after each `<`.
  it.each([
    ["a tag that never closes", `<a ${"b ".repeat(50_000)}`],
    ["`<` after `<` with no `>`", "<a".repeat(50_000)],
    ["a tag past its bound", `<a ${"b ".repeat(50_000)}>after`],
  ])("reads %s in one pass, drawing no tag of it", (_, html) => {
    expect(htmlTokens(html).filter((token) => token.kind !== HTML_TOKEN.TEXT)).toEqual([]);
  });
});
