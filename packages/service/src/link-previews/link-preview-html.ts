/**
 * link-preview-html.ts -- what a page's `<head>` says of the page: its title, description, site name, icon, and picture, read from the markup's own tags.
 *
 * Only the head is read, up to `</head>` or the first `<body`, and only the
 * tags that say something of the page: `<title>`, `<meta>` by its `property`
 * or `name`, and `<link>` by its `rel`. Open Graph's words win over Twitter's,
 * and both over the plain ones, as every reader of these tags orders them;
 * an icon is the first `<link rel="icon">`, else the site's `/favicon.ico`.
 * Each address is made absolute against the page's own. Entities are read
 * back, and each thing is cut to its bound, so what travels is bounded by the
 * wire's vocabulary and not by the page. No parser library stands behind
 * this: a head's tags are flat, and a regular expression over them reads
 * every well-formed page and fails closed on a broken one, which answers
 * nothing rather than the wrong thing.
 */

import { LINK_PREVIEW_BOUNDS } from "@repo/features/link-preview-wire";
import { webPageAddressOf } from "./link-address.js";

/** What a page's head says of it, each where it says one. */
export interface PageHead {
  readonly title?: string;
  readonly description?: string;
  readonly siteName?: string;
  /** The page's icon's address, absolute. */
  readonly iconUrl?: string;
  /** The page's picture's address, absolute. */
  readonly imageUrl?: string;
}

/** The most bytes of a page read before the head is taken as whole: a head is kilobytes, and a page past this is a body with no head worth reading. */
export const HEAD_MAX_BYTES = 512_000;

/** Where the head ends: its closing tag, or the body's opening where a page closes none. */
const HEAD_END = /<\/head\s*>|<body[\s>]/iu;

/** Every tag the head says something in. */
const HEAD_TAG = /<(meta|link|title)\b([^>]*)>/giu;

/** The title's words, up to its closing tag. */
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu;

/** One attribute of a tag: its name and its value, quoted either way or bare. */
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/gu;

/** The charset a page names in its head, in a `<meta charset>` or a content-type meta. */
const META_CHARSET = /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/iu;

/** The names a page's title, description, site name, and picture are said under, in the order each is preferred. */
const SAYS = {
  TITLE: ["og:title", "twitter:title"],
  DESCRIPTION: ["og:description", "twitter:description", "description"],
  SITE_NAME: ["og:site_name"],
  IMAGE: ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"],
} as const;

/** The `rel` words that name a page's icon, in the order each is preferred. */
const ICON_RELS = ["icon", "shortcut icon", "apple-touch-icon"] as const;

/** Where a site keeps its icon when its pages name none. */
const DEFAULT_ICON_PATH = "/favicon.ico";

/** The named entities a head's words commonly carry; anything else named stays as written. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["ndash", "–"],
  ["mdash", "—"],
  ["hellip", "…"],
  ["laquo", "«"],
  ["raquo", "»"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["copy", "©"],
  ["reg", "®"],
  ["trade", "™"],
]);

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/giu;

const FOLD = "…";

/** Words with their entities read back. */
function unescaped(words: string): string {
  return words.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const point = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    }
    if (body.startsWith("#")) {
      const point = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    }
    return NAMED_ENTITIES.get(body.toLowerCase()) ?? whole;
  });
}

/** Words as a card says them: entities read back, runs of space one space, trimmed, and cut to `max`; none for no words. */
function spoken(words: string | undefined, max: number): string | undefined {
  if (words === undefined) return undefined;
  const said = unescaped(words)
    .replace(/[\p{Cc}\s]+/gu, " ")
    .trim();
  if (said === "") return undefined;
  return said.length <= max ? said : `${said.slice(0, max - 1)}${FOLD}`;
}

/** A tag's attributes by their lowercased names, each value with its entities read back. */
function attributesOf(tag: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || attributes.has(name)) continue;
    attributes.set(name, unescaped(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

/** The head of a page's markup: what stands before `</head>` or `<body`, or all of it where neither stands. */
function headOf(html: string): string {
  const end = HEAD_END.exec(html);
  return end === null ? html : html.slice(0, end.index);
}

/** The charset a page's head names, as a `TextDecoder` label; none where it names none. */
export function charsetOf(headBytes: Uint8Array): string | undefined {
  // Note that the head is read as Latin-1 to find the charset, since the bytes naming it are ASCII in every charset a page declares.
  const latin = new TextDecoder("latin1").decode(headBytes);
  return META_CHARSET.exec(headOf(latin))?.[1]?.toLowerCase();
}

/** An address a page names, made absolute against the page's own; none where it makes no address the guard reads (`link-address.ts`). */
function absolute(address: string | undefined, page: URL): string | undefined {
  if (address === undefined) return undefined;
  const spelled = address.trim();
  if (spelled === "" || !URL.canParse(spelled, page)) return undefined;
  return webPageAddressOf(new URL(spelled, page).href)?.href;
}

/** What a page's head says of the page, from its markup and its own address. */
export function pageHeadOf(html: string, page: URL): PageHead {
  const head = headOf(html);
  const meta = new Map<string, string>();
  const icons = new Map<string, string>();
  for (const match of head.matchAll(HEAD_TAG)) {
    const tag = match[1]?.toLowerCase();
    const attributes = attributesOf(match[2] ?? "");
    if (tag === "meta") {
      const key = (attributes.get("property") ?? attributes.get("name"))?.toLowerCase();
      const content = attributes.get("content");
      // Note that the first saying of a thing wins, as a reader of the head takes it.
      if (key !== undefined && content !== undefined && !meta.has(key)) meta.set(key, content);
    } else if (tag === "link") {
      const rel = attributes.get("rel")?.toLowerCase().replace(/\s+/gu, " ").trim();
      const href = attributes.get("href");
      if (rel !== undefined && href !== undefined && !icons.has(rel)) icons.set(rel, href);
    }
  }
  const first = (keys: readonly string[], from: ReadonlyMap<string, string>) =>
    keys.map((key) => from.get(key)).find((value) => value !== undefined && value.trim() !== "");
  const title = spoken(
    first(SAYS.TITLE, meta) ?? TITLE.exec(head)?.[1],
    LINK_PREVIEW_BOUNDS.MAX_TITLE_CHARS,
  );
  const description = spoken(
    first(SAYS.DESCRIPTION, meta),
    LINK_PREVIEW_BOUNDS.MAX_DESCRIPTION_CHARS,
  );
  const siteName = spoken(first(SAYS.SITE_NAME, meta), LINK_PREVIEW_BOUNDS.MAX_SITE_NAME_CHARS);
  const iconUrl = absolute(first(ICON_RELS, icons) ?? DEFAULT_ICON_PATH, page);
  const imageUrl = absolute(first(SAYS.IMAGE, meta), page);
  return {
    ...(title === undefined ? undefined : { title }),
    ...(description === undefined ? undefined : { description }),
    ...(siteName === undefined ? undefined : { siteName }),
    ...(iconUrl === undefined ? undefined : { iconUrl }),
    ...(imageUrl === undefined ? undefined : { imageUrl }),
  };
}
