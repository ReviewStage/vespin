// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { GUIDES, GuidesPage } from "../src/GuidesPage";
import { guideMarkdown, guideRoutes, guideStructuredData, guideViewForPath } from "../src/guides";
import { parseGuides } from "../src/site-markdown";

/* React reports a hydration mismatch as a recoverable error and quietly
   renders the client's tree instead, so a page that drew the wrong view
   would still look right; the errors are the only witness. */
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** A guide as a writer would write one, with a related guide beside it. */
const FILES = [
  {
    file: "run-agents.md",
    words: [
      "---",
      'title: "Run agents: a guide"',
      "description: How to run agents.",
      "published: 2026-11-10",
      "updated: 2026-11-12",
      "related: [review-agents]",
      "faq:",
      "  - q: Can I run two?",
      "    a: Yes, see [the docs](https://vespin.dev/docs).",
      "---",
      "",
      "The answer first.",
      "",
      "## Steps",
      "",
      "Do this.",
    ].join("\n"),
  },
  {
    file: "review-agents.md",
    words: [
      "---",
      "title: Review agents",
      "description: How to review agents.",
      "published: 2026-11-11",
      "updated: 2026-11-11",
      "faq:",
      "  - q: How fast?",
      "    a: Fast.",
      "---",
      "",
      "Words.",
    ].join("\n"),
  },
] as const;

for (const route of guideRoutes(GUIDES)) {
  test(`${route.path} hydrates, from its own address, the page the prerender wrote`, async () => {
    const root = document.createElement("div");
    root.innerHTML = renderToString(createElement(GuidesPage, { view: route.view }));
    document.body.replaceChildren(root);
    window.history.replaceState(null, "", route.path);

    const view = guideViewForPath(GUIDES, window.location.pathname);
    assert.ok(view !== undefined);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(root, createElement(GuidesPage, { view }), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    assert.deepEqual(errors, []);
  });
}

test("a guide's front matter FAQ is its FAQPage's questions in plain words, and its Markdown copy's closing section", () => {
  const [guide] = parseGuides(FILES, false);
  assert.ok(guide !== undefined);
  assert.equal(guide.title, "Run agents: a guide");

  const faq = guideStructuredData(guide)
    .map((json) => JSON.parse(json))
    .find((data) => data["@type"] === "FAQPage");

  assert.deepEqual(faq?.mainEntity, [
    {
      "@type": "Question",
      name: "Can I run two?",
      acceptedAnswer: { "@type": "Answer", text: "Yes, see the docs." },
    },
  ]);

  assert.ok(
    guideMarkdown(guide).text.endsWith(
      "## Frequently asked questions\n\n### Can I run two?\n\nYes, see [the docs](https://vespin.dev/docs).\n",
    ),
  );
});

test("a draft is left out where drafts are, and a guide naming a related guide that isn't there fails the build", () => {
  const draft = FILES[1].words.replace("faq:", "draft: true\nfaq:");

  assert.deepEqual(
    parseGuides([{ file: "review-agents.md", words: draft }], false).map((guide) => guide.slug),
    [],
  );

  assert.throws(() => parseGuides([FILES[0]], true), /related.*review-agents/);
});
