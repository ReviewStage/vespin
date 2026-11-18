// markdown-leads.test.ts -- Markdown cut short only where a block ends.

import { describe, expect, it } from "vitest";
import { markdownLeads } from "./markdown-leads.js";

describe("markdownLeads", () => {
  it.each([
    [
      "each block's end, shortest first",
      "\n# Done\n\nAll **three** pass.\n\n- one\n- two\n",
      ["# Done", "# Done\n\nAll **three** pass.", "# Done\n\nAll **three** pass.\n\n- one\n- two"],
    ],
    [
      "never inside a block, so a mark spanning lines stays whole",
      "A **bold\nclaim** here.\n\n```ts\nconst a = 1;\n```",
      ["A **bold\nclaim** here.", "A **bold\nclaim** here.\n\n```ts\nconst a = 1;\n```"],
    ],
    [
      "a leading indented code block keeps its indent, so it stays code",
      "\n    **literal**\n\nAfter.",
      ["    **literal**", "    **literal**\n\nAfter."],
    ],
  ])("%s", (_, markdown, leads) => {
    expect(markdownLeads(markdown)).toEqual(leads);
  });
});
