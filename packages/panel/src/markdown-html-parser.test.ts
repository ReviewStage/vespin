// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { TranscriptWords } from "./tasks/transcript-blocks.js";
import { settleQueries, withQueryClient } from "./testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "./testing/markdown.js";

/**
 * markdown-html-parser.test.ts -- a reply drawn before the HTML parser has
 * landed shows its words at once rather than an empty bubble, and is drawn
 * again whole, its raw HTML parsed, the moment the parser lands. Synthetic words.
 */

test("a reply shows its words before the parser lands, and its HTML parsed once it has", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const words = createElement(TranscriptWords, { text: "Press <kbd>K</kbd> to search." });
  // Note that the render is synchronous, so nothing the parser's import resolves has run yet.
  act(() => root.render(withQueryClient(words)));
  assert.match(container.textContent ?? "", /to search\./);
  await act(() => Effect.runPromise(markdownHtmlParserLanded));
  await settleQueries();
  assert.equal(container.querySelector("kbd")?.textContent, "K");
  assert.equal(container.textContent, "Press K to search.");
  act(() => root.unmount());
});
