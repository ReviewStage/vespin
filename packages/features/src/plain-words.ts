// plain-words.ts -- markdown as the plain words of a line too short to draw it: a card's title, and a preview's whole words on one line.

import { INLINE_SPAN, readInline } from "./composer-markdown.js";
import { insideCode, linkLabels } from "./mention-link.js";

/** The marks a markdown line opens on: a heading's, a quote's, or a list item's, which a description's or a task's first line may carry. */
const LINE_MARKS = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/u;

/**
 * The marks of strong emphasis and code left standing in plain words, a run
 * that wraps nothing, which a title drawn as plain words leaves out. Note
 * that `__` stays, because it is more often a name's own (`__init__`) than
 * emphasis.
 */
const STRAY_MARKS = /\*\*|`/gu;

/** What opens a markdown picture, `![alt](address)`, before the link it otherwise is. */
const PICTURE_OPEN = /!\[/gu;

/** A markdown fence's opening or closing line, which plain words leave out. */
const FENCE_LINE = /^\s*(?:```|~~~)/u;

/**
 * How a description, a worker's task, or a thought is named on its card, its line,
 * and its tab: its first line of words, as plain words, since the line is
 * drawn as text and the markdown is the opened card's. A fence's line is
 * passed over, since its language tag is no words of the text's.
 */
export function cardTitle(text: string): string {
  const first = picturesAsLinks(text)
    .split("\n")
    .find((line) => line.trim().length > 0 && !FENCE_LINE.test(line));
  return first === undefined ? "" : plainLine(first);
}

/**
 * The words with each picture outside code, `![alt](address)`, written as
 * the link it otherwise is, so plain words say it by its alt words as they
 * say a link by its label. Note that code is read in the whole text, since a
 * line alone cannot say whether it stands in a fence or an indented block.
 */
function picturesAsLinks(text: string): string {
  return text.replace(PICTURE_OPEN, (open, at: number) => (insideCode(text, at) ? open : "["));
}

function plainLine(line: string): string {
  // A link is said by its name, as its chip names it, never its destination (`linkLabels`).
  const words = linkLabels(line.trim().replace(LINE_MARKS, ""));
  // Note that the marks are read as a message box reads them (`composer-markdown.ts`), so a preview says what the box showed: each mark's words without its delimiters or the escapes in them, a code span's words as they are, and words wearing none as typed but for a stray mark.
  return readInline(words, [])
    .map((span) => {
      const said = words.slice(span.from, span.to);
      const marked = span.kind === INLINE_SPAN.WORDS && span.marks.length > 0;
      return marked ? said : said.replace(STRAY_MARKS, "");
    })
    .join("")
    .trim();
}

/**
 * The whole of a message's markdown as plain words on one line, as a
 * preview too short to draw markdown reads it: each line as a title reads
 * its first, fences left out, joined by spaces.
 */
export function plainWords(text: string): string {
  return picturesAsLinks(text)
    .split("\n")
    .filter((line) => !FENCE_LINE.test(line))
    .map(plainLine)
    .filter((line) => line.length > 0)
    .join(" ");
}
