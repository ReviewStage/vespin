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

/** A comment, a declaration, a processing instruction, or a tag, from its `<`; anything else a `<` starts stays words, as a browser draws `a < b`. */
const MARKUP =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gu;

/** One attribute of a tag's: its name, then its value quoted either way or bare, or none. */
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

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

/**
 * Raw HTML as the tags and words it is written in, in order: each tag by its
 * name and attributes, each run of words between tags with its references
 * read, and every comment, declaration and instruction left out. Note that
 * nothing is nested or checked here: a tag left open, or closed twice, is
 * read as written, and the reader that draws them decides what each means.
 */
export function htmlTokens(html: string): readonly HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let at = 0;

  const words = (until: number) => {
    if (until > at) tokens.push({ kind: HTML_TOKEN.TEXT, text: htmlWords(html.slice(at, until)) });
  };

  for (const match of html.matchAll(MARKUP)) {
    const [written, closing, tag, attributes = "", selfClosing] = match;
    words(match.index);
    at = match.index + written.length;

    if (tag === undefined) continue;
    const name = tag.toLowerCase();

    tokens.push(
      closing === "/"
        ? { kind: HTML_TOKEN.CLOSE, name }
        : {
            kind: HTML_TOKEN.OPEN,
            name,
            attributes: attributesOf(attributes),
            alone: selfClosing === "/" || VOID_TAGS.has(name),
          },
    );
  }

  words(html.length);

  return tokens;
}
