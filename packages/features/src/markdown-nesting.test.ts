import { describe, expect, it } from "vitest";
import { markdownTooDeep } from "./markdown-nesting.js";
import { markdownTree } from "./markdown-tree.js";

/** Markdown that crashes or stalls `markdownTree`, by the shape of its nesting. */
const TOO_DEEP = {
  "thousands of quote markers": ">".repeat(8000) + " hi",
  "spaced quote markers": "> ".repeat(8000) + "hi",
  "a list nested by indent": Array.from({ length: 1000 }, (_, i) => `${" ".repeat(i * 2)}- x`).join(
    "\n",
  ),
  "bullets on one line": "- ".repeat(8000) + "x",
  "ordered markers on one line": "1. ".repeat(8000) + "x",
  "quotes and bullets alternating": "> - ".repeat(3000) + "x",
  "quote markers after a bare carriage return": `\r${">".repeat(8000)} hi`,
  "quote markers after carriage return and line feed": `a\r\n${">".repeat(8000)} hi`,
  "quote markers inside a fence": `\`\`\`\n${">".repeat(8000)}\n\`\`\`\n`,
  "emphasis after a fence a longer opener holds open": `\`\`\`\`\n\`\`\`\n\`\`\`\`\n${"*_".repeat(50)}a`,
  "emphasis after a fence opened in a list item": `- \`\`\`\n  x\n  \`\`\`\n\n${"*_".repeat(5000)}a`,
  "emphasis opened and never closed": "*_".repeat(5000) + "a",
  "emphasis nested around a word": `${"*_".repeat(5000)}a${"_*".repeat(5000)}`,
} as const;

/** Markdown a message is written in, which must still be parsed. */
const NORMAL = {
  "plain words": "A sentence, then another.\n\nA second paragraph.",
  "nested lists": "- a\n  - b\n    - c\n      1. d\n         > e",
  "a long quote": Array.from({ length: 200 }, () => "> a line of a quote").join("\n"),
  "a thematic break": `${"* ".repeat(20)}\n\n${"-".repeat(200)}`,
  "snake_case words": `${"some_long_name ".repeat(300)}and ${"**bold** ".repeat(300)}`,
  "balanced emphasis": `${"*a ".repeat(10)}${"a* ".repeat(10)}`,
  "a banner of stars": `${"*".repeat(500)} title ${"*".repeat(500)}`,
  "unclosed emphasis in a fence": `\`\`\`c\n${"int **argv;\n".repeat(100)}\`\`\`\n`,
  "a fence inside a list item": `- \`\`\`c\n${"  int **argv;\n".repeat(100)}  \`\`\`\n`,
  "a shorter fence inside a longer one": `\`\`\`\`\n\`\`\`\n${"int **argv;\n".repeat(100)}\`\`\`\`\n`,
  "a closer with trailing words": `\`\`\`\n\`\`\` js\n${"int **argv;\n".repeat(100)}\`\`\`\n`,
} as const;

describe("markdownTooDeep", () => {
  it.each(Object.entries(TOO_DEEP))("flags %s", (_name, words) => {
    expect(markdownTooDeep(words)).toBe(true);
  });

  it.each(Object.entries(NORMAL))("passes %s", (_name, words) => {
    expect(markdownTooDeep(words)).toBe(false);
  });

  it("reads a long message in linear time", () => {
    const started = performance.now();
    markdownTooDeep(`${"line of words with *emphasis* and a > sign\n".repeat(200_000)}`);
    markdownTooDeep(">".repeat(2_000_000));
    markdownTooDeep("*a ".repeat(1_000_000));
    // Note that the budget is generous: a quadratic read of these takes minutes.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("flags what the parser cannot read", () => {
    expect(() => markdownTree(TOO_DEEP["thousands of quote markers"])).toThrow(RangeError);
  });
});
