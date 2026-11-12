# Guides

Every file here but this one is a guide on vespin.dev, built into a page at
`/guides/<slug>` with the same prerender as the changelog
(`scripts/prerender.ts`). A guide's slug is its file's name: lower-case words
joined by hyphens, then `.md`, such as `run-codex-in-the-cloud.md`. A slug is
an address people link to, so keep it once the guide is published.

## Format

A guide opens on YAML front matter between `---` lines, then its body in
Markdown (GitHub's dialect, tables included):

```markdown
---
title: How to run Codex in the cloud
description: One or two plain sentences on what the guide answers.
published: 2026-11-12
updated: 2026-11-12
related: [run-claude-code-in-the-cloud]
faq:
  - q: Does it use my ChatGPT plan?
    a: Yes. An answer is Markdown, [links](https://example.com) included.
  - q: "A question with a colon: quote it"
    a: "Quote any value YAML would misread, such as one with a colon and a space in it: like this."
---

The answer to the title, in the first sentence. Opening paragraphs may stand
before the first section.

## A section

…
```

| Key | Required | What it is |
| --- | --- | --- |
| `title` | yes | The page's `h1`, its tab title, and its name in the index, `llms.txt`, and other guides' related links. |
| `description` | yes | The page's lead and meta description, the index's summary, and the guide's line in `llms.txt`. |
| `published` | yes | The day it first went up, `YYYY-MM-DD`. |
| `updated` | yes | The day its words last changed, `YYYY-MM-DD`, never before `published`. The sitemap's `lastmod`. |
| `faq` | yes | At least one `{ q, a }`, drawn under "Frequently asked questions" after the body and marked up as `FAQPage` structured data. |
| `related` | no | Other guides' slugs, linked under "Related guides". Without it, the page links the three most recently updated others. |
| `draft` | no | `true` keeps the guide out of production builds; a Preview and a local build still draw it. |

Link another guide by its file, `[the Codex guide](run-codex-in-the-cloud.md)`:
the page links it at `/guides/run-codex-in-the-cloud`, and the Markdown copy
and GitHub read it as written. A picture is written from the repository's
root, `apps/web/public/…`, as the changelog's are, and served from the
site's.

The body has no `#` heading, since the page sets the title, and no FAQ of its
own, since the front matter's is drawn for it. Every page closes on the same
short paragraph about Vespin (`GUIDE_PRODUCT_BLURB` in `src/guides.ts`).

The build refuses a guide that breaks this format, naming the file and the
key: a missing or misspelled key, a day that is not `YYYY-MM-DD`, an
`updated` before `published`, an empty FAQ, or a `related` slug no guide has.

## What a guide gets

Nothing is registered by hand. From each file the build writes:

- its page, `/guides/<slug>`, listed on the `/guides` index, newest first;
- its Markdown copy, `/guides/<slug>.md`, which the page's head names as an
  alternate;
- its `Article` and `FAQPage` JSON-LD in the page's head;
- its line in `sitemap.xml`, with `lastmod`, and in the root `llms.txt`.

Nothing in the site's bar, foot, or home page links to the guides; readers
arrive from search, answer engines, and other guides.

## Seeing one

`pnpm --filter @repo/web dev`, then open `http://localhost:5173/guides` or
`/guides/<slug>`. `pnpm --filter @repo/web build` writes every page, copy,
and list into `apps/web/dist/`.
