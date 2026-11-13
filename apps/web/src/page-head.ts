/**
 * page-head.ts -- rewrites a built page's `<head>` for one route: its title, description, address, canonical address, and share image.
 *
 * The prerender serves many routes from one built template (every changelog
 * page and release from `changelog.html`), and a browser tab, a search
 * result, and a share card each read the route's own head, not the
 * template's. X reads its own `twitter:` copies of the card's tags, so each
 * is rewritten beside its Open Graph twin. The template's tags are the
 * contract: each one rewritten here must be in it once, and a template
 * without it is refused rather than shipped with another route's words. A
 * guide's Markdown alternate and structured data are added rather than
 * rewritten, since no other route has them.
 */

import type { PageHead } from "./changelog-releases";

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A `<meta>` tag's content, found by its `name` or `property` across however it is wrapped. */
function withMeta(
  html: string,
  attribute: "name" | "property",
  key: string,
  content: string,
): string {
  const tag = new RegExp(
    `(<meta\\s+${attribute}="${key.replaceAll(".", "\\.")}"\\s+content=")[^"]*(")`,
  );

  if (!tag.test(html)) throw new Error(`the page template has no <meta ${attribute}="${key}">`);

  // A replacer function, because a string replacement would read any `$` in the content as a back-reference.
  return html.replace(
    tag,
    (_, open: string, close: string) => `${open}${escapeAttribute(content)}${close}`,
  );
}

/** The `<link rel="canonical">` a search engine files the page under, rewritten to the route's own address. */
function withCanonical(html: string, url: string): string {
  const tag = /(<link\s+rel="canonical"\s+href=")[^"]*(")/;

  if (!tag.test(html)) throw new Error('the page template has no <link rel="canonical">');

  return html.replace(
    tag,
    (_, open: string, close: string) => `${open}${escapeAttribute(url)}${close}`,
  );
}

/**
 * What a route adds to its head that no template carries: an alternate link
 * to its words as Markdown, and its structured data, before `</head>`.
 */
function withHeadAdditions(html: string, head: PageHead): string {
  const additions = [
    ...(head.markdown === undefined
      ? []
      : [`<link rel="alternate" type="text/markdown" href="${escapeAttribute(head.markdown)}" />`]),
    ...(head.structuredData ?? []).map(
      (json) => `<script type="application/ld+json">${json}</script>`,
    ),
  ];

  if (additions.length === 0) return html;

  if (!html.includes("</head>")) throw new Error("the page template has no </head>");

  return html.replace("</head>", () => `${additions.join("\n")}\n</head>`);
}

/**
 * The template's head rewritten for a route. A route with an image shares it
 * in place of the site's card, at its own size when the caller read one.
 */
export function withPageHead(
  html: string,
  head: PageHead,
  imageSize: ImageSize | undefined,
): string {
  const title = /<title>[^<]*<\/title>/;

  if (!title.test(html)) throw new Error("the page template has no <title>");
  let rewritten = html.replace(title, () => `<title>${escapeText(head.title)}</title>`);
  rewritten = withMeta(rewritten, "name", "description", head.description);
  rewritten = withMeta(rewritten, "property", "og:title", head.title);
  rewritten = withMeta(rewritten, "name", "twitter:title", head.title);
  rewritten = withMeta(rewritten, "property", "og:description", head.description);
  rewritten = withMeta(rewritten, "name", "twitter:description", head.description);
  rewritten = withMeta(rewritten, "property", "og:url", head.url);
  rewritten = withCanonical(rewritten, head.url);
  rewritten = withHeadAdditions(rewritten, head);

  if (head.image === undefined) return rewritten;
  const origin = new URL(head.url).origin;
  rewritten = withMeta(rewritten, "property", "og:image", `${origin}${head.image.src}`);
  rewritten = withMeta(rewritten, "name", "twitter:image", `${origin}${head.image.src}`);
  rewritten = withMeta(rewritten, "property", "og:image:alt", head.image.alt);
  rewritten = withMeta(rewritten, "name", "twitter:image:alt", head.image.alt);

  if (imageSize === undefined) return rewritten;
  rewritten = withMeta(rewritten, "property", "og:image:width", String(imageSize.width));

  return withMeta(rewritten, "property", "og:image:height", String(imageSize.height));
}
