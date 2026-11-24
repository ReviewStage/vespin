// address-words-model.test.ts -- an address breaks only after "@" and before "." or "/", never inside a part.

import { describe, expect, it } from "vitest";
import { addressWords } from "./address-words-model.js";

/** Each run of characters a line may not break inside, read off the zero-width spaces, with the word joiners dropped. */
function unbreakableRuns(words: string): string[] {
  return words.split("\u200B").map((run) => run.replaceAll("\u2060", ""));
}

describe("addressWords", () => {
  it("breaks an email after the @ and before each dot, and nowhere inside a part", () => {
    const words = addressWords("ada@example.com");

    expect(unbreakableRuns(words)).toEqual(["ada@", "example", ".com"]);
    expect(words.split("\u200B")[1]).toBe("e\u2060x\u2060a\u2060m\u2060p\u2060l\u2060e");
  });

  it("leaves words with a space in them to wrap between words", () => {
    expect(addressWords("Already following")).toBe("Already following");
  });
});
