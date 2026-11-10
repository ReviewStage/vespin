// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * transcript-markdown.test.ts -- a fenced block in a reply still being
 * written: drawn plain while its closing fence has not arrived, and sent to
 * main to be colored once it has, rather than once a word; and a ```slack
 * block drawn as the message it will send, whose Copy puts it on the
 * clipboard as rich text. Synthetic replies.
 */

/** The reply's words before its block, so the block is not the first thing written. */
const LEAD = "Here is the fix for the reader.\n\n```ts\n";

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("a block after a reply's first words is colored once its closing fence arrives, and not while it streams", async () => {
  const asked: string[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_COLOR_CODE]: ({ code }) => {
      asked.push(code);
      return Promise.resolve([]);
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (text: string) =>
    act(() =>
      root.render(withQueryClient(createElement(TranscriptWords, { text, streaming: true }))),
    );
  draw(`${LEAD}const reader = open(`);
  draw(`${LEAD}const reader = open(path);\nreader.`);
  draw(`${LEAD}const reader = open(path);\nreader.close();\n\`\`\`\n\nThat closes it.`);
  await act(() => Promise.resolve());
  assert.deepEqual(asked, ["const reader = open(path);\nreader.close();"]);
});

test("a ```slack block draws its marks and copies as rich text", async () => {
  const copied: { html: string; text: string }[] = [];
  fakeAppPlatform({
    copyRich: (rich) => {
      copied.push({ ...rich });
      return Promise.resolve();
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(TranscriptWords, {
          text: "Send this:\n\n```slack\nShipped *today*\nsee <https://example.com|notes>\n```",
          streaming: false,
        }),
      ),
    ),
  );
  assert.equal(container.querySelector("strong")?.textContent, "today");
  const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]');
  await act(async () => copy?.click());
  assert.deepEqual(copied, [
    {
      html: 'Shipped <b>today</b><br>see <a href="https://example.com">notes</a>',
      text: "Shipped today\nsee notes (https://example.com)",
    },
  ]);
});
