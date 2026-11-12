/**
 * guides.ts -- the guides under `apps/web/guides/` (`site-markdown.tsx` reads them at build time), and the index, per-guide routes, structured data, Markdown copies, and `llms.txt` over them.
 *
 * A guide is one Markdown file, `apps/web/guides/<slug>.md`, whose slug is
 * its address (`/guides/<slug>`) and whose format `apps/web/guides/README.md`
 * documents. The prerender writes one HTML file per route, a Markdown copy of
 * every guide beside its HTML, and the site's `llms.txt` at the build's root;
 * the client reads its route back from the address it was served at, so both
 * render the same view.
 */

import { LINK_ORIGIN } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { PageHead } from "./changelog-releases";

export const GUIDES_PATH = "/guides";

/** The site's `llms.txt`, at the build's root (llmstxt.org). */
export const LLMS_TEXT_FILE = "llms.txt";

/** How many guides a page links to as related when its own front matter names none. */
const RELATED_FALLBACK_COUNT = 3;

/** What every guide closes on: what the product is, in a sentence or two. */
export const GUIDE_PRODUCT_BLURB = `${PRODUCT_NAME} is an inbox for all your coding agents. It runs Claude Code and Codex in parallel, each agent in its own cloud sandbox on its own branch, and they open pull requests and post to your Inbox only when they need you. It is free and open source.`;

/** The heading a guide's FAQ stands under, on its page and in its Markdown copy. */
export const GUIDE_FAQ_HEADING = "Frequently asked questions";

const INDEX_TITLE = "Guides";

/** What the index says the guides are for, under its title and in its head. */
export const INDEX_DESCRIPTION = `How to run, supervise, and review coding agents in parallel, from the team behind ${PRODUCT_NAME}.`;

const GUIDE_PATH = /^\/guides\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** What a guides address shows: the index, or one guide. */
export const GUIDE_VIEW = {
  INDEX: "index",
  GUIDE: "guide",
} as const;

/** One question of a guide's FAQ. */
export interface GuideQuestion {
  readonly question: string;
  /** The answer as written, in Markdown, which the guide's Markdown copy carries. */
  readonly answer: string;
  /** The answer as the page draws it. */
  readonly html: string;
  /** The answer as plain words, which the FAQ's structured data carries. */
  readonly text: string;
}

export interface Guide {
  /** The file's name without `.md`, which is its address under `/guides`. */
  readonly slug: string;
  readonly title: string;
  /** One or two sentences: the index's summary, and the page's lead and meta description. */
  readonly description: string;
  /** The day the guide first went up, `YYYY-MM-DD`. */
  readonly published: string;
  /** The day its words last changed, `YYYY-MM-DD`; never before `published`. */
  readonly updated: string;
  /** The slugs of the guides it names as related, in its own order. */
  readonly related: readonly string[];
  /** The guide's body, under its front matter, as HTML. */
  readonly html: string;
  /** The body as written, which the guide's Markdown copy carries. */
  readonly markdown: string;
  /** The front matter's questions, which the page draws after the body and marks up as a `FAQPage`. */
  readonly faq: readonly GuideQuestion[];
}

export type GuideView =
  | { readonly kind: typeof GUIDE_VIEW.INDEX; readonly guides: readonly Guide[] }
  | {
      readonly kind: typeof GUIDE_VIEW.GUIDE;
      readonly guide: Guide;
      readonly related: readonly Guide[];
    };

export interface GuideRoute {
  readonly path: string;
  /** The built HTML file the route is served from, relative to the site's root. */
  readonly file: string;
  readonly view: GuideView;
  readonly head: PageHead;
  /** The day its words last changed, which the sitemap gives as `lastmod`, where it has one. */
  readonly updated: string | undefined;
}

/** A text file the build writes beside the pages, relative to the build's root. */
export interface GuideText {
  readonly file: string;
  readonly text: string;
}

/** A guide's own address. */
export function guidePath(slug: string): string {
  return `${GUIDES_PATH}/${slug}`;
}

/** A guide's Markdown copy, beside its page. */
function guideMarkdownPath(slug: string): string {
  return `${guidePath(slug)}.md`;
}

/** Newest first by the day each went up, then by title, so the index's order never depends on the files'. */
function guidesInOrder(guides: readonly Guide[]): readonly Guide[] {
  return [...guides].sort(
    (a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title),
  );
}

/** The guides a page links to: those its front matter names, else the most recently updated others. */
function relatedOf(guides: readonly Guide[], guide: Guide): readonly Guide[] {
  if (guide.related.length > 0)
    return guide.related.flatMap((slug) => guides.filter((other) => other.slug === slug));

  return [...guides]
    .filter((other) => other.slug !== guide.slug)
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title))
    .slice(0, RELATED_FALLBACK_COUNT);
}

function guideView(guides: readonly Guide[], guide: Guide): GuideView {
  return { kind: GUIDE_VIEW.GUIDE, guide, related: relatedOf(guides, guide) };
}

