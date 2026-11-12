import assert from "node:assert/strict";
import { test } from "vitest";
import { descriptionBlocks } from "./description-blocks.js";

// A comment's anchor must stand over its block's own Markdown, measured as the service measures it, or the thread lands on the wrong words.
test("each block's span stands over its own Markdown, its quote its words with no Markdown and a hard break as a line, and a rule is drawn with nothing to quote", () => {
  const text = "## Goal\n\nInvite by\\\n**email**.\n\n---\n\n- one\n- `two`\n";

  assert.deepEqual(descriptionBlocks(text), [
    { from: 0, to: 7, drawn: "## Goal", quote: "Goal" },
    { from: 9, to: 30, drawn: "Invite by\\\n**email**.", quote: "Invite by\nemail." },
    { from: 32, to: 35, drawn: "---", quote: undefined },
    { from: 37, to: 50, drawn: "- one\n- `two`", quote: "one\ntwo" },
  ]);
});

// A block drawn alone must still find a link's address defined elsewhere in the description, or its link reads as plain words.
test("a block is drawn with the description's link definitions after it, and a definition is no block of its own", () => {
  const text = "See [the spec][s].\n\n[s]: https://example.com/spec\n";

  assert.deepEqual(descriptionBlocks(text), [
    {
      from: 0,
      to: 18,
      drawn: "See [the spec][s].\n\n[s]: https://example.com/spec",
      quote: "See the spec.",
    },
  ]);
});
