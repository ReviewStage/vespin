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
      "    a: |",
      "      Yes, see [the docs](https://vespin.dev/docs) and [reviewing](review-agents.md):",
      "",
      "      - one *each*",
      "---",
      "",
      "The answer first.",
      "",
      "## Steps",
      "",
      "See [how fast](review-agents.md#how-fast).",
      "",
      "## Steps",
      "",
      "## Steps-1",
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
      acceptedAnswer: { "@type": "Answer", text: "Yes, see the docs and reviewing: one each" },
    },
  ]);

  assert.ok(
    guideMarkdown(guide).text.endsWith(
      "## Frequently asked questions\n\n### Can I run two?\n\nYes, see [the docs](https://vespin.dev/docs) and [reviewing](review-agents.md):\n\n- one *each*\n",
    ),
  );
  // A link to another guide's file opens that guide's page, and its section's heading id.
  assert.ok(guide.faq[0]?.html.includes('href="/guides/review-agents"'));
  assert.ok(guide.html.includes('href="/guides/review-agents#how-fast"'));
  assert.ok(
    guide.html.includes('<h2 id="steps">') &&
      guide.html.includes('<h2 id="steps-1">') &&
      guide.html.includes('<h2 id="steps-1-1">'),
  );
});

test("a draft is left out where drafts are, and a guide naming a related guide that isn't there, or a day the calendar lacks, fails the build", () => {
  const draft = FILES[1].words.replace("faq:", "draft: true\nfaq:");

  assert.deepEqual(
    parseGuides([{ file: "review-agents.md", words: draft }], false).map((guide) => guide.slug),
    [],
  );

  assert.throws(() => parseGuides([FILES[0]], true), /related.*review-agents/);

  // A link in the body to a guide the build leaves out fails it too, in Markdown or raw HTML.
  const linked = FILES[0].words.replace("related: [review-agents]\n", "");

  const anchored = linked.replace(
    "[how fast](review-agents.md#how-fast)",
    '<a href="review-agents.md">how fast</a>',
  );

  for (const words of [linked, anchored])
    assert.throws(
      () =>
        parseGuides(
          [
            { file: "run-agents.md", words },
            { file: "review-agents.md", words: draft },
          ],
          false,
        ),
      /doesn't publish: review-agents/,
    );

  assert.throws(
    () =>
      parseGuides(
        [
          {
            file: "review-agents.md",
            words: FILES[1].words.replace("updated: 2026-11-11", "updated: 2026-11-31"),
          },
        ],
        true,
      ),
    /review-agents\.md/,
  );
});
