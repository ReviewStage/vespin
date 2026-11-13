// searched-title-model.test.ts -- a searched title's Markdown bolds the words typed and prints every other mark as typed.

import { searchTokens } from "@repo/features/search-tokens";
import { describe, expect, it } from "vitest";
import { searchedTitleMarkdown } from "./searched-title-model.js";

describe("a searched title", () => {
  it("bolds each word typed where it stands, writes the title's own marks as typed, and keeps a bold off punctuation", () => {
    expect(searchedTitleMarkdown("Fix *ledger* totals (v2)", ["ledger", "(v2"])).toBe(
      "Fix \\***ledger**\\* totals \\(**v2**\\)",
    );
  });

  it("bolds the word typed however its letters lowercase: longer, as İ, or by their place, as a final Σ", () => {
    expect(searchedTitleMarkdown("İstanbul Invite", ["invite"])).toBe("İstanbul **Invite**");
    expect(searchedTitleMarkdown("ΟΔΟΣ map", searchTokens("οδος"))).toBe("**ΟΔΟΣ** map");
  });

  it("is none where no word typed stands in the title, or only punctuation matched", () => {
    expect(searchedTitleMarkdown("Invite flow", ["ledger"])).toBeUndefined();
    expect(searchedTitleMarkdown("Invite (flow)", ["("])).toBeUndefined();
  });
});
