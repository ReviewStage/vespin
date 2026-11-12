---
title: How the guides are built
description: A placeholder guide that shows how a guide's front matter, body, and FAQ are drawn. It is a draft, so production never publishes it.
published: 2026-11-12
updated: 2026-11-12
draft: true
faq:
  - q: Where is a guide written?
    a: In `apps/web/guides/<slug>.md`, whose format the folder's `README.md` documents.
  - q: Does a guide need to be registered anywhere?
    a: No. The index, the sitemap, `llms.txt`, and the Markdown copy are all generated from the file.
---

Each guide is one Markdown file, and the build draws it as a page. This one is
a placeholder: it is a draft, so it stands on a Preview and never on
vespin.dev.

## What the body can hold

Paragraphs, lists, tables, code, and links, in GitHub's dialect:

| Part | Where it comes from |
| --- | --- |
| Title and lead | `title` and `description` |
| Dates | `published` and `updated` |
| FAQ | `faq` |

A table wider than the column scrolls sideways in its own box:

| Tool | Where agents run | Agents | Teams | Price | Open source | Mobile |
| --- | --- | --- | --- | --- | --- | --- |
| Example one | Your laptop, in worktrees | Several | No | Free | Yes | No |
| Example two | A cloud sandbox per task | Several | Yes | Per seat | No | Web |

## What comes after it

The page closes on the FAQ, a short paragraph about Vespin, and related
guides.