/**
 * The view an address shows, or nothing for an address the guides have no
 * page at. An address may name its built file (`/guides/<slug>.html`), as a
 * static server and the dev server serve them.
 */
export function guideViewForPath(
  guides: readonly Guide[],
  pathname: string,
): GuideView | undefined {
  const path = pathname.replace(/\/+$/, "").replace(/\.html$/, "");

  if (path === GUIDES_PATH) return { kind: GUIDE_VIEW.INDEX, guides: guidesInOrder(guides) };
  const slug = GUIDE_PATH.exec(path)?.[1];
  const guide = guides.find((each) => each.slug === slug);

  return guide === undefined ? undefined : guideView(guides, guide);
}

/** A `<` in JSON written inside a `<script>` would let the words close it, so it is escaped. */
const scriptSafe = (json: string) => json.replaceAll("<", "\\u003c");

/**
 * What a search engine and an answer engine read of a guide beside its words:
 * the guide as an `Article` with its days, and its FAQ as a `FAQPage`, each
 * a JSON-LD block for the page's head. A guide with no FAQ has no `FAQPage`.
 */
export function guideStructuredData(guide: Guide): readonly string[] {
  const url = `${LINK_ORIGIN}${guidePath(guide.slug)}`;

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.updated,
    url,
    mainEntityOfPage: url,
    publisher: { "@type": "Organization", name: PRODUCT_NAME, url: LINK_ORIGIN },
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.text },
    })),
  };

  return [article, ...(guide.faq.length > 0 ? [faq] : [])].map((data) =>
    scriptSafe(JSON.stringify(data)),
  );
}

function guideHead(guide: Guide): PageHead {
  return {
    title: `${guide.title} — ${PRODUCT_NAME}`,
    description: guide.description,
    url: `${LINK_ORIGIN}${guidePath(guide.slug)}`,
    image: undefined,
    markdown: guideMarkdownPath(guide.slug),
    structuredData: guideStructuredData(guide),
  };
}

/** Every address the guides serve, each with its view, its built file, and its head: the index first. */
export function guideRoutes(guides: readonly Guide[]): readonly GuideRoute[] {
  const index: GuideRoute = {
    path: GUIDES_PATH,
    file: "guides.html",
    view: { kind: GUIDE_VIEW.INDEX, guides: guidesInOrder(guides) },
    head: {
      title: `${INDEX_TITLE} — ${PRODUCT_NAME}`,
      description: INDEX_DESCRIPTION,
      url: `${LINK_ORIGIN}${GUIDES_PATH}`,
      image: undefined,
    },
    updated: undefined,
  };

  const pages = guidesInOrder(guides).map(
    (guide): GuideRoute => ({
      path: guidePath(guide.slug),
      file: `guides/${guide.slug}.html`,
      view: guideView(guides, guide),
      head: guideHead(guide),
      updated: guide.updated,
    }),
  );

  return [index, ...pages];
}

/**
 * A guide's Markdown copy, for a reader that wants its words without the
 * page: its title, its days, its words and FAQ as written, and a link to its
 * page.
 */
export function guideMarkdown(guide: Guide): GuideText {
  const text = [
    `# ${guide.title}`,
    "",
    `> ${guide.description}`,
    "",
    `Published ${guide.published}. Updated ${guide.updated}. Read it on the web at ${LINK_ORIGIN}${guidePath(guide.slug)}.`,
    "",
    guide.markdown.trim(),
    ...(guide.faq.length > 0 ? ["", `## ${GUIDE_FAQ_HEADING}`] : []),
    ...guide.faq.flatMap((entry) => ["", `### ${entry.question}`, "", entry.answer.trim()]),
    "",
  ].join("\n");

  return { file: guideMarkdownPath(guide.slug).slice(1), text };
}

/** A line of `llms.txt`'s link list: the name, its address, and what it holds. */
const llmsLink = (title: string, url: string, about: string) => `- [${title}](${url}): ${about}`;

/**
 * The site's `llms.txt` (llmstxt.org): what the product is, then every guide's
 * Markdown copy, newest first, and the site's other pages an answer engine
 * may want. Generated from the same guides the prerender writes, so a new
 * guide is listed by the build that publishes it.
 */
export function llmsText(guides: readonly Guide[]): string {
  const listed = guidesInOrder(guides).map((guide) =>
    llmsLink(guide.title, `${LINK_ORIGIN}${guideMarkdownPath(guide.slug)}`, guide.description),
  );

  return [
    `# ${PRODUCT_NAME}`,
    "",
    `> ${GUIDE_PRODUCT_BLURB}`,
    "",
    "## Guides",
    "",
    ...listed,
    "",
    "## Optional",
    "",
    llmsLink("Docs", `${LINK_ORIGIN}/docs`, `How to install and use ${PRODUCT_NAME}.`),
    llmsLink(
      "Changelog",
      `${LINK_ORIGIN}/changelog`,
      `What changed in each ${PRODUCT_NAME} release.`,
    ),
    llmsLink("Privacy", `${LINK_ORIGIN}/privacy`, `What ${PRODUCT_NAME} collects and why.`),
    "",
  ].join("\n");
}
