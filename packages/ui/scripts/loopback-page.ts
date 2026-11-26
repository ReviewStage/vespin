// loopback-page.ts -- writes or checks the loopback sign-in page's art: `AuthPage` rendered to markup, the stylesheet it draws with, and the site's favicon, for the desktop and the command line to serve as one document.

import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { LANDING_TONE, type LandingTone } from "@repo/features/landing-outcome";
import { compile, optimize } from "@tailwindcss/node";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthMark } from "../src/components/auth-page/auth-mark.js";
import { AuthPage } from "../src/components/auth-page/auth-page.js";
import { MARK_PROVIDER, type MarkProvider } from "../src/marks/provider-mark.js";

/**
 * The page a browser is left on after a sign-in lands on the loopback is
 * served by an ephemeral 127.0.0.1 server that answers one document and
 * nothing else, so it cannot load the site's bundle, its stylesheet, its
 * font, or its favicon. Rather than hand-build a look of its own, it serves
 * what this script renders ahead of time: the very `AuthPage` and `AuthMark`
 * the site's landings draw, as markup with the title and the line under it
 * left as slots, the Tailwind and `--ui-*` rules those elements use and no
 * others, Geist's Latin face as a data URL, and the site's own favicon.
 *
 * Its output is `@repo/credentials`' generated module, which the repository
 * check keeps in step with `@repo/ui` (`--check`).
 */

/** Where the art is written: the module the loopback page reads. */
const OUT = fileURLToPath(
  new URL("../../credentials/src/generated/loopback-page-art.ts", import.meta.url),
);

/** The site's favicon, the one vespin.dev's tab wears. */
const FAVICON = fileURLToPath(new URL("../../brand/assets/icon/favicon.svg", import.meta.url));

/** Geist's Latin face, the one the site's pages set their words in. */
const GEIST_LATIN = fileURLToPath(
  import.meta.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
);

/** Where the stylesheet's imports resolve from. */
const UI_SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** The slots the page's words go into, which no word of a page can spell. */
const SLOT = { TITLE: "@@loopback-title@@", DESCRIPTION: "@@loopback-description@@" } as const;

/** Whose mark a loopback page's ring holds: the identity provider signed in with, or the app's own. */
const LOOPBACK_MARK = { VESPIN: "vespin", GOOGLE: "google", GITHUB: "github" } as const;

type LoopbackMark = (typeof LOOPBACK_MARK)[keyof typeof LOOPBACK_MARK];

/** The provider each mark draws, the app's own where none. */
const MARK_PROVIDER_OF = {
  [LOOPBACK_MARK.VESPIN]: undefined,
  [LOOPBACK_MARK.GOOGLE]: MARK_PROVIDER.GOOGLE,
  [LOOPBACK_MARK.GITHUB]: MARK_PROVIDER.GITHUB,
} as const satisfies Record<LoopbackMark, MarkProvider | undefined>;

/**
 * The sheet the page is drawn with, as the site's entry composes it
 * (`apps/web/src/styles.css`), narrowed to what an auth page reads: the
 * preflight and utilities, the tokens (`tokens/tokens.css`'s, but for those
 * of what the page never draws: an identity hue, a file icon, a Manager's
 * face, the site's display styles, the viewport, and reduced motion, since
 * nothing on it moves), the theme's vocabulary, and the
 * card's, the auth page's, and the marks' own component rules, and the
 * site's page ground and face (its `@layer base`).
 */
const ENTRY_CSS = `
@import "tailwindcss";
@import "./tokens/scale.css";
@import "./tokens/profiles.css";
@import "./tokens/geist.css";
@import "./tokens/palettes.css";
@import "./tokens/brand.css";
@import "./tokens/status-tone.css";
@import "./tokens/motion-tokens.css";
@import "./components/card/card.css";
@import "./components/auth-page/auth-page.css";
@import "./marks/product-mark.css";
@import "./marks/provider-mark.css";
@import "./tailwind/theme.css";

@layer base {
  html { font-family: var(--ui-font-sans); }
  body {
    background: var(--ui-color-ground);
    color: var(--ui-color-text);
    line-height: var(--ui-type-reading-leading);
    -webkit-font-smoothing: antialiased;
  }
}
`;

/** One page's markup, its words left as slots. */
function markup(mark: LoopbackMark, tone: LandingTone): string {
  return renderToStaticMarkup(
    createElement(AuthPage, {
      mark: createElement(AuthMark, { provider: MARK_PROVIDER_OF[mark], tone }),
      title: SLOT.TITLE,
      description: SLOT.DESCRIPTION,
    }),
  );
}

