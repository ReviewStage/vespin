import { expect, it } from "vitest";
import { inlineCodeTarget } from "./inline-code-target.js";

/**
 * inline-code-target.test.ts -- what an inline span of code opens by its
 * words' shape: a file at its line, a page, or nothing for words of code
 * shaped like neither. Hand-written spans as agents write them.
 */

it.each([
  {
    words: "packages/ui/src/foo.ts:12",
    opens: { kind: "file", path: "packages/ui/src/foo.ts", line: 12 },
  },
  { words: "./apps/web/x.tsx:4:7", opens: { kind: "file", path: "apps/web/x.tsx", line: 4 } },
  {
    words: "/workspace/repository/AGENTS.md",
    opens: { kind: "file", path: "AGENTS.md", line: undefined },
  },
  { words: "package.json", opens: { kind: "file", path: "package.json", line: undefined } },
  { words: "https://example.com", opens: { kind: "web", href: "https://example.com" } },
  { words: "github.com/a/b", opens: { kind: "web", href: "https://github.com/a/b" } },
  { words: "console.log", opens: undefined },
  { words: "packages/ui/", opens: undefined },
  { words: "../outside.ts", opens: undefined },
  {
    words: "/Users/ana/.vespin/agents/7f3a/repository/src/tile.css",
    opens: { kind: "file", path: "src/tile.css", line: undefined },
  },
  { words: "/tmp/scratch.ts", opens: undefined },
  { words: "/tmp/repository/src/tile.css", opens: undefined },
  { words: "/Users/ana/.vespin/agents/../repository/src/tile.css", opens: undefined },
  { words: "pnpm exec vitest run x.ts", opens: undefined },
])("$words opens $opens.kind", ({ words, opens }) => {
  expect(inlineCodeTarget(words)).toEqual(opens);
});
