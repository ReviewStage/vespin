// html-tokens.ts -- raw HTML written into Markdown read as a flat run of tags and words, with no HTML engine: what GitHub's words carry (a picture, a table, a folded section), for the Markdown reader to draw from an allowlist.

/** What a piece of raw HTML is: a tag that opens, one that closes, or words between tags. */
export const HTML_TOKEN = {
  OPEN: "open",
  CLOSE: "close",
  TEXT: "text",
} as const;

export type HtmlToken =
  | {
      readonly kind: typeof HTML_TOKEN.OPEN;
      /** The tag's name, lowercased. */
      readonly name: string;
      /** Its attributes by their lowercased names, each value with its character references read. */
      readonly attributes: ReadonlyMap<string, string>;
      /** Whether it stands alone, a void tag (`<img>`, `<br>`) or one written `<tag />`, which no tag closes. */
      readonly alone: boolean;
    }
  | { readonly kind: typeof HTML_TOKEN.CLOSE; readonly name: string }
  | { readonly kind: typeof HTML_TOKEN.TEXT; readonly text: string };

/** The tags HTML never closes. */
const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** A tag's name: a letter, then letters, digits, `-` and `:`. */
const TAG_NAME = /^[a-zA-Z][\w:-]*/u;

/** One attribute of a tag's: its name, then its value quoted either way or bare, or none. */
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

/** The longest tag read, past which it is dropped whole as no tag GitHub writes, so no attribute read runs over a page of words. */
const MAX_TAG_CHARS = 4_096;

/** The named character references GitHub's words use; any other stays as written. */
const NAMED_REFERENCE: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
  ["middot", "·"],
  ["mdash", "—"],
  ["ndash", "–"],
  ["hellip", "…"],
]);

const REFERENCE = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z]+));/gu;

/** The highest code point a reference may name. */
const MAX_CODE_POINT = 0x10ffff;

/** A character a numeric reference names, or the reference as written where it names none. */
function codePointWords(written: string, point: number): string {
  return point > 0 && point <= MAX_CODE_POINT ? String.fromCodePoint(point) : written;
}

/** Words with their character references read (`&amp;`, `&#39;`, `&#x1F44D;`). */
export function htmlWords(words: string): string {
  return words.replace(REFERENCE, (written, decimal?: string, hex?: string, name?: string) => {
    if (decimal !== undefined) return codePointWords(written, Number.parseInt(decimal, 10));

    if (hex !== undefined) return codePointWords(written, Number.parseInt(hex, 16));

    return NAMED_REFERENCE.get(name ?? "") ?? written;
  });
}

function attributesOf(written: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();

  for (const [, name = "", double, single, bare] of written.matchAll(ATTRIBUTE)) {
    attributes.set(name.toLowerCase(), htmlWords(double ?? single ?? bare ?? ""));
  }

  return attributes;
}

/** A tag written between `<` and `>`, `body` its name and attributes after any `/`: one that closes, one that opens, or nothing where it names no tag. */
function tagToken(body: string): HtmlToken | undefined {
  const closing = body.startsWith("/");
  const rest = closing ? body.slice(1) : body;
  const [tag] = TAG_NAME.exec(rest) ?? [];

  if (tag === undefined) return undefined;
  const name = tag.toLowerCase();

  if (closing) return { kind: HTML_TOKEN.CLOSE, name };
  const attributes = rest.slice(tag.length);

  return {
    kind: HTML_TOKEN.OPEN,
    name,
    attributes: attributesOf(attributes),
    alone: attributes.trimEnd().endsWith("/") || VOID_TAGS.has(name),
  };
}

/** Where a comment opened at `at` ends, past its `-->`; none where it never ends, which drops the rest, as a browser does. */
function commentEnd(html: string, at: number): number | undefined {
  const end = html.indexOf("-->", at + 4);

  return end === -1 ? undefined : end + 3;
}

/** Finds a character from a place on, each search starting where the last found it, so places asked in order cost one pass of the words in all. */
function finder(html: string, character: string): (from: number) => number {
  let found = html.indexOf(character);

  return (from) => {
    if (found !== -1 && found < from) found = html.indexOf(character, from);

    return found;
  };
}

/** How many double quotes words hold. */
function quotes(words: string): number {
  return words.split('"').length - 1;
}

/**
 * Where a tag opened at `at` ends, past its `>`: the first `>` outside a
 * quoted value, as `title="a > b"` holds one inside; none where it never
 * ends, or runs past `MAX_TAG_CHARS`, which drops the rest, as a browser
 * drops a tag left open.
 */
function tagEnd(
  html: string,
  at: number,
  closeAfter: (from: number) => number,
  quoteAfter: (from: number) => number,
): number | undefined {
  let end = closeAfter(at);

  while (end !== -1 && end - at <= MAX_TAG_CHARS) {
    if (quotes(html.slice(at, end)) % 2 === 0) return end + 1;
    const quote = quoteAfter(end);

    if (quote === -1) return undefined;
    end = closeAfter(quote);
  }

  return undefined;
}

/**
 * Raw HTML as the tags and words it is written in, in order: each tag by its
 * name and attributes, each run of words between tags with its references
 * read, and every comment, declaration and instruction left out. A `<`
 * that opens no markup, as in `a < b`, stays words, and markup left
 * unclosed drops the words after it, as a browser does. Note that it reads
 * in one pass: each `<` looks for its `>` from the one found last, and a
 * tag runs no further than `MAX_TAG_CHARS`, so no input of any length or
 * shape costs much more than its length. Nothing is nested or checked here: a
 * tag left open, or closed twice, is read as written, and the reader that
 * draws them decides what each means.
 */
export function htmlTokens(html: string): readonly HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const closeAfter = finder(html, ">");
  const quoteAfter = finder(html, '"');
  let words = 0;
  let at = html.indexOf("<");

  const wordsUntil = (until: number) => {
    if (until > words) {
      tokens.push({ kind: HTML_TOKEN.TEXT, text: htmlWords(html.slice(words, until)) });
    }
  };

  while (at !== -1) {
    const next = html[at + 1] ?? "";
    const comment = html.startsWith("<!--", at);

    if (!comment && next !== "!" && next !== "?" && next !== "/" && !/[a-zA-Z]/u.test(next)) {
      at = html.indexOf("<", at + 1);
      continue;
    }

    wordsUntil(at);
    const end = comment ? commentEnd(html, at) : tagEnd(html, at, closeAfter, quoteAfter);

    if (end === undefined) return tokens;

    const token =
      comment || next === "!" || next === "?" ? undefined : tagToken(html.slice(at + 1, end - 1));

    if (token !== undefined) tokens.push(token);
    words = end;
    at = html.indexOf("<", end);
  }

  wordsUntil(html.length);

  return tokens;
}