/** Every page's markup, by mark then tone. */
function pages(): Record<LoopbackMark, Record<LandingTone, string>> {
  const byTone = (mark: LoopbackMark) => ({
    [LANDING_TONE.COMPLETE]: markup(mark, LANDING_TONE.COMPLETE),
    [LANDING_TONE.DANGER]: markup(mark, LANDING_TONE.DANGER),
  });

  return {
    [LOOPBACK_MARK.VESPIN]: byTone(LOOPBACK_MARK.VESPIN),
    [LOOPBACK_MARK.GOOGLE]: byTone(LOOPBACK_MARK.GOOGLE),
    [LOOPBACK_MARK.GITHUB]: byTone(LOOPBACK_MARK.GITHUB),
  };
}

/** The classes the markup spells, which are the utilities the sheet keeps. */
function candidates(documents: readonly string[]): string[] {
  const classes = documents.flatMap((html) =>
    [...html.matchAll(/class="([^"]*)"/gu)].flatMap((match) => (match[1] ?? "").split(/\s+/u)),
  );

  return [...new Set(classes)].filter((name) => name !== "");
}

/** The page's stylesheet: the entry built for `classes`, with Geist set inside it. */
async function stylesheet(classes: readonly string[]): Promise<string> {
  const compiler = await compile(ENTRY_CSS, { base: UI_SRC, onDependency: () => {} });
  const font = (await readFile(GEIST_LATIN)).toString("base64");

  const face =
    `@font-face{font-family:"Geist Variable";font-style:normal;font-display:swap;font-weight:100 900;` +
    `src:url(data:font/woff2;base64,${font}) format("woff2-variations")}`;

  return optimize(face + compiler.build([...classes]), { minify: true }).code.trim();
}

/** Biome's line width, past which it moves a member's value under its key. */
const LINE_WIDTH = 100;

/** `words` as a string literal in Biome's quotes: double, unless it holds more double quotes than single. */
function quoted(words: string): string {
  const json = JSON.stringify(words);
  const doubles = words.split('"').length;
  const singles = words.split("'").length;

  if (doubles <= singles) return json;

  const inner = json
    .slice(1, -1)
    .replace(/\\(.)/gu, (sequence, character: string) => (character === '"' ? '"' : sequence))
    .replaceAll("'", "\\'");

  return `'${inner}'`;
}

/** One member of the module's literal: a key and its string, or a key and the members of its object. */
type Member = readonly [key: string, value: string | readonly Member[]];

/** Whether a member's value is an object's members rather than a string; `Array.isArray` narrows no readonly array. */
function isNested(value: Member[1]): value is readonly Member[] {
  return Array.isArray(value);
}

/** An object of strings' entries as members. */
function membersOf(record: Readonly<Record<string, string>>): readonly Member[] {
  return Object.entries(record);
}

/**
 * `members` as an object literal in the shape Biome formats the committed
 * file to, so the check reads the bytes Biome would keep: bare keys, a comma
 * after every member, and a value too long for its key's line moved under it.
 */
function literal(members: readonly Member[], depth = 0): string {
  const indent = "  ".repeat(depth + 1);

  const lines = members.map(([key, value]) => {
    if (isNested(value)) return `${indent}${key}: ${literal(value, depth + 1)},`;

    const line = `${indent}${key}: ${quoted(value)},`;

    return line.length <= LINE_WIDTH ? line : `${indent}${key}:\n${indent}  ${quoted(value)},`;
  });

  return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`;
}

/** The generated module's source. */
async function source(): Promise<string> {
  const markupByMark = pages();
  const documents = Object.values(markupByMark).flatMap((byTone) => Object.values(byTone));
  const style = await stylesheet(candidates(documents));
  const favicon = (await readFile(FAVICON, "utf8")).trim();

  const art: readonly Member[] = [
    ["SLOT", membersOf(SLOT)],
    ["STYLE", style],
    ["FAVICON", `data:image/svg+xml;base64,${Buffer.from(favicon).toString("base64")}`],
    [
      "MARKUP",
      Object.entries(markupByMark).map(([mark, byTone]): Member => [mark, membersOf(byTone)]),
    ],
  ];

  return (
    "// Generated by packages/ui/scripts/loopback-page.ts. Do not edit by hand: change\n" +
    "// `@repo/ui`'s AuthPage, AuthMark, or theme and re-run it.\n" +
    "//\n" +
    "// The loopback sign-in page's art: AuthPage's markup with its words as\n" +
    "// slots, by mark then tone, the sheet it draws with, and the site's favicon.\n\n" +
    `export const LOOPBACK_PAGE_ART = ${literal(art)} as const;\n`
  );
}

const wanted = await source();

if (argv.includes("--check")) {
  const kept = await readFile(OUT, "utf8").catch(() => "");

  if (kept !== wanted) {
    console.error(
      "error: the loopback sign-in page no longer matches @repo/ui's AuthPage; run pnpm --dir packages/ui exec tsx scripts/loopback-page.ts",
    );
    exit(1);
  }
} else {
  await writeFile(OUT, wanted);
}
