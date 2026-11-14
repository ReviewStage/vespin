// style-check.mjs -- fails on the "Never write" words and phrases of the docs' style guide.
//
//   node apps/docs/scripts/style-check.mjs [file.mdx ...]
//
// With no files it reads every .mdx page under apps/docs. It holds only the
// mechanical half of README.md's "Style" section: the words a reader never
// needs. Fenced code, inline code, and link targets are left out, since a
// command or an address is quoted, not written. Each finding prints as
// path:line:column, and any finding exits 1.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { argv, cwd, exit } from "node:process";
import { fileURLToPath } from "node:url";

const DOCS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`]*`/g;
const LINK_TARGET = /\]\([^)]*\)|\b(?:href|src)="[^"]*"|https?:\/\/\S+/g;

const NEVER_WRITE = [
  {
    pattern:
      /\b(?:seamless(?:ly)?|powerful|robust(?:ly)?|effortless(?:ly)?|unlock(?:s|ed|ing)?|supercharg(?:e|es|ed|ing)|leverag(?:e|es|ed|ing)|game-chang(?:ing|er)|cutting-edge|streamlin(?:e|es|ed|ing)|empower(?:s|ed|ing)?|delv(?:e|es|ing))\b/gi,
    why: "a word that sells; say what it does",
  },
  {
    pattern:
      /\b(?:whether you're|whether you are|in today's|let's dive|dive in(?:to)?|(?:it's|it is) worth (?:noting|mentioning))\b/gi,
    why: "a filler opener; start with the fact",
  },
  { pattern: /\b(?:simply|just)\b/gi, why: "a minimizer; cut it" },
  {
    pattern: /\bnot (?:just|only)\b[^.]*\bbut\b/gi,
    why: '"not just X, but Y"; say Y',
  },
  {
    pattern: /\b(?:in summary|in conclusion|to sum up|to summarize|in short)\b/gi,
    why: "a sign-off summary; end on the last instruction",
  },
  { pattern: /—[^—]*—/g, why: "stacked em dashes; split the sentence" },
  { pattern: /\S*[\w)"'”]\?(?=\s|$)/g, why: "a question; state the answer" },
  {
    pattern: /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu,
    why: "an emoji; name it in words or in code",
  },
];

// Note that we blank a span rather than delete it, so a column still points
// at the character the reader sees in their editor.
function blank(text, pattern) {
  return text.replace(pattern, (span) => " ".repeat(span.length));
}

function pagesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return pagesUnder(path);

    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

function findingsIn(path) {
  const findings = [];
  let inFence = false;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (FENCE.test(line)) {
        inFence = !inFence;

        return;
      }

      if (inFence) return;
      const prose = blank(blank(line, INLINE_CODE), LINK_TARGET);

      for (const { pattern, why } of NEVER_WRITE) {
        for (const match of prose.matchAll(pattern)) {
          findings.push({ line: index + 1, column: match.index + 1, text: match[0], why });
        }
      }
    });

  return findings;
}

function main() {
  const files = argv.length > 2 ? argv.slice(2) : pagesUnder(DOCS_ROOT);
  let count = 0;

  for (const file of files) {
    for (const { line, column, text, why } of findingsIn(file)) {
      count += 1;
      console.error(`${relative(cwd(), file)}:${line}:${column} "${text.trim()}": ${why}`);
    }
  }

  if (count > 0) {
    console.error(`\n${count} docs style finding(s); see apps/docs/README.md, "Never write".`);
    exit(1);
  }
}

main();
