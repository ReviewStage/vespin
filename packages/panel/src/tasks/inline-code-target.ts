/**
 * inline-code-target.ts -- what an inline span of code in an agent's words opens, by its shape alone: a file of the agent's checkout, at a line where it names one, or a page of the web.
 *
 * Agents name a file as `packages/x/y.ts:12` and a page as
 * `github.com/a/b` far more often than they write a link, so a span of
 * code whose whole words have one of those shapes opens what it names. The
 * words are judged once, left to right, and nothing is read: whether the
 * file is there is the File tab's to find out once it is pressed, as it is
 * for a mention of a file. Every pattern here is anchored and tries a
 * bounded stretch from each place it can start, so the judgment stays
 * linear in the words' length.
 */

import { checkoutRelativePath } from "@repo/features/checkout-path";

/** What an inline span of code opens. */
export const INLINE_CODE_TARGET = {
  FILE: "file",
  WEB: "web",
} as const;

/** A file of the checkout, by its path in it, at the line the words name; or a page of the web, by its whole address. */
export type InlineCodeTarget =
  | {
      readonly kind: typeof INLINE_CODE_TARGET.FILE;
      readonly path: string;
      readonly line: number | undefined;
    }
  | { readonly kind: typeof INLINE_CODE_TARGET.WEB; readonly href: string };

/** The longest words judged at all. Note that a span past it is drawn plain, because no path or address an agent writes is that long. */
const MAX_CHARS = 1024;

/** A web address's scheme, which the words must open on to be one. */
const WEB_SCHEME = /^https?:\/\//iu;

/** Words wholly made of what a path or a bare address is written with: no space, quote, comma, or glob. */
const PATH_CHARACTERS = /^[\w.\-/@+[\]()$~%:#?=&]+$/u;

/** A path's line, and its column, at the words' end: `:12` or `:12:3`. */
const LINE_SUFFIX = /:(\d{1,7})(?::\d{1,7})?$/u;

/** What a path is written with once its line is cut off: what `PATH_CHARACTERS` takes but the marks only an address carries. */
const PATH_ONLY_CHARACTERS = /^[\w.\-/@+[\]()$~]+$/u;

/** One label of a host's name: letters, digits, and inner hyphens. */
const HOST_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/iu;

/** A host's last label, its top-level domain: letters alone. */
const TOP_LEVEL_DOMAIN = /^[a-z]{2,24}$/iu;

/** A host's port, after its name. */
const PORT = /^\d{1,5}$/u;

/** A file's extension: letters and digits, at least one a letter. */
const EXTENSION = /^(?=[a-z\d]{0,15}[a-z])[a-z\d]{1,16}$/iu;

/**
 * The extensions a file named alone, with no folder, is taken to be a
 * file by. Note that a name with a folder takes any extension, but one
 * alone takes only these, because `console.log`, `process.env`, and
 * `Effect.runPromise` are words of code shaped like a file's name.
 */
const BARE_NAME_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "mdx",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "lock",
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "html",
  "py",
  "rb",
  "rs",
  "go",
  "swift",
  "kt",
  "java",
  "sh",
  "sql",
  "txt",
]);

/** The words as a page of the web: whole with their scheme, or a bare host and path given one; none for any other. */
function webTarget(words: string): InlineCodeTarget | undefined {
  if (WEB_SCHEME.test(words)) {
    return URL.canParse(words) ? { kind: INLINE_CODE_TARGET.WEB, href: words } : undefined;
  }

  const slash = words.indexOf("/");

  if (slash <= 0) return undefined;
  const [name = "", port, ...rest] = words.slice(0, slash).split(":");

  if (rest.length > 0 || (port !== undefined && !PORT.test(port))) return undefined;
  const labels = name.split(".");
  const last = labels.at(-1) ?? "";

  if (labels.length < 2 || !TOP_LEVEL_DOMAIN.test(last)) return undefined;

  if (!labels.every((label) => HOST_LABEL.test(label))) return undefined;
  const href = `https://${words}`;

  return URL.canParse(href) ? { kind: INLINE_CODE_TARGET.WEB, href } : undefined;
}

/** The words as a file of the checkout at its line; none for any other. */
function fileTarget(words: string): InlineCodeTarget | undefined {
  const suffix = LINE_SUFFIX.exec(words);
  const written = suffix === null ? words : words.slice(0, suffix.index);

  if (!PATH_ONLY_CHARACTERS.test(written) || written.startsWith("~")) return undefined;
  const path = checkoutRelativePath(written);

  if (path === undefined) return undefined;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1);

  if (!EXTENSION.test(extension)) return undefined;

  if (!written.includes("/") && !BARE_NAME_EXTENSIONS.has(extension.toLowerCase())) {
    return undefined;
  }

  const line = suffix === null ? undefined : Number(suffix[1]);

  if (line === 0) return undefined;

  return { kind: INLINE_CODE_TARGET.FILE, path, line };
}

/**
 * What an inline span of code opens, by its whole words' shape: a page of
 * the web where they are a whole address, or a bare host and path
 * (`github.com/a/b`); a file of the checkout where they are a path to a
 * file, relative or absolute under the checkout, by its extension, at
 * `:line` or `:line:column` where they end on one; none for any other
 * words, a folder's among them, since the window opens no folder.
 */
export function inlineCodeTarget(words: string): InlineCodeTarget | undefined {
  if (words.length === 0 || words.length > MAX_CHARS || !PATH_CHARACTERS.test(words)) {
    return undefined;
  }

  return webTarget(words) ?? fileTarget(words);
}
